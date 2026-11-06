-- ============================================================================
-- Banco de análise do treinamento: schema "treinamento" (dados 100% fictícios).
-- Gerado de forma determinística (setseed) para que todos os alunos vejam os mesmos números.
-- Acesso dos alunos: usuário somente-leitura "aluno_leitura" (Power BI, Python, SQL).
-- O schema NÃO é exposto pela API REST do Supabase (apenas conexão Postgres).
-- ============================================================================
create schema if not exists treinamento;

drop table if exists treinamento.fato_entregas, treinamento.fato_itens_pedido, treinamento.fato_pedidos,
  treinamento.fato_campanhas, treinamento.fato_financeiro, treinamento.esporte_partidas,
  treinamento.dim_produtos, treinamento.dim_clientes cascade;

create table treinamento.dim_clientes (
  cliente_id int primary key, nome text not null, cidade text not null, uf char(2) not null,
  segmento text not null check (segmento in ('basico','premium','corporativo')),
  canal_aquisicao text not null, data_cadastro date not null);

create table treinamento.dim_produtos (
  produto_id int primary key, nome text not null, categoria text not null,
  preco numeric(10,2) not null, custo numeric(10,2) not null);

create table treinamento.fato_pedidos (
  pedido_id int primary key, cliente_id int not null references treinamento.dim_clientes,
  data_pedido date not null,
  status text not null check (status in ('entregue','enviado','pendente','cancelado')),
  canal text not null check (canal in ('site','app','marketplace','loja')),
  uf_entrega char(2) not null, frete numeric(8,2) not null, desconto_pct numeric(5,2) not null default 0);

create table treinamento.fato_itens_pedido (
  item_id int primary key, pedido_id int not null references treinamento.fato_pedidos,
  produto_id int not null references treinamento.dim_produtos,
  quantidade int not null, preco_unitario numeric(10,2) not null);  -- preço já com desconto aplicado

create table treinamento.fato_entregas (
  pedido_id int primary key references treinamento.fato_pedidos, transportadora text not null,
  data_envio date not null, prazo_dias int not null, data_entrega date);

create table treinamento.fato_campanhas (
  campanha_id int primary key, canal text not null, mes date not null,
  investimento numeric(10,2) not null, impressoes int not null, cliques int not null, conversoes int not null);

create table treinamento.fato_financeiro (
  lancamento_id int primary key, data date not null, tipo text not null check (tipo in ('receita','despesa')),
  categoria text not null, centro_custo text not null, valor numeric(12,2) not null);

create table treinamento.esporte_partidas (
  partida_id int primary key, temporada int not null, rodada int not null, data_jogo date not null,
  mandante text not null, visitante text not null, gols_mandante int not null, gols_visitante int not null,
  publico int not null, receita_bilheteria numeric(12,2) not null);

select setseed(0.42);

-- ───────────── Clientes (800) ─────────────
insert into treinamento.dim_clientes
select g, 'Cliente ' || lpad(g::text, 4, '0'),
       (array['São Paulo','Campinas','Rio de Janeiro','Belo Horizonte','Curitiba','Porto Alegre','Salvador','Recife','Fortaleza','Brasília'])[x.i],
       (array['SP','SP','RJ','MG','PR','RS','BA','PE','CE','DF'])[x.i],
       case when x.r < 0.60 then 'basico' when x.r < 0.90 then 'premium' else 'corporativo' end,
       (array['Google Ads','Meta Ads','Orgânico','Indicação','E-mail','Influenciadores'])[1 + floor(x.r2 * 6)::int],
       date '2024-01-01' + floor(x.r3 * 730)::int
from generate_series(1, 800) g
cross join lateral (select 1 + floor(power(random(), 1.4) * 10)::int as i, random() as r, random() as r2,
                           random() as r3, g as gg) x;

-- ───────────── Produtos (60) ─────────────
insert into treinamento.dim_produtos
select row_number() over (order by c.ord, n), c.cat || ' ' || lpad(n::text, 2, '0'), c.cat,
       round((c.base * (0.5 + random() * 1.5))::numeric, 2) as preco, 0
from (values (1,'Eletrônicos',300),(2,'Casa',120),(3,'Moda',90),(4,'Esporte',150),(5,'Beleza',60),(6,'Livros',40)) c(ord, cat, base)
cross join generate_series(1, 10) n;
update treinamento.dim_produtos set custo = round((preco * (0.45 + random() * 0.35))::numeric, 2);

-- ───────────── Pedidos (~6.900) ─────────────
create temp table _ped as
select cliente_id, data_pedido, random() as r_status, random() as r_canal, random() as r_frete, random() as r_desc
from (
  select 1 + floor(random() * 700)::int as cliente_id,
         date '2024-01-01' + floor(730 * power(random(), 0.8))::int as data_pedido
  from generate_series(1, 6000)
  union all  -- pico de fim de ano (Black Friday / Natal)
  select 1 + floor(random() * 700)::int,
         make_date(2024 + (g % 2), 11, 1) + floor(random() * 54)::int
  from generate_series(1, 900) g
) q;

insert into treinamento.fato_pedidos
select row_number() over (order by p.data_pedido, p.cliente_id), p.cliente_id, p.data_pedido,
       case when p.r_status < 0.05 then 'cancelado'
            when p.data_pedido > date '2025-12-26' then (case when p.r_status < 0.5 then 'pendente' else 'enviado' end)
            when p.data_pedido > date '2025-12-18' and p.r_status < 0.4 then 'enviado'
            else 'entregue' end,
       case when p.r_canal < 0.40 then 'site' when p.r_canal < 0.70 then 'app' when p.r_canal < 0.90 then 'marketplace' else 'loja' end,
       c.uf,
       case when p.r_canal >= 0.90 then 0 else round((10 + p.r_frete * 40)::numeric, 2) end,
       case when p.r_desc < 0.25 then round((5 + p.r_desc * 60)::numeric, 0) else 0 end
from _ped p join treinamento.dim_clientes c using (cliente_id);

-- cadastro sempre anterior à primeira compra
update treinamento.dim_clientes c
set data_cadastro = least(c.data_cadastro, f.primeira - floor(random() * 30)::int)
from (select cliente_id, min(data_pedido) as primeira from treinamento.fato_pedidos group by 1) f
where f.cliente_id = c.cliente_id;

-- ───────────── Itens ─────────────
insert into treinamento.fato_itens_pedido
select row_number() over (order by p.pedido_id, k), p.pedido_id, pr.produto_id,
       1 + floor(power(random(), 2) * 3)::int,
       round((pr.preco * (1 - p.desconto_pct / 100))::numeric, 2)
from treinamento.fato_pedidos p
cross join lateral generate_series(1, 1 + floor(power(random(), 1.5) * 4)::int + (p.pedido_id * 0)) k
cross join lateral (select 1 + floor(power(random(), 1.2) * 60)::int as pid, p.pedido_id as ref, k as kk) sel
join treinamento.dim_produtos pr on pr.produto_id = sel.pid;

-- ───────────── Entregas ─────────────
insert into treinamento.fato_entregas
select p.pedido_id, t.nome, p.data_pedido + (1 + floor(random() * 3))::int as envio, t.prazo, null
from treinamento.fato_pedidos p
cross join lateral (
  select (array['RápidoLog','TransBrasil','EntregaJá','CargaMais'])[1 + (p.pedido_id % 4)] as nome,
         3 + floor(random() * 6)::int as prazo, p.pedido_id as ref) t
where p.status in ('entregue','enviado');

update treinamento.fato_entregas e
set data_entrega = e.data_envio + greatest(1,
      e.prazo_dias - floor(random() * 3)::int
      + case when random() < (case e.transportadora when 'RápidoLog' then 0.08 when 'TransBrasil' then 0.18
                                   when 'EntregaJá' then 0.12 else 0.30 end)
             then 1 + floor(random() * 5)::int else 0 end)::int
from treinamento.fato_pedidos p
where p.pedido_id = e.pedido_id and p.status = 'entregue';

-- ───────────── Campanhas de marketing (24 meses x 5 canais) ─────────────
insert into treinamento.fato_campanhas
select row_number() over (order by m, ch.ord), ch.nome, m, inv.v, imp.v, clk.v, conv.v
from generate_series(date '2024-01-01', date '2025-12-01', interval '1 month') m_ts(m)
cross join (values (1,'Google Ads',1.0,0.030,0.040),(2,'Meta Ads',0.9,0.015,0.025),(3,'E-mail',0.2,0.040,0.060),
                   (4,'Influenciadores',0.7,0.012,0.020),(5,'Afiliados',0.5,0.020,0.035)) ch(ord, nome, escala, ctr, cv)
cross join lateral (select round((600 + random() * 2400)::numeric * ch.escala * (1 + 0.02 * ((extract(year from m)::int - 2024) * 12 + extract(month from m)::int)), 2) as v) inv
cross join lateral (select floor(inv.v * (25 + random() * 35))::int as v) imp
cross join lateral (select floor(imp.v * ch.ctr * (0.7 + random() * 0.6))::int as v) clk
cross join lateral (select floor(clk.v * ch.cv * (0.7 + random() * 0.6))::int as v) conv;

-- ───────────── Financeiro (24 meses) ─────────────
create temp table _mes as
select date_trunc('month', p.data_pedido)::date as mes,
       sum(i.quantidade * i.preco_unitario) as receita,
       sum(i.quantidade * pr.custo) as cmv
from treinamento.fato_itens_pedido i
join treinamento.fato_pedidos p using (pedido_id)
join treinamento.dim_produtos pr using (produto_id)
where p.status <> 'cancelado' group by 1;

insert into treinamento.fato_financeiro
select row_number() over (order by mes, ord), (mes + interval '1 month - 1 day')::date, tipo, categoria, cc, round(valor::numeric, 2)
from (
  select mes, 1 as ord, 'receita' as tipo, 'Vendas de produtos' as categoria, 'Comercial' as cc, receita as valor from _mes
  union all select mes, 2, 'receita', 'Serviços e assinaturas', 'Comercial', receita * 0.04 * (0.8 + random() * 0.4) from _mes
  union all select mes, 3, 'despesa', 'Custo de mercadorias', 'Comercial', cmv from _mes
  union all select mes, 4, 'despesa', 'Marketing e mídia', 'Marketing',
             (select coalesce(sum(investimento), 0) from treinamento.fato_campanhas c where c.mes = m.mes) from _mes m
  union all select mes, 5, 'despesa', 'Logística e fretes', 'Logística',
             (select coalesce(sum(frete), 0) * 0.8 from treinamento.fato_pedidos p where date_trunc('month', p.data_pedido)::date = m.mes) from _mes m
  union all select mes, 6, 'despesa', 'Pessoal', 'Administrativo', 14000 * (1 + 0.01 * extract(month from mes)) * (0.97 + random() * 0.06) from _mes
  union all select mes, 7, 'despesa', 'Tecnologia', 'TI', 3500 * (0.9 + random() * 0.3) from _mes
  union all select mes, 8, 'despesa', 'Aluguel e utilidades', 'Administrativo', 4200 * (0.95 + random() * 0.1) from _mes
) f;

-- ───────────── Esporte: 2 temporadas, 20 times, turno e returno (380 jogos/ano) ─────────────
create temp table _times as
select row_number() over () as id, nome
from unnest(array['Tubarões FC','Águias do Norte','Leões da Serra','Estrela do Sul','Raio Azul','Guarani Velho','Ferroviário','Atlético Litoral',
                  'Cometa FC','Trovão Rubro','Dragões SC','Pantera Negra','União Mineira','Vitória Real','Sport Planalto','Lobos do Vale',
                  'Furacão Verde','Tricolor Paulista','Náutico Bravo','Aliança FC']) as nome;

insert into treinamento.esporte_partidas
select row_number() over (order by temporada, rodada, mandante), temporada, rodada,
       (case temporada when 2024 then date '2024-04-13' else date '2025-04-12' end) + (rodada - 1) * 7 + floor(random() * 2)::int,
       mandante, visitante, gm, gv,
       (8000 + 1800 * (21 - rank_m) + random() * 12000)::int,
       0
from (
  select s.temporada, 1 + ((row_number() over (partition by s.temporada order by random()) - 1) / 10)::int as rodada,
         a.nome as mandante, b.nome as visitante, a.id as rank_m,
         floor(power(random(), 1.8) * (3.4 + (20 - a.id) * 0.04))::int as gm,
         floor(power(random(), 2.1) * (2.9 + (20 - b.id) * 0.04))::int as gv
  from (values (2024),(2025)) s(temporada)
  cross join _times a cross join _times b where a.id <> b.id
) j;
update treinamento.esporte_partidas set receita_bilheteria = round((publico * (35 + random() * 45))::numeric, 2);

drop table _ped, _mes, _times;

-- ───────────── Acesso somente-leitura ─────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'aluno_leitura') then
    create role aluno_leitura nologin;
  end if;
end $$;
grant usage on schema treinamento to aluno_leitura;
grant select on all tables in schema treinamento to aluno_leitura;
alter default privileges in schema treinamento grant select on tables to aluno_leitura;
alter role aluno_leitura set statement_timeout = '30s';
alter role aluno_leitura set search_path = treinamento, public;

-- Defesa em profundidade: o schema não é exposto pela API e fica fechado para anon/authenticated.
revoke all on all tables in schema treinamento from anon, authenticated;
revoke usage on schema treinamento from anon, authenticated;

comment on schema treinamento is 'Dados fictícios do programa DAFA. Somente leitura para alunos.';
