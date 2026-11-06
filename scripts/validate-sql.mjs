// Valida as migrations num Postgres embutido (PGlite), com stubs mínimos do Supabase (auth).
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';

export async function bootDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) {
    process.stdout.write(`> ${f} ... `);
    const t = Date.now();
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
    console.log(`ok (${Date.now() - t} ms)`);
  }
  return db;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await bootDb();
  const one = async (q) => (await db.query(q)).rows;
  console.table(await one(`select 'clientes' t, count(*) from treinamento.dim_clientes union all select 'produtos', count(*) from treinamento.dim_produtos
   union all select 'pedidos', count(*) from treinamento.fato_pedidos union all select 'itens', count(*) from treinamento.fato_itens_pedido
   union all select 'entregas', count(*) from treinamento.fato_entregas union all select 'campanhas', count(*) from treinamento.fato_campanhas
   union all select 'financeiro', count(*) from treinamento.fato_financeiro union all select 'partidas', count(*) from treinamento.esporte_partidas`));
  console.table(await one(`select status, count(*) from treinamento.fato_pedidos group by 1 order by 2 desc`));
  console.table(await one(`select transportadora, count(*) n, round(100.0*avg((data_entrega-data_envio>prazo_dias)::int),1) pct_atraso from treinamento.fato_entregas where data_entrega is not null group by 1`));
  console.table(await one(`select tipo, round(sum(valor)) total from treinamento.fato_financeiro group by 1`));
  console.table(await one(`select to_char(date_trunc('year',data_pedido),'YYYY') ano, count(*) from treinamento.fato_pedidos group by 1`));
}
