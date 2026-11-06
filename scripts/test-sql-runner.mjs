// Testa o Editor SQL (app_run_sql / app_sql_schema): funcionamento, limites e tentativas de burlar o somente-leitura.
import assert from 'node:assert/strict';
import { bootDb } from './validate-sql.mjs';

const db = await bootDb();

// Chama uma RPC como o papel anon (como a API REST faz com a chave publishable).
const rpc = async (fn, ...args) => {
  await db.exec('set role anon');
  try {
    const ph = args.map((_, i) => `$${i + 1}`).join(',');
    return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r;
  } finally { await db.exec('reset role'); }
};
const { token } = await rpc('app_register', 'ana@x.com', 'senha-forte-1', 'Ana Souza');
const run = (sql) => rpc('app_run_sql', token, sql);
const ok = async (sql) => { const r = await run(sql); assert.ok(!r.error, `deveria rodar: ${sql}\n→ ${r.error}`); return r; };
const blocked = async (sql, re = /./) => { const r = await run(sql); assert.ok(r.error, `deveria bloquear: ${sql}`); assert.match(r.error, re, sql); };

// ── Funciona ──
let r = await ok('SELECT status, COUNT(*) AS n FROM treinamento.fato_pedidos GROUP BY status ORDER BY n DESC');
assert.deepEqual(r.columns, ['status', 'n']); assert.ok(r.rows.length >= 2); assert.equal(r.truncated, false);
assert.equal(typeof r.rows[0].n, 'number');
r = await ok('select * from dim_clientes limit 3;');                       // search_path = treinamento; ";" final tolerado
assert.equal(r.rows.length, 3);
r = await ok('-- contar\nWITH t AS (SELECT pedido_id FROM treinamento.fato_pedidos) SELECT COUNT(*) AS total FROM t -- fim');
assert.ok(r.rows[0].total > 6000);
r = await ok(`select ';' as ponto_virgula, 'it''s' as aspas, 1 as "a;b"`);   // ";" dentro de texto/identificador
assert.equal(r.rows[0].ponto_virgula, ';'); assert.equal(r.rows[0].aspas, "it's");
r = await ok('/* bloco */ select 1 as x /* outro */');
r = await ok("values (1,'a'),(2,'b')"); assert.equal(r.rows.length, 2);
r = await ok('select * from treinamento.dim_clientes where false');
assert.deepEqual(r.rows, []); assert.deepEqual(r.columns, []);

// ── Limite de linhas ──
r = await ok('select g from generate_series(1, 1000) g');
assert.equal(r.rows.length, 500); assert.equal(r.truncated, true); assert.equal(r.rows[499].g, 500);

// ── Erros do banco viram {error} (sem derrubar a RPC) ──
await blocked('select * from treinamento.tabela_que_nao_existe', /does not exist/);
await blocked('select nome_errado from treinamento.dim_clientes', /does not exist/);
await blocked('selec 1', /Apenas consultas|syntax/);

// ── Somente leitura / escopo ──
for (const sql of ['insert into treinamento.dim_clientes select * from treinamento.dim_clientes', 'update treinamento.dim_clientes set segmento = null',
  'delete from treinamento.fato_pedidos', 'drop table treinamento.fato_pedidos', 'create table treinamento.x (a int)', 'truncate treinamento.fato_pedidos',
  'alter role aluno_leitura with password \'x\'', 'grant all on treinamento.fato_pedidos to anon', 'set role postgres', 'reset role', 'copy treinamento.fato_pedidos to stdout',
  'do $$ begin end $$', 'call x()', 'explain analyze delete from treinamento.fato_pedidos', 'show all']) {
  await blocked(sql, /Apenas consultas|\$/);
}
// dados do app e do Postgres ficam inacessíveis
await blocked('select * from public.app_users', /permission denied/);
await blocked('select password_hash from public.app_users', /permission denied/);
await blocked('select * from public.app_sessions', /permission denied/);
await blocked('select * from public.submissions', /permission denied/);
await blocked('select * from pg_authid', /permission denied/);
await blocked('select public._app_user(\'x\')', /permission denied|does not exist/);
await blocked(`select public.app_bootstrap('${'0'.repeat(64)}')`, /permission denied/);

// ── Tentativas de injeção ──
await blocked('select 1; delete from treinamento.fato_pedidos', /uma consulta por vez/);
await blocked('select 1) x; delete from treinamento.fato_pedidos; select 1 from (select 1', /uma consulta por vez|Parênteses/);
await blocked('select 1) x union all select 2 from (select 3', /Parênteses/);
await blocked('select ((1)', /Parênteses/);
await blocked("select 'abc", /sem fechar/);
await blocked('select "abc', /sem fechar/);
await blocked('select 1 /* sem fim', /sem fechar/);
await blocked(`select 'a' /* ' */; select 'b'`, /uma consulta por vez/);        // aspas dentro de comentário não escondem o ";"
await blocked(`select "x'y"; delete from treinamento.fato_pedidos --'`, /uma consulta por vez/);   // aspas dentro de identificador
await blocked('select 1 /* /* */ ; */ ; delete from treinamento.fato_pedidos', /uma consulta por vez|sem fechar/);
await blocked('select $$x$$', /\$/);
await blocked('select 1 into treinamento.copia', /não é permitido/);
for (const f of ["set_config('role','postgres',true)", '"set_config"(\'role\',\'postgres\',true)', "pg_catalog.set_config('search_path','public',true)",
  "query_to_xml('select * from public.app_users', true, false, '')", "ts_stat('select 1')", 'pg_sleep(1)', "pg_read_file('/etc/passwd')", "current_setting('role')", "lo_import('/etc/passwd')"]) {
  await blocked(`select ${f}`, /não é permitido/);
}
await blocked('x'.repeat(20001), /muito longa/);
await blocked('   ', /Escreva/);
await blocked('-- só comentário', /só há comentários/);

// ── Autorização ──
for (const t of [null, 'x'.repeat(64), 'curto']) {
  await assert.rejects(rpc('app_run_sql', t, 'select 1'), /Sessão/);
  await assert.rejects(rpc('app_sql_schema', t), /Sessão/);
}
await rpc('app_logout', token);
await assert.rejects(rpc('app_run_sql', token, 'select 1'), /Sessão/, 'logout invalida o editor');

// ── O executor interno não é alcançável pela API ──
const t2 = (await rpc('app_register', 'bia@x.com', 'senha-forte-2', 'Bia Lima')).token;
await db.exec('set role anon');
await assert.rejects(db.query(`select app_runner.run('select 1', 5)`), /permission denied/);
await db.exec('reset role');
await db.exec('set role anon');
await assert.rejects(db.query(`select public._app_sql_check('select 1')`), /permission denied/);
await db.exec('reset role');
// a role de leitura não pode criar nada em app_runner nem em treinamento
const priv = (await db.query(`select has_schema_privilege('aluno_leitura','app_runner','CREATE') c, has_schema_privilege('aluno_leitura','treinamento','CREATE') t,
  has_table_privilege('aluno_leitura','treinamento.fato_pedidos','INSERT') i, has_table_privilege('aluno_leitura','public.app_users','SELECT') u`)).rows[0];
assert.deepEqual(priv, { c: false, t: false, i: false, u: false });

// ── Catálogo de tabelas ──
const sc = await rpc('app_sql_schema', t2);
assert.ok(sc.length >= 8 && sc.every((t) => t.columns.length > 0)); assert.ok(sc.some((t) => t.table === 'fato_pedidos'));
assert.ok(!JSON.stringify(sc).includes('app_users'));

console.log('✅ Editor SQL: funcionamento, limites e bloqueios de segurança passaram');
