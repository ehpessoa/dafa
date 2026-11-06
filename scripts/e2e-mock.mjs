// E2E com Playwright + API Supabase simulada (dados reais do seed). Gera screenshots em .tmp/shots.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { bootDb } from './validate-sql.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const URL_ = 'https://mock.supabase.co', BASE = process.env.BASE ?? 'http://localhost:4173';
const db = await bootDb();
const T = {};
for (const [k, t] of Object.entries({ levels: 'levels', sessions: 'sessions', session_dependencies: 'session_dependencies', exercises: 'exercises', templates: 'templates', resources: 'resources',
  session_templates: 'session_templates', session_resources: 'session_resources', weekly_deliverables: 'weekly_deliverables' })) {
  T[k] = (await db.query(`select * from public.${t}`)).rows.map((r) => JSON.parse(JSON.stringify(r, (k, v) => (/_date$/.test(k) && typeof v === 'string' ? v.slice(0, 10) : v))));
}
const now = Date.now(), ago = (h) => new Date(now - h * 3600e3).toISOString();
const P = { tutor: { id: randomUUID(), email: 'tutor@x.com', full_name: 'Marina Tutora', avatar_url: null, role: 'teacher', created_at: ago(900) },
  ana: { id: randomUUID(), email: 'ana@gmail.com', full_name: 'Ana Souza', avatar_url: null, role: 'student', created_at: ago(800) },
  bruno: { id: randomUUID(), email: 'bruno@gmail.com', full_name: 'Bruno Lima', avatar_url: null, role: 'student', created_at: ago(700) } };
T.profiles = Object.values(P);
T.submissions = []; T.reviews = [];
const sub = (who, ex, attempt, status, h, content = 'Resolvi usando SOMASES; totais conferem com o SQL.') => {
  const s = { id: randomUUID(), exercise_id: ex, student_id: P[who].id, attempt, content, link_url: null, status, created_at: ago(h) }; T.submissions.push(s); return s;
};
const rev = (s, score, verdict, fb) => T.reviews.push({ id: randomUUID(), submission_id: s.id, tutor_id: P.tutor.id, score, verdict, feedback: fb, created_at: ago(1) });
for (const e of ['d01-e1', 'd01-e2', 'd01-e3']) { const s = sub('ana', e, 1, 'approved', 70); rev(s, 9, 'approved', 'Ótimo trabalho, perguntas bem formuladas.'); }
let s1 = sub('ana', 'd02-e1', 1, 'revision_requested', 50); rev(s1, 5.5, 'revision_requested', 'Faltou contar duplicados por coluna. Refaça incluindo a tabela de achados.');
let s2 = sub('ana', 'd02-e1', 2, 'approved', 30, 'Agora com tabela de achados.'); rev(s2, 8.5, 'approved', 'Perfeito.');
sub('ana', 'd02-e2', 1, 'submitted', 3);
sub('bruno', 'd01-e1', 1, 'submitted', 5, 'Minhas 5 perguntas SMART...');

let persona = 'ana';
const visible = (table, rows) => {
  if (persona === 'tutor') return rows;
  const me = P[persona].id;
  if (table === 'profiles') return rows.filter((r) => r.id === me);
  if (table === 'submissions') return rows.filter((r) => r.student_id === me);
  if (table === 'reviews') return rows.filter((r) => T.submissions.find((s) => s.id === r.submission_id)?.student_id === me);
  return rows;
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(body) });

const browser = await chromium.launch();
async function open(who, w = 1280, h = 900) {
  persona = who;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const exp = Math.floor(Date.now() / 1000) + 3600, p = P[who];
  const sess = { access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id: p.id, email: p.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: p.created_at } };
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-mock-auth-token', JSON.stringify(sess)]);
  await ctx.route(`${URL_}/**`, async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.startsWith('/auth/v1')) return json(route, {});
    const table = u.pathname.split('/').pop();
    if (req.method() === 'GET') {
      let rows = visible(table, T[table] ?? []);
      const idEq = u.searchParams.get('id')?.replace('eq.', '');
      if (idEq) rows = rows.filter((r) => r.id === idEq);
      return json(route, (req.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? (rows[0] ?? null) : rows);
    }
    const body = req.postDataJSON();
    if (table === 'submissions' && req.method() === 'POST') {
      const last = T.submissions.filter((s) => s.exercise_id === body.exercise_id && s.student_id === P[persona].id).at(-1);
      if (last?.status === 'submitted') return json(route, { message: 'Você já tem uma entrega aguardando avaliação do tutor neste exercício.' }, 400);
      const s = { id: randomUUID(), exercise_id: body.exercise_id, student_id: P[persona].id, attempt: (last?.attempt ?? 0) + 1, content: body.content, link_url: body.link_url, status: 'submitted', created_at: new Date().toISOString() };
      T.submissions.push(s); return json(route, [s], 201);
    }
    if (table === 'reviews' && req.method() === 'POST') {
      const r = { id: randomUUID(), tutor_id: P.tutor.id, created_at: new Date().toISOString(), ...body }; T.reviews.push(r);
      T.submissions.find((s) => s.id === body.submission_id).status = body.verdict; return json(route, [r], 201);
    }
    return json(route, []);
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::/.test(m.text()) && errors.push(m.text()));
  return { page, ctx, errors };
}
mkdirSync('.tmp/shots', { recursive: true });
const shot = async (page, name, full = true) => { await page.waitForTimeout(1300); return page.screenshot({ path: `.tmp/shots/${name}.png`, fullPage: full }); };

// ───────── Aluno ─────────
{
  const { page, errors } = await open('ana');
  await page.goto(BASE + '/'); await page.waitForSelector('text=Olá, Ana');
  await shot(page, '01-aluno-dashboard');
  await page.click('text=Trilha & dependências'); await page.waitForSelector('text=Trilha e dependências'); await shot(page, '02-trilha');
  // Sessão bloqueada (dia 4 depende de 3)
  await page.goto(BASE + '/sessao/4'); await page.waitForSelector('text=Sessão bloqueada'); await shot(page, '03-sessao-bloqueada');
  // Sessão com exercícios e refazer
  await page.goto(BASE + '/sessao/2?tab=exercicios'); await page.waitForSelector('text=Histórico de tentativas');
  await shot(page, '04-sessao-exercicios');
  assert.ok(await page.locator('text=Aguardando avaliação').first().isVisible());
  // Envia o exercício 3 do dia 1 como nova versão opcional (aprovado) -> permitido
  await page.goto(BASE + '/sessao/1?tab=exercicios'); await page.waitForSelector('text=Enviar nova versão (opcional)');
  await page.locator('textarea').first().fill('Versão melhorada'); await page.click('text=Reenviar >> nth=0');
  await page.waitForSelector('text=Entrega enviada. Aguarde');
  // conceito/ferramentas/templates/recursos
  await page.goto(BASE + '/sessao/6'); await page.waitForSelector('text=Por que isso importa'); await shot(page, '05-sessao-conceito');
  await page.goto(BASE + '/sessao/6?tab=templates'); await page.click('text=Ver diagrama >> nth=0'); await page.waitForSelector('.diagram svg', { timeout: 20000 }); await shot(page, '06-template-diagrama');
  await page.goto(BASE + '/sessao/6?tab=recursos'); await page.waitForSelector('text=Supabase do programa'); await shot(page, '07-recursos');
  await page.goto(BASE + '/calendario'); await page.waitForSelector('text=Semana 6'); await shot(page, '08-calendario');
  await page.goto(BASE + '/biblioteca'); await page.waitForSelector('text=Biblioteca'); await shot(page, '09-biblioteca');
  await page.goto(BASE + '/tutor'); await page.waitForURL(BASE + '/'); // aluno é redirecionado
  assert.equal(new URL(page.url()).pathname, '/');
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
  await page.goto(BASE + '/sessao/4'); await page.waitForSelector('text=Por que isso importa'); // tutor vê sessões bloqueadas
  assert.deepEqual(errors, []);
}
await browser.close();
console.log('✅ E2E: fluxos de aluno, tutor, bloqueio, refazer e responsividade OK');
process.exit(0);
