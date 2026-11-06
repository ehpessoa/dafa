// Testa a autenticação própria (app_users + RPC): cadastro, login, sessões, perfis, dependências e avaliação.
import assert from 'node:assert/strict';
import { bootDb } from './validate-sql.mjs';

const db = await bootDb();
await db.exec(`insert into public.teacher_allowlist values ('tutor@x.com')`);
await db.exec(`select public.admin_set_signup('open')`);   // os testes abaixo cobrem cadastro aberto; convite/fechado são testados no fim

// Chama uma RPC como o papel anon (como a API REST faz com a chave publishable).
const rpcAs = (role) => async (fn, ...args) => {
  await db.exec(`set role ${role}`);
  try {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(`select public.${fn}(${ph}) as r`, args);
    return rows[0].r;
  } finally { await db.exec('reset role'); }
};
const rpc = rpcAs('anon'), svc = rpcAs('service_role');
const fails = async (fn, re) => { try { await fn(); } catch (e) { assert.match(e.message, re); return; } assert.fail('deveria falhar: ' + re); };

// ── Cadastro ──
const ana = await rpc('app_register', 'Ana@Gmail.com ', 'senha-forte-1', 'Ana Souza', null, '(11) 99999-8888');
assert.equal(ana.user.role, 'student'); assert.equal(ana.user.email, 'ana@gmail.com'); assert.equal(ana.token.length, 64);
assert.ok(!JSON.stringify(ana).includes('password'), 'não vaza hash');
const tutor = await rpc('app_register', 'tutor@x.com', 'outra-senha-9', 'Marina Tutora', null, '21988887777');
assert.equal(tutor.user.role, 'teacher');                                 // allowlist
const bia = await rpc('app_register', 'bia@x.com', 'senha-forte-2', 'Bia Lima', null, '(31) 98888-7777');
await fails(() => rpc('app_register', 'ana@gmail.com', 'senha-forte-1', 'Outra Ana', null, '11999998888'), /já está cadastrado/);
await fails(() => rpc('app_register', 'x@y.com', '1234567', 'Nome', null, '11999998888'), /pelo menos 8/);
await fails(() => rpc('app_register', 'emailinvalido', 'senha-forte-1', 'Nome', null, '11999998888'), /e-mail válido/);
await fails(() => rpc('app_register', 'z@y.com', 'senha-forte-1', ' ', null, '11999998888'), /nome/);
await fails(() => rpc('app_register', 'z@y.com', 'senha-forte-1', 'Nome', null, '123'), /WhatsApp válido/);
await fails(() => rpc('app_register', 'z@y.com', 'senha-forte-1', 'Nome', null, null), /WhatsApp válido/);
await fails(() => rpc('app_register', 'z@y.com', 'x'.repeat(73), 'Nome', null, '11999998888'), /no máximo 72/);

// senha guardada como bcrypt (não em texto)
const h = (await db.query(`select password_hash from public.app_users where email='ana@gmail.com'`)).rows[0].password_hash;
assert.match(h, /^\$2[aby]\$10\$/); assert.ok(!h.includes('senha-forte-1'));

// ── Login e sessão ──
const li = await rpc('app_login', 'ANA@gmail.com', 'senha-forte-1'); assert.equal(li.user.full_name, 'Ana Souza', '(11) 99999-8888'); assert.ok(li.token);
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


await db.exec(`update public.app_users set phone_verified_at = now() where email in ('ana@gmail.com','tutor@x.com','bia@x.com')`);   // (a verificação em si é testada mais abaixo)
// ── WhatsApp: telefone normalizado e funções restritas à service_role ──
assert.equal((await db.query(`select phone from public.app_users where email='ana@gmail.com'`)).rows[0].phone, '5511999998888');
assert.ok(!JSON.stringify(ana).includes('5511999998888'), 'telefone não vaza no perfil');
for (const fn of ['app_welcome_claim', 'app_wa_reset_issue']) await fails(() => rpc(fn, 'x'), /permission denied/);
await fails(() => rpc('app_welcome_release', ana.user.id), /permission denied/);
const anaTok = (await rpc('app_login', 'ana@gmail.com', 'senha-forte-1')).token;
const w = await svc('app_welcome_claim', anaTok);
assert.equal(w.phone, '5511999998888'); assert.equal(w.name, 'Ana Souza');
assert.equal(await svc('app_welcome_claim', anaTok), null, 'boas-vindas só uma vez');
await svc('app_welcome_release', w.user_id);
assert.ok(await svc('app_welcome_claim', anaTok), 'release permite reenvio');
assert.equal(await svc('app_welcome_claim', 'x'.repeat(64)), null, 'token inválido não envia');

// ── Recuperação de senha por código ──
assert.equal(await svc('app_wa_reset_issue', 'ninguem@x.com'), null);
await db.exec(`insert into public.app_users (email, full_name, password_hash) values ('velho@x.com','Sem Zap', 'x')`);
assert.equal(await svc('app_wa_reset_issue', 'velho@x.com'), null, 'conta sem WhatsApp não gera código');
const r1 = await svc('app_wa_reset_issue', 'ANA@gmail.com');
assert.match(r1.code, /^\d{6}$/); assert.equal(r1.phone, '5511999998888');
assert.ok(!(await db.query(`select code_hash from public.whatsapp_resets`)).rows[0].code_hash.includes(r1.code), 'código só como hash');
assert.equal((await svc('app_wa_reset_issue', 'ana@gmail.com')).throttled, true, '1 código por minuto');
assert.match((await rpc('app_wa_reset_confirm', 'ana@gmail.com', '000000'.replace('0', r1.code[0] === '0' ? '1' : '0'), 'nova-senha-123')).error, /inválido ou expirado/);
assert.match((await rpc('app_wa_reset_confirm', 'ana@gmail.com', r1.code, 'curta')).error, /pelo menos 8/);
assert.match((await rpc('app_wa_reset_confirm', 'ninguem@x.com', r1.code, 'nova-senha-123')).error, /inválido ou expirado/);
const sessAna = (await rpc('app_login', 'ana@gmail.com', 'senha-forte-1')).token;
assert.deepEqual(await rpc('app_wa_reset_confirm', 'ana@gmail.com', r1.code, 'nova-senha-123'), { ok: true });
assert.equal(await rpc('app_me', sessAna), null, 'reset encerra sessões antigas');
assert.equal((await rpc('app_login', 'ana@gmail.com', 'senha-forte-1')).error, 'E-mail ou senha inválidos.');
assert.ok((await rpc('app_login', 'ana@gmail.com', 'nova-senha-123')).token);
assert.match((await rpc('app_wa_reset_confirm', 'ana@gmail.com', r1.code, 'outra-senha-123')).error, /inválido ou expirado/, 'código é de uso único');
// 5 tentativas erradas invalidam o código; expiração
await db.exec(`update public.whatsapp_resets set created_at = now() - interval '2 minutes'`);
const r2 = await svc('app_wa_reset_issue', 'bia@x.com'); assert.ok(r2.code);
const wrong = r2.code === '111111' ? '222222' : '111111';
for (let i = 0; i < 5; i++) await rpc('app_wa_reset_confirm', 'bia@x.com', wrong, 'nova-senha-123');
assert.match((await rpc('app_wa_reset_confirm', 'bia@x.com', r2.code, 'nova-senha-123')).error, /inválido ou expirado/, 'bloqueado após 5 erros');
await db.exec(`update public.whatsapp_resets set created_at = now() - interval '2 minutes'`);
const r3 = await svc('app_wa_reset_issue', 'bia@x.com');
await db.exec(`update public.whatsapp_resets set expires_at = now() - interval '1 second'`);
assert.match((await rpc('app_wa_reset_confirm', 'bia@x.com', r3.code, 'nova-senha-123')).error, /inválido ou expirado/, 'código expirado');


// ── Verificação do WhatsApp no cadastro ──
const carla = await rpc('app_register', 'carla@x.com', 'senha-forte-3', 'Carla Dias', null, '(41) 97777-6666');
assert.equal(carla.user.phone_verified, false); assert.equal(carla.user.phone_hint, '6666');
await fails(() => rpc('app_bootstrap', carla.token), /Confirme seu WhatsApp/);
await fails(() => rpc('app_submit', carla.token, 'd01-e1', 'x', null), /Confirme seu WhatsApp/);
assert.equal((await rpc('app_me', carla.token)).phone_verified, false, 'app_me funciona para exibir a tela de verificação');
await fails(() => rpc('app_verify_issue', carla.token), /permission denied/);
assert.equal(await svc('app_verify_issue', 'x'.repeat(64)), null);
assert.equal(await svc('app_welcome_claim', carla.token), null, 'sem boas-vindas antes de verificar');
const v1 = await svc('app_verify_issue', carla.token);
assert.match(v1.code, /^\d{6}$/); assert.equal(v1.phone, '5541977776666');
assert.equal((await svc('app_verify_issue', carla.token)).throttled, true);
assert.ok(!(await db.query(`select code_hash from public.phone_verifications`)).rows[0].code_hash.includes(v1.code));
const bad = v1.code === '111111' ? '222222' : '111111';
assert.match((await rpc('app_verify_confirm', carla.token, bad)).error, /inválido ou expirado/);
// corrige o número → código anterior deixa de valer
assert.equal((await rpc('app_change_phone', carla.token, '(41) 96666-5555')).phone_hint, '5555');
await fails(() => rpc('app_change_phone', carla.token, '123'), /WhatsApp válido/);
assert.match((await rpc('app_verify_confirm', carla.token, v1.code)).error, /inválido ou expirado/);
await db.exec(`update public.phone_verifications set created_at = now() - interval '2 minutes'`);
const v2 = await svc('app_verify_issue', carla.token);
assert.equal(v2.phone, '5541966665555');
const ok = await rpc('app_verify_confirm', carla.token, v2.code);
assert.equal(ok.ok, true); assert.equal(ok.user.phone_verified, true);
assert.equal((await rpc('app_bootstrap', carla.token)).sessions.length, 30, 'liberado após verificar');
assert.ok(await svc('app_welcome_claim', carla.token), 'boas-vindas após verificar');
await fails(() => rpc('app_change_phone', carla.token, '11999998888'), /já foi verificado/);
assert.equal(await svc('app_verify_issue', carla.token), null, 'já verificada não recebe novo código');
// 5 erros invalidam o código
const dani = await rpc('app_register', 'dani@x.com', 'senha-forte-4', 'Dani Reis', null, '11955554444');
const v3 = await svc('app_verify_issue', dani.token);
for (let i = 0; i < 5; i++) await rpc('app_verify_confirm', dani.token, v3.code === '111111' ? '222222' : '111111');
assert.match((await rpc('app_verify_confirm', dani.token, v3.code)).error, /inválido ou expirado/);
// expirado
await db.exec(`update public.phone_verifications set created_at = now() - interval '2 minutes', attempts = 0`);
const v4 = await svc('app_verify_issue', dani.token);
await db.exec(`update public.phone_verifications set expires_at = now() - interval '1 second'`);
assert.match((await rpc('app_verify_confirm', dani.token, v4.code)).error, /inválido ou expirado/);

// ── Bootstrap: escopo por perfil ──
const T = { ana: (await rpc('app_login', 'ana@gmail.com', 'nova-senha-123')).token, tutor: (await rpc('app_login', 'tutor@x.com', 'outra-senha-9')).token, bia: (await rpc('app_login', 'bia@x.com', 'senha-forte-2')).token };
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
let tb = await rpc('app_bootstrap', T.tutor); assert.equal(tb.submissions.length, 1); assert.equal(tb.profiles.length, 6);
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
assert.match((await rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', 'QUALQUER', '11999998888')).error, /convite inválido/);
assert.match((await rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', null, '11999998888')).error, /convite inválido/);
await db.exec(`select public.admin_set_signup('invite', 'Turma-2026')`);
assert.match((await rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', 'errado123', '11999998888')).error, /convite inválido/);
assert.match((await rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', '', '11999998888')).error, /convite inválido/);
const caio = await rpc('app_register', 'c1@x.com', 'senha-forte-3', 'Caio', ' turma 2026 ', '11999998888');   // tolera caixa, espaços e hífen
assert.equal(caio.user.role, 'student');
await db.exec(`insert into public.teacher_allowlist values ('tutor3@x.com')`);
assert.equal((await rpc('app_register', 'tutor3@x.com', 'senha-forte-3', 'Tutor Três', null, '11999998888')).user.role, 'teacher'); // tutor autorizado dispensa o código
await db.exec(`select public.admin_set_signup('closed')`);
await fails(() => rpc('app_register', 'c2@x.com', 'senha-forte-3', 'Duda', 'TURMA2026', '11999998888'), /cadastro está fechado/);
await db.exec(`insert into public.teacher_allowlist values ('tutor4@x.com')`);
assert.equal((await rpc('app_register', 'tutor4@x.com', 'senha-forte-3', 'Tutor Quatro', null, '11999998888')).user.role, 'teacher');
// o código e as configurações não vazam, e ninguém de fora administra
await db.exec('set role anon');
await assert.rejects(() => db.query('select * from public.app_settings'), /permission denied/);
await assert.rejects(() => db.query(`select public.admin_set_signup('open')`), /permission denied/);
await db.exec('reset role');
await db.exec(`select public.admin_set_signup('invite')`);
console.log('✅ Cadastro por convite e modo fechado: ok');
// ── Limite de tentativas de convite ──
await db.exec(`delete from public.signup_failures`);
for (let i = 0; i < 20; i++) await rpc('app_register', `x${i}@x.com`, 'senha-forte-3', 'Xis', 'ERRADO' + i, '11999998888');
assert.match((await rpc('app_register', 'c9@x.com', 'senha-forte-3', 'Caio', 'TURMA2026', '11999998888')).error, /Muitas tentativas/);   // até o código certo fica bloqueado na janela
await db.exec(`update public.signup_failures set at = now() - interval '20 minutes'`);
assert.equal((await rpc('app_register', 'c9@x.com', 'senha-forte-3', 'Caio', 'TURMA2026', '11999998888')).user.role, 'student');         // passada a janela, volta ao normal

// ── Redefinição de senha assistida pelo tutor ──
const tutorTok = (await rpc('app_login', 'tutor@x.com', 'outra-senha-9')).token;
const alunaId = (await db.query(`select id from public.app_users where email='bia@x.com'`)).rows[0].id;
const tutorId = (await db.query(`select id from public.app_users where email='tutor@x.com'`)).rows[0].id;
await fails(() => rpc('app_teacher_reset_code', T.bia, alunaId), /Apenas tutores/);                 // aluno não gera código
await fails(() => rpc('app_teacher_reset_code', tutorTok, tutorId), /Aluno não encontrado/);        // nem para tutor
const rc = await rpc('app_teacher_reset_code', tutorTok, alunaId);
assert.match(rc.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
assert.match((await rpc('app_reset_password', 'bia@x.com', 'ERRADO-1234', 'nova-senha-77')).error, /inválido ou expirado/);
assert.match((await rpc('app_reset_password', 'bia@x.com', rc.code, 'curta')).error, /pelo menos 8/);
assert.match((await rpc('app_reset_password', 'naoexiste@x.com', rc.code, 'nova-senha-77')).error, /inválido ou expirado/);   // mesma mensagem: sem enumeração
assert.equal((await rpc('app_reset_password', 'bia@x.com', rc.code.toLowerCase().replace('-', ' '), 'nova-senha-77')).ok, true);
assert.match((await rpc('app_reset_password', 'bia@x.com', rc.code, 'outra-senha-88')).error, /inválido ou expirado/);        // uso único
assert.match((await rpc('app_login', 'bia@x.com', 'senha-forte-2')).error, /inválidos/);          // senha antiga não vale
assert.ok((await rpc('app_login', 'bia@x.com', 'nova-senha-77')).token);
assert.equal(await rpc('app_me', T.bia), null);                                                   // sessões antigas encerradas
// queima após 5 erros
const rc2 = await rpc('app_teacher_reset_code', tutorTok, alunaId);
for (let i = 0; i < 5; i++) await rpc('app_reset_password', 'bia@x.com', 'ERRADO-' + i, 'nova-senha-77');
assert.match((await rpc('app_reset_password', 'bia@x.com', rc2.code, 'outra-senha-88')).error, /inválido ou expirado/);
// expirado
const rc3 = await rpc('app_teacher_reset_code', tutorTok, alunaId);
await db.exec(`update public.password_resets set expires_at = now() - interval '1 minute'`);
assert.match((await rpc('app_reset_password', 'bia@x.com', rc3.code, 'outra-senha-88')).error, /inválido ou expirado/);
await db.exec('set role anon');
await assert.rejects(() => db.query('select * from public.password_resets'), /permission denied/);
await db.exec('reset role');
console.log('✅ Limite de convite e redefinição de senha: ok');
// ── Convites personalizados (tutor → WhatsApp → aluno define a senha) ──
await db.exec(`select public.admin_set_signup('closed')`);   // convite personalizado vale mesmo com cadastro fechado
const tutTok = (await rpc('app_login', 'tutor@x.com', 'outra-senha-9')).token;
const alunoTok = (await rpc('app_login', 'ana@gmail.com', 'nova-senha-123')).token;
await fails(() => rpc('app_invite_issue', tutTok, 'Lia', 'lia@x.com', '11999990000'), /permission denied/);   // só service_role
await fails(() => svc('app_invite_issue', alunoTok, 'Lia Costa', 'lia@x.com', '11999990000'), /Apenas tutores/);
await fails(() => svc('app_invite_issue', 'x'.repeat(64), 'Lia Costa', 'lia@x.com', '11999990000'), /Sessão expirada/);
await fails(() => svc('app_invite_issue', tutTok, 'Lia Costa', 'invalido', '11999990000'), /e-mail válido/);
await fails(() => svc('app_invite_issue', tutTok, 'Lia Costa', 'lia@x.com', '123'), /WhatsApp válido/);
await fails(() => svc('app_invite_issue', tutTok, 'Lia Costa', 'ana@gmail.com', '11999990000'), /já tem conta/);
const inv = await svc('app_invite_issue', tutTok, 'Lia Costa', 'LIA@x.com', '(11) 99999-0000');
assert.equal(inv.invite.length, 64); assert.equal(inv.phone, '5511999990000');
assert.ok(!(await db.query(`select token_hash from public.student_invites`)).rows[0].token_hash.includes(inv.invite), 'só o hash é guardado');
assert.deepEqual(await rpc('app_invite_info', inv.invite), { name: 'Lia Costa', email: 'lia@x.com', phone_hint: '0000', role: 'student' });
assert.match((await rpc('app_invite_info', 'x'.repeat(64))).error, /inválido ou expirado/);
// reenvio substitui o convite anterior
const inv2 = await svc('app_invite_issue', tutTok, 'Lia Costa', 'lia@x.com', '11999990000');
assert.match((await rpc('app_invite_info', inv.invite)).error, /inválido ou expirado/);
let list = await rpc('app_invite_list', tutTok); assert.equal(list.length, 1); assert.equal(list[0].status, 'pending');
await fails(() => rpc('app_invite_list', alunoTok), /Apenas tutores/);
await fails(() => rpc('app_invite_revoke', alunoTok, list[0].id), /Apenas tutores/);
await fails(() => rpc('app_invite_accept', inv2.invite, 'curta'), /pelo menos 8/);
const lia = await rpc('app_invite_accept', inv2.invite, 'senha-da-lia-1');
assert.equal(lia.user.role, 'student'); assert.equal(lia.user.email, 'lia@x.com'); assert.equal(lia.user.phone_verified, true);
assert.equal((await rpc('app_bootstrap', lia.token)).sessions.length, 30, 'conta já liberada (sem nova verificação)');
assert.ok((await rpc('app_login', 'lia@x.com', 'senha-da-lia-1')).token);
await fails(() => rpc('app_invite_accept', inv2.invite, 'senha-da-lia-1'), /inválido ou expirado/);   // uso único
assert.equal((await rpc('app_invite_list', tutTok))[0].status, 'used');
// revogar e expirar
const inv3 = await svc('app_invite_issue', tutTok, 'Beto Dias', 'beto@x.com', '21977776666');
await rpc('app_invite_revoke', tutTok, (await rpc('app_invite_list', tutTok)).find((x) => x.email === 'beto@x.com').id);
await fails(() => rpc('app_invite_accept', inv3.invite, 'senha-do-beto-1'), /inválido ou expirado/);
const inv4 = await svc('app_invite_issue', tutTok, 'Beto Dias', 'beto@x.com', '21977776666');
await db.exec(`update public.student_invites set expires_at = now() - interval '1 second' where email='beto@x.com'`);
await fails(() => rpc('app_invite_accept', inv4.invite, 'senha-do-beto-1'), /inválido ou expirado/);
assert.equal((await rpc('app_invite_list', tutTok)).find((x) => x.email === 'beto@x.com').status, 'expired');
// rollback quando o WhatsApp falha
const inv5 = await svc('app_invite_issue', tutTok, 'Caco Reis', 'caco@x.com', '21977776666');
await fails(() => rpc('app_invite_revoke_by_id', inv5.id), /permission denied/);
await svc('app_invite_revoke_by_id', inv5.id);
await fails(() => rpc('app_invite_accept', inv5.invite, 'senha-do-caco-1'), /inválido ou expirado/);
// limite por hora
await db.exec(`insert into public.student_invites (token_hash, email, full_name, phone, created_by, expires_at)
  select 'h'||g, 'l'||g||'@x.com', 'Lote '||g, '5511999990000', (select id from public.app_users where email='tutor@x.com'), now()+interval '1 day' from generate_series(1,30) g`);
await fails(() => svc('app_invite_issue', tutTok, 'Mais Um', 'mais@x.com', '11999990000'), /Limite de 30/);
await db.exec(`delete from public.student_invites where token_hash like 'h%'`);
await db.exec(`select public.admin_set_signup('open')`);
// ── Perfil, troca de WhatsApp, convite de tutor e troca de perfil ──
await db.exec(`select public.admin_set_signup('open')`);
const pAna = (await rpc('app_login', 'ana@gmail.com', 'nova-senha-123')).token;
const pTut = (await rpc('app_login', 'tutor@x.com', 'outra-senha-9')).token;
// nome sem senha; e-mail exige a senha atual
assert.equal((await rpc('app_profile_update', pAna, 'Ana S. Souza', 'ana@gmail.com', null)).user.full_name, 'Ana S. Souza');
await fails(() => rpc('app_profile_update', pAna, 'A', 'ana@gmail.com', null), /nome/);
await fails(() => rpc('app_profile_update', pAna, 'Ana', 'ruim', null), /e-mail válido/);
assert.match((await rpc('app_profile_update', pAna, 'Ana S. Souza', 'ana2@gmail.com', 'errada!!')).error, /Senha atual incorreta/);
await fails(() => rpc('app_profile_update', pAna, 'Ana S. Souza', 'bia@x.com', 'nova-senha-123'), /já está em uso/);
assert.equal((await rpc('app_profile_update', pAna, 'Ana S. Souza', 'Ana2@gmail.com', 'nova-senha-123')).user.email, 'ana2@gmail.com');
assert.ok((await rpc('app_login', 'ana2@gmail.com', 'nova-senha-123')).token);
// senha: valida a atual, encerra os outros dispositivos, mantém o atual
const outro = (await rpc('app_login', 'ana2@gmail.com', 'nova-senha-123')).token;
assert.match((await rpc('app_change_password', pAna, 'errada!!', 'senha-nova-456')).error, /Senha atual incorreta/);
assert.match((await rpc('app_change_password', pAna, 'nova-senha-123', 'curta')).error, /pelo menos 8/);
assert.deepEqual(await rpc('app_change_password', pAna, 'nova-senha-123', 'senha-nova-456'), { ok: true });
assert.equal(await rpc('app_me', outro), null, 'outros dispositivos saem');
assert.ok(await rpc('app_me', pAna), 'sessão atual continua');
assert.equal((await rpc('app_login', 'ana2@gmail.com', 'nova-senha-123')).error, 'E-mail ou senha inválidos.');
// bloqueio após 5 senhas atuais erradas
for (let i = 0; i < 5; i++) await rpc('app_change_password', pAna, 'errada!!', 'senha-nova-789');
assert.match((await rpc('app_change_password', pAna, 'senha-nova-456', 'senha-nova-789')).error, /Muitas tentativas/);
await db.exec(`update public.app_users set locked_until = null, failed_attempts = 0 where email='ana2@gmail.com'`);
// troca de WhatsApp
await fails(() => rpc('app_phone_change_issue', pAna, 'senha-nova-456', '11988887777'), /permission denied/);
await fails(() => svc('app_phone_change_issue', pAna, 'senha-nova-456', '123'), /WhatsApp válido/);
await fails(() => svc('app_phone_change_issue', pAna, 'senha-nova-456', '(11) 99999-8888'), /já é o seu/);
assert.match((await svc('app_phone_change_issue', pAna, 'errada!!', '11988887777')).error, /Senha atual incorreta/);
const pc = await svc('app_phone_change_issue', pAna, 'senha-nova-456', '(11) 98888-7777');
assert.equal(pc.phone, '5511988887777'); assert.match(pc.code, /^\d{6}$/);
assert.equal((await svc('app_phone_change_issue', pAna, 'senha-nova-456', '11988887777')).throttled, true);
assert.equal((await db.query(`select phone from public.app_users where email='ana2@gmail.com'`)).rows[0].phone, '5511999998888', 'número só muda após confirmar');
assert.match((await rpc('app_phone_change_confirm', pAna, pc.code === '111111' ? '222222' : '111111')).error, /inválido ou expirado/);
const done = await rpc('app_phone_change_confirm', pAna, pc.code);
assert.equal(done.ok, true); assert.equal(done.user.phone_hint, '7777');
assert.equal((await db.query(`select phone from public.app_users where email='ana2@gmail.com'`)).rows[0].phone, '5511988887777');
assert.match((await rpc('app_phone_change_confirm', pAna, pc.code)).error, /inválido ou expirado/, 'código de uso único');
// convite de tutor
const ti = await svc('app_invite_issue', pTut, 'Tiago Tutor', 'tiago@x.com', '31977775555', 'teacher');
assert.equal(ti.role, 'teacher');
assert.equal((await rpc('app_invite_info', ti.invite)).role, 'teacher');
await fails(() => svc('app_invite_issue', pTut, 'X Y', 'xy@x.com', '31977775555', 'admin'), /Perfil inválido/);
await fails(() => svc('app_invite_issue', pAna, 'X Y', 'xy@x.com', '31977775555', 'teacher'), /Apenas tutores/);   // aluno não convida
const tiago = await rpc('app_invite_accept', ti.invite, 'senha-do-tiago-1');
assert.equal(tiago.user.role, 'teacher');
assert.equal((await rpc('app_invite_list', pTut)).find((x) => x.email === 'tiago@x.com').role, 'teacher');
assert.equal((await rpc('app_bootstrap', tiago.token)).profiles.length > 3, true, 'novo tutor enxerga a turma');
// troca de perfil
const anaId = (await db.query(`select id from public.app_users where email='ana2@gmail.com'`)).rows[0].id;
const tutId = (await db.query(`select id from public.app_users where email='tutor@x.com'`)).rows[0].id;
await fails(() => rpc('app_set_role', pAna, anaId, 'teacher'), /Apenas tutores/);          // aluno não se promove
await fails(() => rpc('app_set_role', pTut, tutId, 'student'), /próprio perfil/);           // ninguém muda o próprio
await fails(() => rpc('app_set_role', pTut, anaId, 'admin'), /Perfil inválido/);
await fails(() => rpc('app_set_role', pTut, '00000000-0000-0000-0000-000000000000', 'teacher'), /não encontrado/);
assert.equal((await rpc('app_set_role', pTut, anaId, 'teacher')).role, 'teacher');
assert.equal((await rpc('app_bootstrap', pAna)).profiles.length > 3, true, 'promovida vê a turma');
await fails(() => rpc('app_submit', pAna, 'd05-e1', 'x', null), /Apenas alunos/);
assert.equal((await rpc('app_set_role', tiago.token, anaId, 'student')).role, 'student');   // outro tutor rebaixa
assert.equal((await rpc('app_bootstrap', pAna)).profiles.length, 1, 'rebaixada volta a ver só o próprio perfil');
console.log('✅ Autenticação própria e regras de progressão: todos os testes passaram');
