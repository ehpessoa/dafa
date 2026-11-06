// Testa RLS + regras de progressão do schema da aplicação (PGlite).
import assert from 'node:assert/strict';
import { bootDb } from './validate-sql.mjs';

const db = await bootDb();
await db.exec(`insert into public.teacher_allowlist values ('tutor@x.com')`);
const mk = async (email) => (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, '{"full_name":"U"}') returning id`, [email])).rows[0].id;
const [tutor, ana, bia] = [await mk('Tutor@x.com'), await mk('ana@x.com'), await mk('bia@x.com')];
const roles = Object.fromEntries((await db.query('select id, role from public.profiles')).rows.map((r) => [r.id, r.role]));
assert.equal(roles[tutor], 'teacher'); assert.equal(roles[ana], 'student');

const as = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role`); }
};
const fails = async (fn, re) => { try { await fn(); } catch (e) { assert.match(e.message, re); return; } assert.fail('deveria falhar'); };
const sub = (uid, ex, content = 'minha entrega') => as(uid, () => db.query(`insert into public.submissions (exercise_id, content) values ($1,$2) returning id, attempt, status`, [ex, content]));
const review = (uid, id, verdict, score) => as(uid, () => db.query(`insert into public.reviews (submission_id, score, verdict, feedback) values ($1,$2,$3,'ok') returning id`, [id, score, verdict]));

// 1) Dependência: dia 2 bloqueado
await fails(() => sub(ana, 'd02-e1'), /bloqueada/);
// 2) Dia 1 liberado; tentativa e status forçados
let r = (await sub(ana, 'd01-e1')).rows[0];
assert.equal(r.attempt, 1); assert.equal(r.status, 'submitted');
// 3) Reenvio bloqueado enquanto aguarda avaliação
await fails(() => sub(ana, 'd01-e1'), /aguardando/);
// 4) Aluno não avalia; não vê entrega de outro aluno
await fails(() => review(ana, r.id, 'approved', 10), /(Apenas tutores|row-level)/);
assert.equal((await as(bia, () => db.query('select * from public.submissions'))).rows.length, 0);
assert.equal((await as(tutor, () => db.query('select * from public.submissions'))).rows.length, 1);
// 5) Aluno não consegue forjar status/aluno
await fails(() => as(ana, () => db.query(`update public.submissions set status='approved' where id=$1`, [r.id])).then((x) => { if (x.affectedRows === 0) throw new Error('row-level: 0 rows'); }), /row-level/);
// 6) Tutor pede ajustes → aluno refaz (tentativa 2)
await review(tutor, r.id, 'revision_requested', 5);
assert.equal((await db.query('select status from public.submissions where id=$1', [r.id])).rows[0].status, 'revision_requested');
r = (await sub(ana, 'd01-e1', 'v2')).rows[0]; assert.equal(r.attempt, 2);
assert.equal((await as(ana, () => db.query('select count(*)::int n from public.reviews'))).rows[0].n, 1);
assert.equal((await as(bia, () => db.query('select count(*)::int n from public.reviews'))).rows[0].n, 0);
await review(tutor, r.id, 'approved', 8.5);
// 7) Conclui todos os exercícios do dia 1 → dia 2 libera
for (const e of ['d01-e2', 'd01-e3']) { const s = (await sub(ana, e)).rows[0]; await review(tutor, s.id, 'approved', 9); }
assert.equal((await as(ana, () => db.query(`select public.session_done($1,1) d, public.session_unlocked($1,2) u`, [ana]))).rows[0].u, true);
await sub(ana, 'd02-e1');
// 8) Bia continua bloqueada
await fails(() => sub(bia, 'd02-e1'), /bloqueada/);
// 9) Aluno não altera currículo nem role
await fails(() => as(ana, () => db.query(`update public.sessions set title='x'`)).then((x) => { if (!x.affectedRows) throw new Error('row-level'); }), /row-level/);
await fails(() => as(ana, () => db.query(`insert into public.levels (slug, position, title) values ('x',9,'x')`)), /row-level/);
assert.equal((await as(ana, () => db.query(`update public.profiles set role='teacher' where id=$1`, [ana]))).affectedRows, 0);
// 10) anon sem acesso
await db.exec(`set role anon`); await fails(() => db.query('select * from public.sessions'), /permission denied/); await db.exec('reset role');
console.log('✅ RLS e regras de progressão: todos os testes passaram');
