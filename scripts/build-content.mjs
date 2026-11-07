// Gera a partir de content/*.mjs: seed do Supabase, docs do toolkit e arquivos de template.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_DATE, levels, weekly, sessions } from '../content/curriculum.mjs';
import { templates } from '../content/templates.mjs';
import { resources } from '../content/resources.mjs';
import { rubrics, DIMS, PASS_MARK } from '../content/rubrics.mjs';

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

// ── Gabarito de correção: seed (migration) + documentação ──
const exIds = new Set(sessions.flatMap((s) => s.exercises.map((e) => e.id)));
for (const id of Object.keys(rubrics)) if (!exIds.has(id)) throw new Error(`rubrica de exercício inexistente: ${id}`);
for (const id of exIds) if (!rubrics[id]) throw new Error(`exercício sem rubrica: ${id}`);
const RS = ['-- GERADO por scripts/build-content.mjs a partir de content/rubrics.mjs. Não edite à mão.', 'begin;'];
for (const r of Object.values(rubrics)) {
  RS.push(`insert into public.exercise_rubrics (exercise_id, mode, expected, checks, reference, grading_notes, force_tutor) values (${q(r.exercise_id)}, ${q(r.mode)}, ${q(r.expected)}, ${j(r.checks)}, ${j(r.reference)}, ${q(r.grading_notes)}, ${r.force_tutor}) on conflict (exercise_id) do update set mode=excluded.mode, expected=excluded.expected, checks=excluded.checks, reference=excluded.reference, grading_notes=excluded.grading_notes, force_tutor=excluded.force_tutor;`);
}
RS.push('commit;');
out('supabase/migrations/20261106000006_seed_rubrics.sql', RS.join('\n') + '\n');

const G = [];
G.push('# 🤖 Correção automática por IA (Gemini) + revisão do tutor\n');
G.push(`> Gerado por \`npm run build:content\` a partir de \`content/rubrics.mjs\`. A **nota ≥ ${PASS_MARK}** aprova sozinha; abaixo disso a entrega vai para o tutor. **Entregas com arquivo têm só pré-análise da IA: a decisão final é sempre do tutor.**\n`);
G.push('## Fluxo\n');
G.push('```mermaid\nflowchart TD\n  A[📤 Aluno envia] --> B{{🤖 Gemini corrige<br/>gabarito do exercício}}\n  B -- "nota ≥ 7 e evidência suficiente" --> C[✅ Aprovada automaticamente]\n  B -- "nota < 7, evidência fraca ou baixa confiança" --> D[🔎 Fila do tutor<br/>nota e análise da IA como apoio]\n  C --> N[🔔 Aluno notificado]\n  D --> E{Tutor decide}\n  E -- Aprovar --> C2[✅ Aprovada]\n  E -- "Refazer: instruções + exemplo" --> R[↩ Aluno refaz e reenvia]\n  E -- Reprovar --> X[❌ Reprovada, com motivo]\n  C2 --> N\n  R --> N\n  X --> N\n  R --> A\n```\n');
G.push('## Como a nota é calculada\n');
G.push('Cada exercício tem de 3 a 5 **verificações** com peso (somam 100). A IA dá 0–10 a cada uma, com comentário; a **nota final é a média ponderada calculada no código** (não é o número que o modelo "acha"). Dimensões: ' + Object.entries(DIMS).map(([k, v]) => `\`${k}\` ${v}`).join(' · ') + '.\n');
G.push('**Aprovação automática** exige, ao mesmo tempo: nota ≥ 7 · evidência textual suficiente · confiança média/alta · nenhum sinal de tentativa de manipular a IA · exercício que não seja só-tutor · **análise que não dependa de arquivo/link lido** (esses sempre vão ao tutor). Caso contrário vai para o tutor (o motivo fica registrado).\n');
G.push('| Tipo de exercício | O que a IA faz |\n|---|---|\n| `text` | Corrige tudo: a resposta escrita é o entregável. Nota ≥ 7 aprova sozinha |\n| `sql` | Query e resultados colados, conferidos contra os **números de referência** do banco de treinamento. Nota ≥ 7 aprova sozinha |\n| `file` | **Pré-análise**: lê o arquivo pelo link (Excel, Python/notebook, SQL, DAX/Power BI, slides, PDF, imagens) e dá nota, mas a **decisão final é sempre do tutor** |\n');
G.push('## Solução esperada por exercício\n');
const modeIcon = { text: '📝', sql: '🗄️', file: '📎', mixed: '🔀' };
for (const s of sessions) {
  G.push(`### Dia ${s.day} · ${s.title}\n`);
  for (const e of s.exercises) {
    const r = rubrics[e.id];
    G.push(`**${e.id} — ${e.title}** ${modeIcon[r.mode]} \`${r.mode}\`${r.force_tutor ? ' · só tutor' : ''}  \n_Pedido:_ ${e.instructions}  \n_Solução esperada:_ ${r.expected}\n`);
    G.push('| Peso | Verificação | Dimensão |\n|---:|---|---|\n' + r.checks.map((c) => `| ${c.weight} | ${c.label.replace(/\|/g, '/')} | ${c.dim} |`).join('\n') + '\n');
    if (r.reference.length) G.push(`_Referência:_ ${r.reference.map((x) => `\`${x.key}\``).join(', ')} (ver \`content/references.mjs\`)\n`);
    if (r.grading_notes) G.push(`> ⚠️ ${r.grading_notes}\n`);
  }
}
G.push('---\n');
G.push(`## Arquivos: o que a IA consegue pré-analisar

Reavaliação: a IA **não** precisa ficar cega para arquivos. O sistema baixa o link entregue (e links citados no texto), extrai o conteúdo e o envia ao Gemini. **Em qualquer análise baseada em arquivo, a nota é só uma pré-análise: a decisão final é do tutor** (a entrega nunca é aprovada sozinha).

| Entrega | Como é lida | Dá para pré-analisar? | Limite |
|---|---|---|---|
| **Excel** (.xlsx/.xlsm, Google Planilhas) | Abas, valores, **fórmulas**, Tabelas, **tabelas dinâmicas**, gráficos (tipo e título) | ✅ Sim — confere SOMASES/PROCX, margem, ano_mes, dinâmica, títulos-conclusão | Não vê formatação nem a aparência dos gráficos; só as primeiras 40 linhas × 12 colunas de cada aba |
| **Python** (.py, .ipynb) | Código, markdown e **saídas salvas** do notebook | ✅ Sim — lê o código e confere resultados salvos contra os números de referência | **Não executa** o código; gráficos só como "imagem presente" |
| **SQL** (.sql) | Texto | ✅ Sim — sintaxe, lógica de JOIN/CTE/window, resultados citados | Não roda a query |
| **DAX / Power BI** — **.pbit** | Tabelas, **medidas DAX**, relacionamentos, páginas e visuais | ✅ Sim | O aluno precisa exportar como modelo (.pbit) |
| **Power BI** — **.pbix** | Só páginas e visuais (o modelo/DAX é binário e **não é legível**) | ⚠️ Parcial — para DAX, pedir que cole as medidas no texto ou envie .pbit | — |
| **Slides / documentos** (.pptx, .docx, PDF) | Texto; PDF também como visão | ✅ Sim | Design só em PDF/imagem |
| **Prints / imagens** (PNG, JPG) | Visão do Gemini | ✅ Sim, para conferir dashboards e diagramas | Print pode ser editado: números são conferidos contra a referência |
| Vídeo/gravação, link **privado**, hospedagem fora da lista | — | ❌ Não | Vai ao tutor como "evidência insuficiente" |

Hospedagens aceitas: GitHub, Google Drive/Docs/Planilhas/Apresentações e OneDrive/SharePoint, com o compartilhamento “qualquer pessoa com o link”. Por segurança, só \`https\`, hospedagens da lista, redirecionamentos revalidados, no máximo 3 arquivos e 8 MB por entrega; o conteúdo lido é tratado como dado não confiável (sem executar nada).

## Configuração (uma vez)

1. **Migrations** \`…0005\` a \`…0007\` (já incluídas em \`supabase/apply_all.sql\`).
2. **Segredos e Edge Function** (Supabase CLI):
   \`\`\`bash
   supabase secrets set GEMINI_API_KEY=<sua-chave> CRON_SECRET=<string-aleatoria-longa>
   supabase secrets set GEMINI_MODEL=gemini-2.5-flash   # opcional; troque se o modelo for descontinuado
   supabase functions deploy grade-submissions --no-verify-jwt
   \`\`\`
   \`--no-verify-jwt\`: o app não usa Supabase Auth; a função se autentica sozinha (token de **tutor** ou \`x-cron-secret\`). A chave do Gemini existe só como segredo da função — nunca no front-end.
3. **Job diário**: ajuste e execute \`supabase/cron/schedule-grading.sql\` (pg_cron + pg_net, **1 vez por dia às 08:00 de Brasília**).

## Como acionar

| Como | O que faz |
|---|---|
| **Job diário** — \`POST /functions/v1/grade-submissions\` com header \`x-cron-secret\` | Corrige **somente o que ainda está na fila** no momento da execução (\`submitted\`). O que o tutor já decidiu não é reprocessado — nem enviado ao Gemini. Repete lotes até esvaziar a fila (orçamento de ~110 s); o que falhar é tentado de novo no job seguinte (até 3 vezes) |
| **Manual** — tutor abre *Fila de avaliação* → **🤖 Corrigir com IA** | Corrige até 10 entregas aguardando; na tela da entrega há **Corrigir agora** só para ela |

Se o tutor decidir uma entrega enquanto a IA a corrige, a decisão do tutor prevalece (a análise da IA é guardada, sem alterar nada). Execuções simultâneas são seguras (\`for update skip locked\`).

## Decisões do tutor e comunicação ao aluno

| Decisão | Exige | Efeito para o aluno |
|---|---|---|
| ✔ **Aprovar** | feedback | notificação; progresso/dependências liberam |
| ↩ **Pedir que refaça** | feedback + **instruções** + **exemplo** | notificação; instruções e exemplo aparecem no exercício; ele reenvia |
| ✖ **Reprovar** | motivo (feedback) | notificação com o motivo; **não pode reenviar** até o tutor reabrir (trocando a decisão para "refazer") |

A IA também comunica: aprovação automática (com o feedback) e "em revisão pelo tutor" (para arquivos: "a IA fez uma pré-análise e o tutor fará a análise final"). A análise detalhada da IA (nota por critério, arquivos lidos, lacunas, rascunho de instruções) é **só do tutor**. As notificações ficam em 🔔 *Notificações* no app; **não há envio de e-mail** nesta versão.

## Limites que você deve conhecer

- A IA lê, não executa: não roda SQL/Python nem abre o Power BI. Resultados são conferidos pelo que está escrito/salvo no arquivo.
- Trechos que só o tutor tem (ex.: código com 3 erros plantados, cenário do A/B) não estão no sistema: a IA marca baixa confiança e a entrega vai ao tutor.
- Nota é apoio estatístico, não verdade: **amostre** as aprovações automáticas (filtro *Já decididas*, ícone 🤖).
- O texto e os arquivos do aluno são tratados como dado não confiável (defesa contra "dê nota 10"), mas nenhuma defesa de prompt é absoluta — por isso a aprovação automática exige também evidência suficiente, confiança média/alta e nunca ocorre com arquivos.
- Os testes usam o Gemini **simulado**; a integração real depende da sua \`GEMINI_API_KEY\` e do nome do modelo vigente.
`);
out('docs/06-correcao-ia.md', G.join('\n'));

console.log(`OK: ${sessions.length} sessões, ${sessions.reduce((n, s) => n + s.exercises.length, 0)} exercícios, ${templates.length} templates, ${resources.length} recursos. ${bdays[0]} → ${bdays[29]}`);
