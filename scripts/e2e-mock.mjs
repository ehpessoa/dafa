// E2E com Playwright + API Supabase (RPC) simulada com dados reais do seed. Screenshots em .tmp/shots.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { bootDb } from './validate-sql.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const URL_ = 'https://mock.supabase.co', BASE = process.env.BASE ?? 'http://localhost:4173';
const db = await bootDb();
const T = {};
for (const [k, t] of Object.entries({ levels: 'levels', sessions: 'sessions', deps: 'session_dependencies', exercises: 'exercises', templates: 'templates', resources: 'resources',
  sessionTemplates: 'session_templates', sessionResources: 'session_resources', weekly: 'weekly_deliverables' })) {
  T[k] = (await db.query(`select * from public.${t}`)).rows.map((r) => JSON.parse(JSON.stringify(r, (key, v) => (/_date$/.test(key) && typeof v === 'string' ? v.slice(0, 10) : v))));
}
const now = Date.now(), ago = (h) => new Date(now - h * 3600e3).toISOString();
const mkUser = (key, email, full_name, role) => ({ key, id: randomUUID(), email, full_name, avatar_url: null, role, created_at: ago(500), password: 'senha-forte-1' });
const U = [mkUser('tutor', 'tutor@x.com', 'Marina Tutora', 'teacher'), mkUser('ana', 'ana@gmail.com', 'Ana Souza', 'student'), mkUser('bruno', 'bruno@gmail.com', 'Bruno Lima', 'student')];
const pub = ({ password, key, ...u }) => u;
const tokens = new Map();                                       // token -> user
const newToken = (u) => { const t = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''); tokens.set(t, u); return t; };
const byKey = (k) => U.find((u) => u.key === k);
T.submissions = []; T.reviews = [];
const sub = (who, ex, attempt, status, h, content = 'Resolvi usando SOMASES; totais conferem com o SQL.') => {
  const s = { id: randomUUID(), exercise_id: ex, student_id: byKey(who).id, attempt, content, link_url: null, status, created_at: ago(h) }; T.submissions.push(s); return s;
};
const rev = (s, score, verdict, feedback) => T.reviews.push({ id: randomUUID(), submission_id: s.id, tutor_id: byKey('tutor').id, score, verdict, feedback, created_at: ago(1) });
for (const e of ['d01-e1', 'd01-e2', 'd01-e3']) { const s = sub('ana', e, 1, 'approved', 70); rev(s, 9, 'approved', 'Ótimo trabalho, perguntas bem formuladas.'); }
const s1 = sub('ana', 'd02-e1', 1, 'revision_requested', 50); rev(s1, 5.5, 'revision_requested', 'Faltou contar duplicados por coluna. Refaça incluindo a tabela de achados.');
const s2 = sub('ana', 'd02-e1', 2, 'approved', 30, 'Agora com tabela de achados.'); rev(s2, 8.5, 'approved', 'Perfeito.');
sub('ana', 'd02-e2', 1, 'submitted', 3);
sub('bruno', 'd01-e1', 1, 'submitted', 5, 'Minhas 5 perguntas SMART...');

const bootstrap = (u) => ({
  ...Object.fromEntries(Object.keys(T).filter((k) => !['submissions', 'reviews'].includes(k)).map((k) => [k, T[k]])),
  submissions: u.role === 'teacher' ? T.submissions : T.submissions.filter((s) => s.student_id === u.id),
  reviews: T.reviews.filter((r) => u.role === 'teacher' || T.submissions.find((s) => s.id === r.submission_id)?.student_id === u.id),
  profiles: (u.role === 'teacher' ? U : [u]).map(pub),
});
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

async function rpc(fn, b) {
  const user = () => { const u = tokens.get(b.p_token); if (!u) throw new Error('Sessão expirada. Entre novamente.'); return u; };
  switch (fn) {
    case 'app_me': { const u = tokens.get(b.p_token); return u ? pub(u) : null; }
    case 'app_bootstrap': return bootstrap(user());
    case 'app_login': { const u = U.find((x) => x.email === b.p_email.toLowerCase()); return u && u.password === b.p_password ? { token: newToken(u), user: pub(u) } : { error: 'E-mail ou senha inválidos.' }; }
    case 'app_signup_status': return { mode: 'open' };
    case 'app_register': {
      if (U.some((x) => x.email === b.p_email.toLowerCase())) throw new Error('Este e-mail já está cadastrado. Use "Entrar".');
      const u = { ...mkUser(randomUUID(), b.p_email.toLowerCase(), b.p_name, 'student'), password: b.p_password }; U.push(u);
      return { token: newToken(u), user: pub(u) };
    }
    case 'app_logout': tokens.delete(b.p_token); return true;
    case 'app_submit': {
      const u = user(); const last = T.submissions.filter((s) => s.exercise_id === b.p_exercise_id && s.student_id === u.id).at(-1);
      if (last?.status === 'submitted') throw new Error('Você já tem uma entrega aguardando avaliação do tutor neste exercício.');
      const s = { id: randomUUID(), exercise_id: b.p_exercise_id, student_id: u.id, attempt: (last?.attempt ?? 0) + 1, content: b.p_content, link_url: b.p_link, status: 'submitted', created_at: new Date().toISOString() };
      T.submissions.push(s); return s;
    }
    case 'app_review': {
      const u = user(); if (u.role !== 'teacher') throw new Error('Apenas tutores podem avaliar.');
      const ex = T.reviews.find((r) => r.submission_id === b.p_submission_id);
      const r = ex ?? { id: randomUUID(), submission_id: b.p_submission_id, created_at: new Date().toISOString() };
      Object.assign(r, { tutor_id: u.id, score: b.p_score, verdict: b.p_verdict, feedback: b.p_feedback }); if (!ex) T.reviews.push(r);
      T.submissions.find((s) => s.id === b.p_submission_id).status = b.p_verdict; return r;
    }
  }
  throw new Error('rpc desconhecida ' + fn);
}

const browser = await chromium.launch();
async function open(who, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (who) { const tok = newToken(byKey(who)); await ctx.addInitScript((t) => localStorage.setItem('dafa.token', t), tok); }
  await ctx.route(`${URL_}/**`, async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const m = u.pathname.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (!m) return json(route, { message: 'rota inesperada: ' + u.pathname }, 404);
    try { return json(route, await rpc(m[1], req.postDataJSON() ?? {})); } catch (e) { return json(route, { message: e.message }, 400); }
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::|status of 400/.test(m.text()) && errors.push(m.text()));
  return { page, ctx, errors };
}
mkdirSync('.tmp/shots', { recursive: true });
const shot = async (page, name, full = true) => { await page.waitForTimeout(1300); return page.screenshot({ path: `.tmp/shots/${name}.png`, fullPage: full }); };

// ───────── Cadastro e primeiro treinamento (sem Google) ─────────
{
  const { page, errors } = await open(null);
  await page.goto(BASE + '/'); await page.waitForSelector('text=Criar conta e começar'); await shot(page, '00-login');
  assert.equal(await page.locator('text=Google').count(), 0, 'não deve haver login Google');
  // senha curta é barrada pelo formulário (HTML5) e e-mail repetido pelo banco
  await page.fill('#name', 'Carla Mendes'); await page.fill('#email', 'ana@gmail.com'); await page.fill('#password', 'senha-forte-9');
  await page.click('text=Criar conta e começar'); await page.waitForSelector('text=já está cadastrado');
  await page.fill('#email', 'carla@gmail.com'); await page.click('text=Criar conta e começar');
  await page.waitForSelector('text=Olá, Carla'); await shot(page, '00b-aluna-nova');
  // já começa pelo dia 1 e envia uma entrega
  await page.goto(BASE + '/sessao/1?tab=exercicios'); await page.waitForSelector('text=Enviar entrega');
  await page.locator('textarea').first().fill('Minhas 5 perguntas SMART'); await page.click('text=Enviar para avaliação >> nth=0');
  await page.waitForSelector('text=Entrega enviada. Aguarde');
  await page.goto(BASE + '/sessao/2'); await page.waitForSelector('text=Sessão bloqueada');     // dependência continua valendo
  // sair e entrar de novo
  await page.click('text=Sair'); await page.waitForSelector('text=Criar conta e começar');
  await page.click('role=tab[name="Entrar"]'); await page.fill('#email', 'carla@gmail.com'); await page.fill('#password', 'errada-123'); await page.click('form >> text=Entrar >> nth=-1');
  await page.waitForSelector('text=E-mail ou senha inválidos');
  await page.fill('#password', 'senha-forte-9'); await page.click('form >> button[type=submit]'); await page.waitForSelector('text=Sessão bloqueada');   // volta à rota em que estava
  await page.reload(); await page.waitForSelector('text=Sessão bloqueada');                               // sessão persiste ao recarregar
  await page.goto(BASE + '/'); await page.waitForSelector('text=Olá, Carla');
  assert.deepEqual(errors, []);
}
// ───────── Aluno ─────────
{
  const { page, errors } = await open('ana');
  await page.goto(BASE + '/'); await page.waitForSelector('text=Olá, Ana'); await shot(page, '01-aluno-dashboard');
  await page.click('text=Trilha & dependências'); await page.waitForSelector('text=Trilha e dependências'); await shot(page, '02-trilha');
  await page.goto(BASE + '/sessao/4'); await page.waitForSelector('text=Sessão bloqueada'); await shot(page, '03-sessao-bloqueada');
  await page.goto(BASE + '/sessao/2?tab=exercicios'); await page.waitForSelector('text=Histórico de tentativas'); await shot(page, '04-sessao-exercicios');
  assert.ok(await page.locator('text=Aguardando avaliação').first().isVisible());
  await page.goto(BASE + '/sessao/1?tab=exercicios'); await page.waitForSelector('text=Enviar nova versão (opcional)');
  await page.locator('textarea').first().fill('Versão melhorada'); await page.click('text=Reenviar >> nth=0'); await page.waitForSelector('text=Entrega enviada. Aguarde');
  await page.goto(BASE + '/sessao/6'); await page.waitForSelector('text=Por que isso importa'); await shot(page, '05-sessao-conceito');
  await page.goto(BASE + '/sessao/6?tab=templates'); await page.click('text=Ver diagrama >> nth=0'); await page.waitForSelector('.diagram svg', { timeout: 20000 }); await shot(page, '06-template-diagrama');
  await page.goto(BASE + '/sessao/6?tab=recursos'); await page.waitForSelector('text=Supabase do programa'); await shot(page, '07-recursos');
  await page.goto(BASE + '/calendario'); await page.waitForSelector('text=Semana 6'); await shot(page, '08-calendario');
  await page.goto(BASE + '/biblioteca'); await page.waitForSelector('text=Biblioteca'); await shot(page, '09-biblioteca');
  await page.goto(BASE + '/tutor'); await page.waitForURL(BASE + '/');
  assert.equal(await page.locator('text=Visão da turma').count(), 0, 'aluno não deve ver menu do tutor');
  assert.deepEqual(errors, []);
}
// ───────── Mobile ─────────
{
  const { page } = await open('ana', 390, 800);
  await page.goto(BASE + '/'); await page.waitForSelector('text=Olá, Ana'); await shot(page, '10-mobile-dashboard', false);
  await page.goto(BASE + '/sessao/6'); await page.waitForSelector('text=Por que isso importa'); await shot(page, '11-mobile-sessao', false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sem rolagem horizontal no mobile');
}
// ───────── Tutor ─────────
{
  const { page, errors } = await open('tutor');
  await page.goto(BASE + '/tutor'); await page.waitForSelector('text=Visão da turma'); await shot(page, '12-tutor-home');
  await page.goto(BASE + '/tutor/fila'); await page.waitForSelector('text=Fila de avaliação'); await shot(page, '13-tutor-fila');
  await page.locator('tbody tr').first().click(); await page.waitForSelector('text=Solicitar ajustes'); await shot(page, '14-tutor-avaliar');
  await page.fill('#fb', 'Bom começo. Detalhe a fórmula do ticket médio.'); await page.click('text=Solicitar ajustes');
  await page.waitForSelector('text=Fila de avaliação');
  await page.goto(BASE + '/tutor/alunos'); await page.waitForSelector('text=Ana Souza'); await shot(page, '15-tutor-alunos');
  await page.click('text=Ana Souza'); await page.waitForSelector('text=Mapa de progresso'); await shot(page, '16-tutor-aluno');
  await page.goto(BASE + '/sessao/15'); await page.waitForSelector('text=1) ESPECIFICAR'); await shot(page, '17-guia-ia-dia15');   // guia aberto no 1º uso
  await page.goto(BASE + '/sessao/16'); await page.waitForSelector('text=Guia rápido: como usar a IA'); assert.equal(await page.locator('text=1) ESPECIFICAR').isVisible(), false, 'guia recolhido a partir do 2º uso');
  await page.goto(BASE + '/sessao/15?tab=exercicios'); await page.waitForSelector('text=Vai usar IA para gerar código');
  await page.goto(BASE + '/sessao/4'); await page.waitForSelector('text=Por que isso importa');
  assert.deepEqual(errors, []);
}
// ───────── "Sair" sempre acessível (tutor em tela baixa e celular) ─────────
{
  const { page } = await open('tutor', 1280, 520);
  await page.goto(BASE + '/tutor'); await page.waitForSelector('text=Visão da turma');
  const b = await page.locator('.userbox >> text=Sair').boundingBox();
  assert.ok(b && b.y >= 0 && b.y + b.height <= 520, 'Sair do tutor visível em tela baixa');
  const m = await open('tutor', 390, 700);
  await m.page.goto(BASE + '/tutor'); await m.page.waitForSelector('text=Visão da turma');
  assert.ok(await m.page.locator('.topbar >> text=Sair').isVisible(), 'Sair visível na barra superior do celular');
  await m.page.click('.topbar >> text=Sair'); await m.page.waitForSelector('text=Criar conta e começar');
}
await browser.close();
console.log('✅ E2E: cadastro, login/logout, treinamento, bloqueio, refazer, tutor e mobile OK');
process.exit(0);
