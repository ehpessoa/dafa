// Gera a partir de content/*.mjs: seed do Supabase, docs do toolkit e arquivos de template.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_DATE, levels, weekly, sessions } from '../content/curriculum.mjs';
import { templates } from '../content/templates.mjs';
import { resources } from '../content/resources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p, c) => { const f = join(root, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); };

// ── Datas: apenas dias úteis (sem sábado/domingo) ──
const iso = (d) => d.toISOString().slice(0, 10);
const bdays = [];
for (let d = new Date(START_DATE + 'T12:00:00Z'); bdays.length < sessions.length; d.setUTCDate(d.getUTCDate() + 1)) {
  if (![0, 6].includes(d.getUTCDay())) bdays.push(iso(d));
}
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmt = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}`; };
const wd = (s) => WD[new Date(s + 'T12:00:00Z').getUTCDay()];
sessions.forEach((s, i) => { s.date = bdays[i]; s.week = Math.ceil(s.day / 5); });

// validações de consistência
const tSlugs = new Set(templates.map((t) => t.slug)), rSlugs = new Set(resources.map((r) => r.slug));
for (const s of sessions) {
  for (const t of s.templates) if (!tSlugs.has(t)) throw new Error(`template inexistente ${t} (dia ${s.day})`);
  for (const r of s.resources) if (!rSlugs.has(r)) throw new Error(`recurso inexistente ${r} (dia ${s.day})`);
  for (const d of s.deps) if (d >= s.day) throw new Error(`dependência inválida no dia ${s.day}`);
}

// ── SQL seed ──
const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;
const L = [];
L.push('-- GERADO por scripts/build-content.mjs a partir de content/*.mjs. Não edite à mão.');
L.push('begin;');
for (const l of levels) L.push(`insert into public.levels (slug, position, title, emoji, color, objective, description) values (${q(l.slug)}, ${l.position}, ${q(l.title)}, ${q(l.emoji)}, ${q(l.color)}, ${q(l.objective)}, ${q(l.description)}) on conflict (slug) do update set position=excluded.position, title=excluded.title, emoji=excluded.emoji, color=excluded.color, objective=excluded.objective, description=excluded.description;`);
for (const s of sessions) {
  const sc = s.scenarios.map(([area, text]) => ({ area, text }));
  L.push(`insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (${s.day}, ${q(s.level)}, ${q(s.title)}, ${q(s.why)}, ${j(s.learn)}, ${j(sc)}, ${j(s.tools)}, ${q(s.connection)}, ${s.minutes}, ${q(s.date)}, ${s.week}) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;`);
}
L.push('delete from public.session_dependencies;');
for (const s of sessions) for (const d of s.deps) L.push(`insert into public.session_dependencies (day, requires_day) values (${s.day}, ${d});`);
for (const s of sessions) s.exercises.forEach((e, i) => {
  e.id = `d${String(s.day).padStart(2, '0')}-e${i + 1}`;
  L.push(`insert into public.exercises (id, session_day, position, title, instructions, deliverable) values (${q(e.id)}, ${s.day}, ${i + 1}, ${q(e.title)}, ${q(e.instructions)}, ${q(e.deliverable)}) on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;`);
});
for (const t of templates) {
  const filename = t.kind === 'excel' ? t.url.split('/').pop() : `${t.slug}.${t.file}`;
  L.push(`insert into public.templates (slug, kind, title, description, content, url, filename) values (${q(t.slug)}, ${q(t.kind)}, ${q(t.title)}, ${q(t.description)}, ${q(t.content)}, ${q(t.url)}, ${q(filename)}) on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;`);
}
for (const r of resources) L.push(`insert into public.resources (slug, category, title, url, description) values (${q(r.slug)}, ${q(r.category)}, ${q(r.title)}, ${q(r.url)}, ${q(r.description)}) on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;`);
L.push('delete from public.session_templates; delete from public.session_resources;');
for (const s of sessions) {
  s.templates.forEach((t, i) => L.push(`insert into public.session_templates (session_day, template_slug, position) values (${s.day}, ${q(t)}, ${i});`));
  s.resources.forEach((r, i) => L.push(`insert into public.session_resources (session_day, resource_slug, position) values (${s.day}, ${q(r)}, ${i});`));
}
for (const w of weekly) {
  const day = sessions.find((s) => s.weekly === w.week).day;
  const start = bdays[(w.week - 1) * 5], end = bdays[w.week * 5 - 1];
  L.push(`insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (${w.week}, ${q(w.title)}, ${q(w.description)}, ${q(start)}, ${q(end)}, ${day}) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;`);
}
L.push('commit;');
out('supabase/migrations/20261106000003_seed_curriculum.sql', L.join('\n') + '\n');

// ── Arquivos de template (toolkit/templates) ──
for (const t of templates) {
  if (t.kind === 'excel') continue;
  const body = t.kind === 'diagram' ? `\`\`\`mermaid\n${t.content}\n\`\`\`\n` : t.content + '\n';
  out(`toolkit/templates/${t.kind}/${t.slug}.${t.kind === 'diagram' ? 'md' : t.file}`, t.kind === 'diagram' ? `# ${t.title}\n\n${body}` : body);
}

// ── Docs ──
const lvl = Object.fromEntries(levels.map((l) => [l.slug, l]));
const tBy = Object.fromEntries(templates.map((t) => [t.slug, t]));
const rBy = Object.fromEntries(resources.map((r) => [r.slug, r]));
const kindIcon = { sql: '🗄️', prompt: '🤖', diagram: '🧩', excel: '📗', pbix: '📊', checklist: '✅', entrega: '📦' };

// Plano de 30 dias
const P = [];
P.push('# 📅 Plano de 30 dias úteis\n');
P.push(`> Início **${fmt(bdays[0])}/${bdays[0].slice(0, 4)}** (${wd(bdays[0])}) · Fim **${fmt(bdays[29])}/${bdays[29].slice(0, 4)}** (${wd(bdays[29])}) · sem sábados e domingos · ~2h30/dia.`);
P.push('> Feriado nacional em **20/11 (Consciência Negra)**: o calendário abaixo o considera dia útil. Se sua empresa folgar, desloque o programa em 1 dia (ajuste `START_DATE` em `content/curriculum.mjs` e rode `npm run build:content`).\n');
P.push('## Visão geral (Gantt)\n');
P.push('```mermaid\ngantt\n  dateFormat  YYYY-MM-DD\n  axisFormat  %d/%m\n  excludes    weekends');
for (const l of levels) {
  P.push(`  section ${l.emoji} ${l.title}`);
  for (const s of sessions.filter((x) => x.level === l.slug)) P.push(`  D${String(s.day).padStart(2, '0')} ${s.title.replace(/[:;]/g, ' –')} :${s.weekly ? 'crit, ' : ''}${s.date}, 1d`);
}
P.push('```\n');
P.push('## Trilha e dependências\n');
P.push('Setas = "precisa estar **aprovado** pelo tutor antes". O app bloqueia sessões cujas dependências não estão concluídas.\n');
P.push('```mermaid\nflowchart LR');
for (const l of levels) {
  P.push(`  subgraph ${l.slug}["${l.emoji} ${l.title}"]`);
  for (const s of sessions.filter((x) => x.level === l.slug)) P.push(`    D${s.day}["D${s.day} · ${s.title.replace(/"/g, "'").slice(0, 38)}"]${s.weekly ? ':::entrega' : ''}`);
  P.push('  end');
}
for (const s of sessions) for (const d of s.deps) P.push(`  D${d} --> D${s.day}`);
P.push('  classDef entrega fill:#fde68a,stroke:#d97706,color:#000;\n```\n');
P.push('## Ciclo de cada dia\n');
P.push('```mermaid\nflowchart LR\n  A[📖 Conceito<br/>30 min] --> B[🧰 Ferramenta<br/>demonstração] --> C[✍️ Exercícios<br/>60–90 min] --> D[📤 Entrega no app] --> E{Tutor avalia}\n  E -- aprovado --> F[🔓 Libera próximas sessões]\n  E -- ajustes --> G[🔁 Refazer com feedback] --> D\n```\n');
P.push('## Programação diária\n');
for (let w = 1; w <= 6; w++) {
  const wk = weekly.find((x) => x.week === w);
  const ss = sessions.filter((s) => s.week === w);
  const l = lvl[ss[0].level];
  P.push(`### ${l.emoji} Semana ${w} · ${l.title} (${fmt(ss[0].date)} – ${fmt(ss[4].date)})\n`);
  P.push('| Dia | Data | Sessão | Objetivo do dia (por quê) | Depende de |\n|---|---|---|---|---|');
  for (const s of ss) P.push(`| ${s.day} | ${wd(s.date)} ${fmt(s.date)} | **${s.title}**${s.weekly ? ' 📦' : ''} | ${s.why.split('. ')[0].replace(/\|/g, '/')}. | ${s.deps.length ? s.deps.map((d) => 'D' + d).join(', ') : '—'} |`);
  P.push(`\n> 📦 **Entregável da semana ${w}:** ${wk.title} — ${wk.description} _(prazo: ${wd(ss[4].date)} ${fmt(ss[4].date)})_\n`);
}
P.push('## Entregáveis semanais\n');
P.push('```mermaid\ntimeline\n' + weekly.map((w) => `  Semana ${w.week} : ${w.title}`).join('\n') + '\n```\n');
P.push('## Critérios de avaliação (tutor)\n');
P.push('| Critério | Peso | O que o tutor observa |\n|---|---|---|\n| Correção dos números | 35% | Totais batem com a consulta/fonte de referência |\n| Raciocínio de negócio | 25% | Pergunta clara, conclusão e recomendação |\n| Técnica e boas práticas | 20% | Fórmulas/SQL/DAX/código organizados e comentados |\n| Comunicação visual | 10% | Checklist de qualidade de relatório |\n| Reprodutibilidade | 10% | Outro analista consegue refazer? |\n');
P.push('**Nota ≥ 7 = aprovado.** Nota < 7 ou lacunas → "ajustes solicitados" com feedback; o aluno refaz quantas vezes precisar.\n');
out('docs/02-plano-30-dias.md', P.join('\n'));

// Toolkit por nível
for (const l of levels) {
  const ss = sessions.filter((s) => s.level === l.slug);
  const D = [];
  D.push(`# ${l.emoji} Toolkit ${l.title}\n`);
  D.push(`> **Objetivo do nível:** ${l.objective}\n>\n> ${l.description}\n`);
  D.push('```mermaid\nflowchart LR\n' + ss.map((s, i) => `  D${s.day}["D${s.day}<br/>${s.title.replace(/"/g, "'").slice(0, 28)}"]` + (i ? `\n  D${ss[i - 1].day} --> D${s.day}` : '')).join('\n') + '\n```\n');
  for (const s of ss) {
    D.push(`---\n\n## Dia ${s.day} · ${wd(s.date)} ${fmt(s.date)} — ${s.title}${s.weekly ? ' 📦' : ''}\n`);
    D.push(`⏱️ ${s.minutes} min · Depende de: ${s.deps.length ? s.deps.map((d) => 'Dia ' + d).join(', ') : 'nenhuma'}\n`);
    D.push(`### 1) Conceitual\n**Por quê?** ${s.why}\n\n**O que você vai aprender**\n${s.learn.map((x) => `- ${x}`).join('\n')}\n\n**Cenários de uso**\n${s.scenarios.map(([a, t]) => `- **${a}:** ${t}`).join('\n')}\n`);
    D.push(`### 2) Conexão com as ferramentas\n${s.connection}\n\nFerramentas: ${s.tools.join(' · ')}\n`);
    D.push(`### 3) Exercícios\n${s.exercises.map((e, i) => `${i + 1}. **${e.title}** — ${e.instructions}  \n   _Entrega:_ ${e.deliverable}`).join('\n')}\n`);
    D.push(`### 4) Templates\n${s.templates.map((t) => { const x = tBy[t]; const p = x.kind === 'excel' ? `web/public/templates/${x.url.split('/').pop()}` : `toolkit/templates/${x.kind}/${x.slug}.${x.kind === 'diagram' ? 'md' : x.file}`; return `- ${kindIcon[x.kind]} [${x.title}](../${p}) — ${x.description}`; }).join('\n')}\n`);
    D.push(`### 5) Recursos\n${s.resources.map((r) => { const x = rBy[r]; const u = x.url.startsWith('/') ? `../web/public${x.url}` : x.url.startsWith('{{') ? '(URL do Supabase informada pelo tutor)' : x.url; return `- [${x.title}](${u}) — ${x.description}`; }).join('\n')}\n`);
    if (s.weekly) D.push(`> 📦 **Entregável semanal ${s.weekly}:** ${weekly[s.weekly - 1].title} — ${weekly[s.weekly - 1].description}\n`);
  }
  out(`docs/toolkit-${l.slug}.md`, D.join('\n'));
}

console.log(`OK: ${sessions.length} sessões, ${sessions.reduce((n, s) => n + s.exercises.length, 0)} exercícios, ${templates.length} templates, ${resources.length} recursos. ${bdays[0]} → ${bdays[29]}`);
