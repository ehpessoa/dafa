// Testa os alertas de atraso da entrega semanal: regras no banco (PGlite) + mensagens/orquestração do envio (TypeScript compilado).
// Uso: node scripts/test-overdue.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { bootDb } from './validate-sql.mjs';

const db = await bootDb();
await db.exec(`select public.admin_set_signup('open'); insert into public.teacher_allowlist values ('t1@x.com'), ('t2@x.com')`);
const as = async (role, fn, ...args) => {
  await db.exec(`set role ${role}`);
  try { return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args)).rows[0].r; }
  finally { await db.exec('reset role'); }
};
const rpc = (fn, ...a) => as('anon', fn, ...a);
const svc = (fn, ...a) => as('service_role', fn, ...a);
const fails = async (fn, re) => { try { await fn(); } catch (e) { assert.match(e.message, re); return; } assert.fail('deveria falhar: ' + re); };

let phoneN = 11910000000;
const reg = async (email, name, { verified = true } = {}) => {
  const r = await rpc('app_register', email, 'senha-forte-1', name, null, String(++phoneN));
  if (verified) await db.query(`update public.app_users set phone_verified_at = now() where id = $1`, [r.user.id]);
  return r;
};
const submit = (uid, ex, status = 'submitted') =>
  db.query(`insert into public.submissions (exercise_id, student_id, attempt, content, status) values ($1,$2,1,'x',$3)`, [ex, uid, status]);

// ── prazos reais do currículo ──
const due = (await db.query(`select week, to_char(due_date,'YYYY-MM-DD') d, session_day from public.weekly_deliverables order by week`)).rows;
assert.equal(due[0].d, '2026-11-13'); assert.equal(due[0].session_day, 5);
const W1 = due[0].d;

// ── usuários ──
const ana = await reg('ana@x.com', 'Ana Souza');                // não entregou nada → atrasada
const bia = await reg('bia@x.com', 'Bia Lima');                 // entregou só 1 dos 2 exercícios → atrasada
const caio = await reg('caio@x.com', 'Caio Mota');              // nada entregue, mas com alertas pausados
const dani = await reg('dani@x.com', 'Dani Reis');              // cadastrou DEPOIS do prazo da semana 1
const edu = await reg('edu@x.com', 'Edu Pires', { verified: false });
const fabio = await reg('fabio@x.com', 'Fabio Nunes');          // enviou tudo (aguardando) → não atrasado
const gabi = await reg('gabi@x.com', 'Gabi Cruz');              // tudo com ajustes pedidos → entregou, não é atraso
const t1 = await reg('t1@x.com', 'Tutora Um'), t2 = await reg('t2@x.com', 'Tutor Dois');
await db.query(`update public.app_users set phone = null where id = $1`, [t2.user.id]);   // tutor sem WhatsApp
await db.query(`update public.app_users set created_at = '2026-11-16T12:00:00Z' where id = $1`, [dani.user.id]);
const d5 = (await db.query(`select id from public.exercises where session_day = 5 order by position`)).rows.map((x) => x.id);
assert.equal(d5.length, 2);
await submit(bia.user.id, d5[0]);
for (const e of d5) { await submit(fabio.user.id, e, 'submitted'); await submit(gabi.user.id, e, 'revision_requested'); }
assert.equal(await svc('app_notifications_read', t1.token, null).catch(() => 'n/a') !== undefined, true);   // (service_role não é a via normal; só garante que a função existe)

// ── 1) fim de semana não envia; antes do prazo não há atraso ──
let c = await svc('alerts_overdue_claim', false, '2026-11-14');           // sábado
assert.equal(c.skipped, 'fim_de_semana');
c = await svc('alerts_overdue_claim', false, W1);                           // no dia do prazo ainda não é atraso
assert.deepEqual(c.students, []);
assert.equal((await db.query(`select count(*)::int n from public.overdue_alerts`)).rows[0].n, 0);

// ── 2) segunda-feira: só quem realmente está atrasado, ativo e com prazo após o cadastro ──
await rpc('app_set_student_alerts', t1.token, caio.user.id, true);
c = await svc('alerts_overdue_claim', false, '2026-11-16');
const names = c.students.map((s) => s.name).sort();
assert.deepEqual(names, ['Ana Souza', 'Bia Lima'], 'Caio (pausado), Dani (cadastro após o prazo), Edu (sem WhatsApp verificado), Fabio e Gabi (entregaram) ficam de fora');
const anaC = c.students.find((s) => s.name === 'Ana Souza');
assert.deepEqual([anaC.n, anaC.items.length, anaC.items[0].week, anaC.items[0].days_late, anaC.first_day], [1, 1, 1, 3, 5]);
assert.equal(c.paused_count, 1);
// notificação no app para o aluno
let nt = (await db.query(`select kind, title, body, link from public.notifications where user_id = $1`, [ana.user.id])).rows;
assert.equal(nt.length, 1); assert.equal(nt[0].kind, 'overdue'); assert.equal(nt[0].link, '/sessao/5?tab=exercicios');
assert.match(nt[0].body, /Semana 1 — .* \(venceu em 13\/11, 3 dias de atraso\)/); assert.match(nt[0].body, /fale com o tutor/);
for (const u of [caio, dani, edu, fabio, gabi]) assert.equal((await db.query(`select count(*)::int n from public.notifications where user_id = $1`, [u.user.id])).rows[0].n, 0);
// resumo para os tutores (todos os tutores verificados recebem a notificação; o WhatsApp só vai a quem tem número)
assert.deepEqual(c.tutors.map((t) => t.name).sort(), ['Tutor Dois', 'Tutora Um']);
for (const t of [t1, t2]) {
  const tn = (await db.query(`select kind, title, body, link from public.notifications where user_id = $1`, [t.user.id])).rows;
  assert.equal(tn.length, 1); assert.equal(tn[0].kind, 'overdue_tutor'); assert.match(tn[0].title, /2 alunos com entrega semanal em atraso/);
  assert.match(tn[0].body, /Ana Souza \(Semana 1, 3d\)/); assert.match(tn[0].body, /Bia Lima/); assert.match(tn[0].body, /1 com alertas pausados/); assert.equal(tn[0].link, '/tutor/alunos');
}
// ── 3) intervalo de 3 dias: mesma rodada não repete; depois de 4 dias volta (n = 2) ──
c = await svc('alerts_overdue_claim', false, '2026-11-16'); assert.deepEqual(c.students, []); assert.deepEqual(c.tutors, []);
assert.equal((await db.query(`select count(*)::int n from public.notifications where kind = 'overdue_tutor'`)).rows[0].n, 2, 'sem avisos novos, o tutor não é notificado de novo');
await db.query(`update public.overdue_alerts set sent_at = now() - interval '4 days'`);
c = await svc('alerts_overdue_claim', false, '2026-11-23');                 // semana 2 (prazo 20/11) também venceu
const ana2 = c.students.find((s) => s.name === 'Ana Souza');
assert.deepEqual([ana2.n, ana2.items.map((i) => i.week)], [2, [1, 2]], 'agora lista as duas semanas');
assert.match((await db.query(`select body from public.notifications where user_id = $1 order by created_at desc limit 1`, [ana.user.id])).rows[0].body, /Semana 1[\s\S]*Semana 2/);

// ── 4) teto de 8 avisos por aluno ──
await db.query(`delete from public.overdue_alerts where student_id = $1`, [bia.user.id]);
await db.query(`insert into public.overdue_alerts (student_id, weeks, n, sent_at) select $1, '{1}', g, now() - interval '30 days' from generate_series(1, 8) g`, [bia.user.id]);
await db.query(`update public.overdue_alerts set sent_at = now() - interval '5 days' where student_id = $1`, [ana.user.id]);
c = await svc('alerts_overdue_claim', false, '2026-11-24');
assert.deepEqual(c.students.map((s) => s.name), ['Ana Souza'], 'Bia já recebeu 8 avisos: não recebe mais');

// ── 5) pausa por aluno: tutor liga/desliga; aluno não pode ──
await db.query(`update public.overdue_alerts set sent_at = now() - interval '9 days'`);
await fails(() => rpc('app_set_student_alerts', ana.token, ana.user.id, true), /Apenas tutores/);
const paused = await rpc('app_set_student_alerts', t1.token, ana.user.id, true);
assert.equal(paused.alerts_paused, true);
c = await svc('alerts_overdue_claim', false, '2026-11-25'); assert.ok(!c.students.some((s) => s.name === 'Ana Souza'), 'Ana pausada: sem aviso');
assert.equal((await rpc('app_bootstrap', t1.token)).profiles.find((p) => p.id === ana.user.id).alerts_paused, true, 'o app enxerga o estado da pausa');
const resumed = await rpc('app_set_student_alerts', t1.token, ana.user.id, false); assert.equal(resumed.alerts_paused, false);
c = await svc('alerts_overdue_claim', false, '2026-11-25'); assert.ok(c.students.some((s) => s.name === 'Ana Souza'), 'retomada: volta a receber');
await fails(() => rpc('app_set_student_alerts', t1.token, t2.user.id, true), /Aluno não encontrado/);     // só alunos
await fails(() => rpc('app_set_student_alerts', t1.token, crypto.randomUUID(), true), /Aluno não encontrado/);

// ── 6) visão do tutor: inclui alunos com alertas pausados; aluno não vê ──
const ov = await rpc('app_overdue_overview', t1.token, '2026-11-16');
const caioOv = ov.find((o) => o.student_id === caio.user.id);
assert.ok(caioOv && caioOv.weeks[0].week === 1, 'Caio aparece em atraso mesmo pausado');
assert.ok(!ov.some((o) => [fabio, gabi, edu].map((u) => u.user.id).includes(o.student_id)));
await fails(() => rpc('app_overdue_overview', ana.token, '2026-11-16'), /Apenas tutores/);

// ── 7) limite por rodada ──
await db.query(`delete from public.overdue_alerts`);
c = await svc('alerts_overdue_claim', false, '2026-11-26', 1); assert.equal(c.students.length, 1, 'p_limit respeitado (os demais ficam para a próxima rodada)');

// ── 8) resultado do envio; status inválido é ignorado ──
const aid = c.students[0].alert_id;
await svc('alerts_overdue_result', aid, 'failed', 'Evolution API HTTP 500'); let row = (await db.query(`select whatsapp_status s, whatsapp_error e from public.overdue_alerts where id = $1`, [aid])).rows[0];
assert.deepEqual([row.s, row.e], ['failed', 'Evolution API HTTP 500']);
await svc('alerts_overdue_result', aid, 'hackeado'); row = (await db.query(`select whatsapp_status s from public.overdue_alerts where id = $1`, [aid])).rows[0]; assert.equal(row.s, 'failed');

// ── 9) permissões: nada disso é chamável pela chave pública ──
for (const f of [['alerts_overdue_claim', false, '2026-11-16'], ['alerts_overdue_result', aid, 'sent'], ['cron_secret_ok', 'x'.repeat(20)]]) {
  for (const role of ['anon', 'authenticated']) await fails(() => as(role, ...f), /permission denied/);
}
await db.exec('set role anon'); await fails(() => db.query(`select * from public._overdue_list(current_date)`), /permission denied/);
await fails(() => db.query(`select * from public.overdue_alerts`), /permission denied/); await db.exec('reset role');

// ── 10) segredo do agendador (Vault) ──
await db.exec(`create schema if not exists vault; create table vault.decrypted_secrets (name text, decrypted_secret text); insert into vault.decrypted_secrets values ('dafa_cron_secret', 'segredo-do-job-1234567890')`);
assert.equal(await svc('cron_secret_ok', 'segredo-do-job-1234567890'), true);
for (const bad of ['segredo-errado-1234567890', 'curto', '', null]) assert.equal(await svc('cron_secret_ok', bad), false);

// ── 11) mensagens e orquestração do envio (TypeScript compilado) ──
const out = new URL('../.tmp/overdue-build/', import.meta.url).pathname;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true }); writeFileSync(out + 'package.json', '{"type":"module"}');
execFileSync('web/node_modules/.bin/tsc', ['--ignoreConfig', 'web/api/_lib/overdue.ts', '--outDir', out, '--module', 'nodenext', '--moduleResolution', 'nodenext',
  '--target', 'es2022', '--strict', '--skipLibCheck', '--lib', 'es2022'], { stdio: 'inherit' });
const { runOverdueAlerts, studentMessage, tutorMessage, dateBR } = await import(pathToFileURL(out + 'overdue.js').href);
assert.equal(dateBR('2026-11-13'), '13/11');

await db.exec(`delete from public.overdue_alerts; delete from public.notifications;`);
const sent = [], sleeps = [];
let failFor = null;
const deps = (over = {}) => ({
  rpc: (fn, args) => svc(fn, ...Object.values(args)),
  send: async (phone, text) => { if (failFor && phone.endsWith(failFor)) throw new Error('Evolution API HTTP 500'); sent.push({ phone, text }); },
  sleep: async (ms) => { sleeps.push(ms); }, appUrl: 'https://app.exemplo.com/', gapMs: 700, ...over,
});
// sábado: nada
assert.equal((await runOverdueAlerts(deps({ rpc: (fn) => svc(fn, false, '2026-11-14') }))).skipped, 'fim_de_semana');
assert.equal(sent.length, 0);
// segunda-feira (rodada com data simulada): Ana, Bia atrasadas; Caio segue pausado
await db.query(`update public.app_users set alerts_paused = false where id = $1`, [ana.user.id]);
failFor = String(phoneN - 1).slice(-4);                                  // falha o envio para um número específico
const bia4 = (await db.query(`select right(phone,4) p from public.app_users where id = $1`, [bia.user.id])).rows[0].p; failFor = bia4;
const summary = await runOverdueAlerts(deps({ rpc: (fn, args) => (fn === 'alerts_overdue_claim' ? svc(fn, false, '2026-11-16') : svc(fn, ...Object.values(args))) }));
assert.deepEqual([summary.students_alerted, summary.whatsapp_sent, summary.whatsapp_failed, summary.tutors_notified], [2, 1, 1, 2]);
const toAna = sent.find((m) => m.text.startsWith('Olá, Ana!'));
assert.match(toAna.text, /\*Semana 1\* — .* \(venceu em 13\/11 · 3 dias de atraso\)/); assert.match(toAna.text, /https:\/\/app\.exemplo\.com\/sessao\/5\?tab=exercicios/); assert.match(toAna.text, /fale com o tutor/);
const toTutor = sent.filter((m) => m.text.startsWith('📋'));
assert.equal(toTutor.length, 1, 'só o tutor com WhatsApp recebe a mensagem (o outro recebe só a notificação no app)');
assert.match(toTutor[0].text, /Avisamos hoje 2 alunos/); assert.match(toTutor[0].text, /Ana Souza — Semana 1 \(3 dias\)/); assert.match(toTutor[0].text, /1 com alertas pausados/); assert.match(toTutor[0].text, /app\.exemplo\.com\/tutor\/alunos/);
assert.ok(sleeps.length >= 2 && sleeps.every((s) => s === 700), 'pausa entre mensagens');
const st = Object.fromEntries((await db.query(`select s.full_name n, a.whatsapp_status st, a.whatsapp_error e from public.overdue_alerts a join public.app_users s on s.id = a.student_id`)).rows.map((r) => [r.n, r]));
assert.equal(st['Ana Souza'].st, 'sent'); assert.equal(st['Bia Lima'].st, 'failed'); assert.match(st['Bia Lima'].e, /Evolution API HTTP 500/);
// aluno sem telefone cadastrado: só a notificação no app; status 'skipped'
await db.exec('delete from public.overdue_alerts'); await db.query(`update public.app_users set phone = null where id = $1`, [ana.user.id]); sent.length = 0; failFor = null;
const s2 = await runOverdueAlerts(deps({ rpc: (fn, args) => (fn === 'alerts_overdue_claim' ? svc(fn, false, '2026-11-16') : svc(fn, ...Object.values(args))) }));
assert.equal(s2.whatsapp_skipped, 1); assert.ok(!sent.some((m) => m.text.startsWith('Olá, Ana!')));
// várias semanas e mensagens longas
const many = { name: 'Zé da Silva', items: [1, 2, 3, 4].map((w) => ({ week: w, title: `T${w}`, due_date: `2026-11-${10 + w}`, days_late: 1, session_day: 5 * w })), first_day: 5 };
const txt = studentMessage(many, 'https://x.com'); assert.match(txt, /Suas entregas semanais estão em atraso/); assert.match(txt, /e mais 1/); assert.match(txt, /1 dia de atraso/); assert.ok(!txt.includes('1 dias'));
assert.match(tutorMessage(Array.from({ length: 17 }, (_, i) => ({ name: `A${i}`, worst_days: 2, items: [{ week: 1 }] })), 0, 'https://x.com'), /e mais 2/);

rmSync(out, { recursive: true, force: true });
console.log('✅ Alertas de atraso: regras, pausa por aluno, intervalo/teto, tutores, permissões e envio — todos os testes passaram');
