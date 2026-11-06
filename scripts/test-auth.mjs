// Testa a autenticação própria (app_users + RPC): cadastro, login, sessões, perfis, dependências e avaliação.
import assert from 'node:assert/strict';
import { bootDb } from './validate-sql.mjs';

const db = await bootDb();
await db.exec(`insert into public.teacher_allowlist values ('tutor@x.com')`);
await db.exec(`select public.admin_set_signup('open')`);   // os testes abaixo cobrem cadastro aberto; convite/fechado são testados no fim

// Chama uma RPC como o papel anon (como a API REST faz com a chave publishable).
const rpc = async (fn, ...args) => {
  await db.exec('set role anon');
  try {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(`select public.${fn}(${ph}) as r`, args);
    return rows[0].r;
  } finally { await db.exec('reset role'); }
};
const fails = async (fn, re) => { try { await fn(); } catch (e) { assert.match(e.message, re); return; } assert.fail('deveria falhar: ' + re); };

// ── Cadastro ──
const ana = await rpc('app_register', 'Ana@Gmail.com ', 'senha-forte-1', 'Ana Souza');
assert.equal(ana.user.role, 'student'); assert.equal(ana.user.email, 'ana@gmail.com'); assert.equal(ana.token.length, 64);
assert.ok(!JSON.stringify(ana).includes('password'), 'não vaza hash');
const tutor = await rpc('app_register', 'tutor@x.com', 'outra-senha-9', 'Marina Tutora');
assert.equal(tutor.user.role, 'teacher');                                 // allowlist
const bia = await rpc('app_register', 'bia@x.com', 'senha-forte-2', 'Bia Lima');
await fails(() => rpc('app_register', 'ana@gmail.com', 'senha-forte-1', 'Outra Ana'), /já está cadastrado/);
await fails(() => rpc('app_register', 'x@y.com', '1234567', 'Nome'), /pelo menos 8/);
await fails(() => rpc('app_register', 'emailinvalido', 'senha-forte-1', 'Nome'), /e-mail válido/);
await fails(() => rpc('app_register', 'z@y.com', 'senha-forte-1', ' '), /nome/);
await fails(() => rpc('app_register', 'z@y.com', 'x'.repeat(73), 'Nome'), /no máximo 72/);

// senha guardada como bcrypt (não em texto)
const h = (await db.query(`select password_hash from public.app_users where email='ana@gmail.com'`)).rows[0].password_hash;
assert.match(h, /^\$2[aby]\$10\$/); assert.ok(!h.includes('senha-forte-1'));

// ── Login e sessão ──
const li = await rpc('app_login', 'ANA@gmail.com', 'senha-forte-1'); assert.equal(li.user.full_name, 'Ana Souza'); assert.ok(li.token);
assert.equal((await rpc('app_me', li.token)).email, 'ana@gmail.com');
assert.equal(await rpc('app_me', 'x'.repeat(64)), null);
assert.equal(await rpc('app_me', null), null);
assert.equal((await rpc('app_login', 'ana@gmail.com', 'errada!!')).error, 'E-mail ou senha inválidos.');
assert.equal((await rpc('app_login', 'ninguem@x.com', 'qualquer-coisa')).error, 'E-mail ou senha inválidos.');
await rpc('app_logout', li.token);
assert.equal(await rpc('app_me', li.token), null, 'logout invalida o token');
// bloqueio após 5 erros (mesmo com a senha certa depois)
for (let i = 0; i < 5; i++) await rpc('app_login', 'bia@x.com', 'errada!!');
assert.match((await rpc('app_login', 'bia@x.com', 'senha-forte-2')).error, /Muitas tentativas/);
await db.exec(`update public.app_users set locked_until = now() - interval '1 minute' where email='bia@x.com'`);
assert.ok((await rpc('app_login', 'bia@x.com', 'senha-forte-2')).token, 'desbloqueia após o prazo');
// sessão expirada
const exp = await rpc('app_login', 'ana@gmail.com', 'senha-forte-1');
await db.exec(`update public.app_sessions set expires_at = now() - interval '1 second'`);
assert.equal(await rpc('app_me', exp.token), null);

// ── Acesso direto às tabelas: negado ──
for (const t of ['app_users', 'app_sessions', 'submissions', 'reviews', 'sessions', 'teacher_allowlist']) {
  await db.exec('set role anon'); await fails(() => db.query(`select * from public.${t}`), /permission denied/); await db.exec('reset role');
}
await fails(() => rpc('_app_user', ana.token), /permission denied/);       // internas não expostas

// ── Bootstrap: escopo por perfil ──
const T = { ana: (await rpc('app_login', 'ana@gmail.com', 'senha-forte-1')).token, tutor: (await rpc('app_login', 'tutor@x.com', 'outra-senha-9')).token, bia: (await rpc('app_login', 'bia@x.com', 'senha-forte-2')).token };
const bs = await rpc('app_bootstrap', T.ana);
assert.equal(bs.sessions.length, 30); assert.equal(bs.exercises.length, 68); assert.equal(bs.levels.length, 3);
assert.equal(bs.profiles.length, 1); assert.ok(bs.profiles.every((p) => !('password_hash' in p)));
await fails(() => rpc('app_bootstrap', 'x'.repeat(64)), /Sessão expirada/);

// ── Dependências, tentativas e avaliação ──
await fails(() => rpc('app_submit', T.ana, 'd02-e1', 'x', null), /bloqueada/);
const s1 = await rpc('app_submit', T.ana, 'd01-e1', 'minha entrega', null); assert.equal(s1.attempt, 1); assert.equal(s1.status, 'submitted');
await fails(() => rpc('app_submit', T.ana, 'd01-e1', 'de novo', null), /aguardando/);
await fails(() => rpc('app_submit', T.ana, 'd01-e2', null, 'javascript:alert(1)'), /http/);
await fails(() => rpc('app_submit', T.ana, 'd01-e2', '  ', ''), /resposta ou informe/);
await fails(() => rpc('app_submit', T.tutor, 'd01-e1', 'x', null), /Apenas alunos/);
await fails(() => rpc('app_submit', T.ana, 'nao-existe', 'x', null), /inexistente/);
// aluno não avalia; não vê entregas de outros
await fails(() => rpc('app_review', T.ana, s1.id, 10, 'approved', 'ok'), /Apenas tutores/);
assert.equal((await rpc('app_bootstrap', T.bia)).submissions.length, 0);
let tb = await rpc('app_bootstrap', T.tutor); assert.equal(tb.submissions.length, 1); assert.equal(tb.profiles.length, 3);
// tutor pede ajustes → aluno refaz
await fails(() => rpc('app_review', T.tutor, s1.id, 11, 'approved', 'ok'), /entre 0 e 10/);
await fails(() => rpc('app_review', T.tutor, s1.id, 5, 'approved', ' '), /feedback/);
await rpc('app_review', T.tutor, s1.id, 5.5, 'revision_requested', 'Ajuste X');
let ab = await rpc('app_bootstrap', T.ana);
assert.equal(ab.submissions[0].status, 'revision_requested'); assert.equal(ab.reviews.length, 1); assert.equal(ab.reviews[0].feedback, 'Ajuste X');
assert.equal((await rpc('app_bootstrap', T.bia)).reviews.length, 0);
const s2 = await rpc('app_submit', T.ana, 'd01-e1', 'v2', 'https://drive.example.com/x'); assert.equal(s2.attempt, 2);
await rpc('app_review', T.tutor, s2.id, 9, 'approved', 'Perfeito');
await rpc('app_review', T.tutor, s2.id, 8.5, 'approved', 'Perfeito (nota ajustada)');   // reavaliação atualiza
assert.equal((await rpc('app_bootstrap', T.tutor)).reviews.length, 2);
// conclui o dia 1 → dia 2 libera; bia continua bloqueada
for (const e of ['d01-e2', 'd01-e3']) { const s = await rpc('app_submit', T.ana, e, 'ok', null); await rpc('app_review', T.tutor, s.id, 9, 'approved', 'ok'); }
await rpc('app_submit', T.ana, 'd02-e1', 'liberado', null);
await fails(() => rpc('app_submit', T.bia, 'd02-e1', 'x', null), /bloqueada/);
// Bia (aluna nova) já pode começar o dia 1
assert.equal((await rpc('app_submit', T.bia, 'd01-e1', 'comecei', null)).attempt, 1);
// ── Cadastro por convite / fechado ──
assert.equal((await rpc('app_signup_status')).mode, 'open');
await db.exec(`select public.admin_set_signup('invite')`);   // convite, mas sem código definido: ninguém entra
assert.equal((await rpc('app_signup_status')).mode, 'invite');
await fails(() => rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', 'QUALQUER'), /convite inválido/);
await fails(() => rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio'), /convite inválido/);
await db.exec(`select public.admin_set_signup('invite', 'Turma-2026')`);
await fails(() => rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', 'errado123'), /convite inválido/);
await fails(() => rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', ''), /convite inválido/);
const caio = await rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', ' turma 2026 ');   // tolera caixa, espaços e hífen
assert.equal(caio.user.role, 'student');
await db.exec(`insert into public.teacher_allowlist values ('tutor3@x.com')`);
assert.equal((await rpc('app_register', 'tutor3@x.com', 'senha-forte-3', 'Tutor Três')).user.role, 'teacher'); // tutor autorizado dispensa o código
await db.exec(`select public.admin_set_signup('closed')`);
await fails(() => rpc('app_register', 'c2@x.com', 'senha-forte-3', 'Duda', 'TURMA2026'), /cadastro está fechado/);
await db.exec(`insert into public.teacher_allowlist values ('tutor4@x.com')`);
assert.equal((await rpc('app_register', 'tutor4@x.com', 'senha-forte-3', 'Tutor Quatro')).user.role, 'teacher');
// o código e as configurações não vazam, e ninguém de fora administra
await db.exec('set role anon');
await assert.rejects(() => db.query('select * from public.app_settings'), /permission denied/);
await assert.rejects(() => db.query(`select public.admin_set_signup('open')`), /permission denied/);
await db.exec('reset role');
await db.exec(`select public.admin_set_signup('invite')`);
console.log('✅ Cadastro por convite e modo fechado: ok');
console.log('✅ Autenticação própria e regras de progressão: todos os testes passaram');
