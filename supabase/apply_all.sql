-- ============================================================================
-- DAFA – Plataforma de treinamento em Análise de Dados
-- Schema da aplicação (e-learning): perfis, currículo, entregas e avaliações.
-- Segurança: RLS em todas as tabelas. Dois perfis: student e teacher.
-- ============================================================================

-- ───────────── Perfis ─────────────
create table if not exists public.teacher_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);
comment on table public.teacher_allowlist is 'E-mails Google que entram como tutor (teacher) no primeiro login.';

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher');
$$;

-- Cria o perfil no primeiro login (Google). Tutor se o e-mail estiver na allowlist.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    case when exists (select 1 from public.teacher_allowlist t where lower(t.email) = lower(new.email))
         then 'teacher' else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Currículo ─────────────
create table if not exists public.levels (
  slug text primary key,
  position int not null,
  title text not null,
  emoji text,
  color text,
  objective text,
  description text
);

create table if not exists public.sessions (
  day int primary key check (day between 1 and 365),
  level_slug text not null references public.levels (slug),
  title text not null,
  why text not null,
  learn jsonb not null default '[]',
  scenarios jsonb not null default '[]',   -- [{area, text}]
  tools jsonb not null default '[]',
  connection text,
  minutes int not null default 120,
  scheduled_date date not null,
  week int not null
);

create table if not exists public.session_dependencies (
  day int not null references public.sessions (day) on delete cascade,
  requires_day int not null references public.sessions (day) on delete cascade,
  primary key (day, requires_day),
  check (requires_day < day)
);

create table if not exists public.exercises (
  id text primary key,
  session_day int not null references public.sessions (day) on delete cascade,
  position int not null,
  title text not null,
  instructions text not null,
  deliverable text not null
);

create table if not exists public.templates (
  slug text primary key,
  kind text not null check (kind in ('sql','prompt','diagram','excel','pbix','checklist','entrega')),
  title text not null,
  description text,
  content text,
  url text,
  filename text
);

create table if not exists public.resources (
  slug text primary key,
  category text not null,
  title text not null,
  url text not null,
  description text
);

create table if not exists public.session_templates (
  session_day int not null references public.sessions (day) on delete cascade,
  template_slug text not null references public.templates (slug) on delete cascade,
  position int not null default 0,
  primary key (session_day, template_slug)
);

create table if not exists public.session_resources (
  session_day int not null references public.sessions (day) on delete cascade,
  resource_slug text not null references public.resources (slug) on delete cascade,
  position int not null default 0,
  primary key (session_day, resource_slug)
);

create table if not exists public.weekly_deliverables (
  week int primary key,
  title text not null,
  description text not null,
  start_date date not null,
  due_date date not null,
  session_day int not null references public.sessions (day)
);

-- ───────────── Entregas e avaliações ─────────────
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  exercise_id text not null references public.exercises (id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  attempt int not null default 1,
  content text,
  link_url text,
  status text not null default 'submitted' check (status in ('submitted','approved','revision_requested')),
  created_at timestamptz not null default now(),
  unique (exercise_id, student_id, attempt),
  check (coalesce(length(trim(content)), 0) > 0 or coalesce(length(trim(link_url)), 0) > 0)
);
create index if not exists submissions_student_idx on public.submissions (student_id);
create index if not exists submissions_status_idx on public.submissions (status);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  tutor_id uuid not null default auth.uid() references public.profiles (id),
  score numeric(3,1) not null check (score between 0 and 10),
  verdict text not null check (verdict in ('approved','revision_requested')),
  feedback text not null,
  created_at timestamptz not null default now()
);

-- ───────────── Regras de progressão (dependências) ─────────────
-- Sessão concluída = todos os exercícios têm ao menos uma entrega aprovada pelo tutor.
create or replace function public.session_done(p_student uuid, p_day int)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.exercises e
    where e.session_day = p_day
      and not exists (
        select 1 from public.submissions s
        where s.exercise_id = e.id and s.student_id = p_student and s.status = 'approved')
  );
$$;

-- Sessão liberada = todas as dependências concluídas.
create or replace function public.session_unlocked(p_student uuid, p_day int)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.session_dependencies d
    where d.day = p_day and not public.session_done(p_student, d.requires_day)
  );
$$;

-- Usadas só por triggers (security definer): não expor via RPC.
revoke execute on function public.session_done(uuid, int) from public, anon, authenticated;
revoke execute on function public.session_unlocked(uuid, int) from public, anon, authenticated;

-- Antes de inserir uma entrega: força aluno, tentativa e status; valida bloqueios.
create or replace function public.before_submission_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_day int;
  v_last record;
begin
  new.student_id := auth.uid();
  new.status := 'submitted';

  select e.session_day into v_day from public.exercises e where e.id = new.exercise_id;
  if v_day is null then raise exception 'Exercício inexistente'; end if;

  if not public.session_unlocked(new.student_id, v_day) then
    raise exception 'Sessão bloqueada: conclua as sessões anteriores (dependências) primeiro.' using errcode = 'P0001';
  end if;

  select s.attempt, s.status into v_last
  from public.submissions s
  where s.exercise_id = new.exercise_id and s.student_id = new.student_id
  order by s.attempt desc limit 1;

  if found and v_last.status = 'submitted' then
    raise exception 'Você já tem uma entrega aguardando avaliação do tutor neste exercício.' using errcode = 'P0001';
  end if;

  new.attempt := coalesce(v_last.attempt, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_before_submission_insert on public.submissions;
create trigger trg_before_submission_insert before insert on public.submissions
  for each row execute function public.before_submission_insert();

-- Antes de salvar a avaliação: só tutor, registra o tutor.
create or replace function public.before_review_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() then raise exception 'Apenas tutores podem avaliar.' using errcode = '42501'; end if;
  new.tutor_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_before_review_write on public.reviews;
create trigger trg_before_review_write before insert or update on public.reviews
  for each row execute function public.before_review_write();

-- Depois de avaliar: atualiza o status da entrega.
create or replace function public.after_review_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.submissions set status = new.verdict where id = new.submission_id;
  return new;
end;
$$;

drop trigger if exists trg_after_review_write on public.reviews;
create trigger trg_after_review_write after insert or update on public.reviews
  for each row execute function public.after_review_write();

-- ───────────── RLS ─────────────
alter table public.teacher_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.levels enable row level security;
alter table public.sessions enable row level security;
alter table public.session_dependencies enable row level security;
alter table public.exercises enable row level security;
alter table public.templates enable row level security;
alter table public.resources enable row level security;
alter table public.session_templates enable row level security;
alter table public.session_resources enable row level security;
alter table public.weekly_deliverables enable row level security;
alter table public.submissions enable row level security;
alter table public.reviews enable row level security;

create policy allowlist_teacher_all on public.teacher_allowlist
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_teacher());
create policy profiles_update_teacher on public.profiles
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- Currículo: leitura para qualquer usuário autenticado; escrita só tutores.
do $$
declare t text;
begin
  foreach t in array array['levels','sessions','session_dependencies','exercises','templates',
                           'resources','session_templates','session_resources','weekly_deliverables']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t || '_write', t);
  end loop;
end $$;

create policy submissions_select on public.submissions
  for select to authenticated using (student_id = auth.uid() or public.is_teacher());
create policy submissions_insert on public.submissions
  for insert to authenticated with check (student_id = auth.uid());

create policy reviews_select on public.reviews
  for select to authenticated using (
    public.is_teacher()
    or exists (select 1 from public.submissions s where s.id = submission_id and s.student_id = auth.uid()));
create policy reviews_insert on public.reviews
  for insert to authenticated with check (public.is_teacher());
create policy reviews_update on public.reviews
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- Nenhum acesso para anon.
revoke all on all tables in schema public from anon;

-- Funções de trigger não devem ser chamáveis via API (RPC); is_teacher é usada pelas policies (só autenticados).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.before_submission_insert() from public, anon, authenticated;
revoke execute on function public.before_review_write() from public, anon, authenticated;
revoke execute on function public.after_review_write() from public, anon, authenticated;
revoke execute on function public.is_teacher() from public, anon;
grant execute on function public.is_teacher() to authenticated;
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
-- GERADO por scripts/build-content.mjs a partir de content/*.mjs. Não edite à mão.
begin;
insert into public.levels (slug, position, title, emoji, color, objective, description) values ('iniciante', 1, 'Iniciante', '🌱', '#16a34a', 'Pensar como analista: formular perguntas, organizar dados, dominar Excel, SQL básico e o primeiro relatório no Power BI.', 'Semanas 1–2 · Dias 1–10 · Excel, SQL I–II, Supabase e Power BI Desktop.') on conflict (slug) do update set position=excluded.position, title=excluded.title, emoji=excluded.emoji, color=excluded.color, objective=excluded.objective, description=excluded.description;
insert into public.levels (slug, position, title, emoji, color, objective, description) values ('intermediario', 2, 'Intermediário', '🚀', '#2563eb', 'Modelar dados, combinar tabelas, transformar com Power Query, calcular com DAX e automatizar análises com Python e IA.', 'Semanas 3–4 · Dias 11–20 · SQL III–IV, modelo estrela, DAX, Python/pandas.') on conflict (slug) do update set position=excluded.position, title=excluded.title, emoji=excluded.emoji, color=excluded.color, objective=excluded.objective, description=excluded.description;
insert into public.levels (slug, position, title, emoji, color, objective, description) values ('avancado', 3, 'Avançado', '🏆', '#9333ea', 'Gerar decisões: segmentação, previsão, testes A/B, análise financeira, IA aplicada, dashboards executivos e projeto final.', 'Semanas 5–6 · Dias 21–30 · RFM, forecast, A/B, automação, storytelling e capstone.') on conflict (slug) do update set position=excluded.position, title=excluded.title, emoji=excluded.emoji, color=excluded.color, objective=excluded.objective, description=excluded.description;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (1, 'iniciante', 'Mentalidade analítica e perguntas de negócio', 'Análise sem pergunta vira relatório que ninguém usa. Antes de qualquer ferramenta, você precisa saber transformar um problema vago ("vendas caíram") em uma pergunta mensurável, com métrica, recorte e decisão associada.', '["O ciclo da análise: Pergunta → Dados → Análise → Insight → Decisão","Diferença entre dado, métrica, KPI e indicador","Como escrever uma pergunta SMART de negócio","Tipos de análise: descritiva, diagnóstica, preditiva e prescritiva"]'::jsonb, '[{"area":"Comercial","text":"O diretor diz \"as vendas do app estão estranhas\". Qual métrica, período e comparação transformam isso em pergunta?"},{"area":"Marketing","text":"\"Qual canal traz clientes que mais compram em 90 dias?\" – métrica, recorte e decisão (onde investir)."},{"area":"Esporte","text":"Um clube quer saber se o público em casa influencia a receita de bilheteria por jogo."}]'::jsonb, '["Papel/Miro/Excel para mapear perguntas","Dataset de treinamento (Excel)"]'::jsonb, 'Hoje não há código. Você aprende a olhar o dataset como um analista: quais tabelas existem, o que cada linha representa (granularidade) e quais perguntas ele consegue responder.', 120, '2026-11-09', 1) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (2, 'iniciante', 'Excel: organização e qualidade dos dados', 'Cerca de 80% do tempo de uma análise vai para preparar dados. Dados bem estruturados (uma linha por registro, uma coluna por atributo) evitam erros e permitem automação.', '["Princípios de dados \"tidy\": 1 linha = 1 registro","Formatar como Tabela (Ctrl+T) e referências estruturadas","Remover duplicados, tratar vazios, padronizar texto (ARRUMAR, MAIÚSCULA)","Validação de dados e tipos (data vs. texto vs. número)"]'::jsonb, '[{"area":"Financeiro","text":"Lançamentos com datas em texto e valores com vírgula/ponto misturados quebram o fechamento mensal."},{"area":"E-commerce","text":"Cadastro com o mesmo cliente digitado de 3 formas distorce a contagem de clientes únicos."}]'::jsonb, '["Microsoft Excel (365 ou 2019+)","Dataset de treinamento (Excel)"]'::jsonb, 'Os conceitos de tipos, chaves e duplicidade são os mesmos que você usará em SQL (tipos de coluna, PRIMARY KEY) e Power Query (tipagem). Excel é o laboratório mais rápido para vê-los.', 120, '2026-11-10', 1) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (3, 'iniciante', 'Excel: fórmulas essenciais para análise', 'Fórmulas permitem responder perguntas de forma repetível e auditável. Dominar condicionais, busca e agregação cobre a maior parte das análises do dia a dia administrativo.', '["SOMASES, CONT.SES, MÉDIASES","SE, E, OU, SEERRO","PROCV / PROCX / ÍNDICE+CORRESP para trazer atributos de outra tabela","Referências absolutas vs. relativas; nomes de intervalo"]'::jsonb, '[{"area":"Comercial","text":"Receita por vendedor e meta atingida (SE) para bonificação."},{"area":"Logística","text":"Percentual de entregas com atraso por transportadora com CONT.SES."},{"area":"Financeiro","text":"Trazer o centro de custo de uma tabela de de-para com PROCX."}]'::jsonb, '["Excel","Planilha do dia 2 (dados limpos)"]'::jsonb, 'PROCX equivale a um JOIN em SQL; SOMASES equivale a SUM + WHERE + GROUP BY. Guarde essa tradução: no dia 7 você fará os mesmos cálculos em SQL.', 120, '2026-11-11', 1) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (4, 'iniciante', 'Excel: tabelas dinâmicas e segmentações', 'Tabelas dinâmicas são o "GROUP BY visual": respondem em segundos perguntas de resumo e preparam o terreno para entender o modelo de dados do Power BI.', '["Linhas, colunas, valores e filtros","Agrupar datas (mês/trimestre/ano)","Campos calculados e % do total","Segmentação de dados e linha do tempo"]'::jsonb, '[{"area":"E-commerce","text":"Ranking de categorias por receita e participação % no total."},{"area":"Marketing","text":"ROI por canal de campanha e por mês."},{"area":"Esporte","text":"Público médio e bilheteria por mandante na temporada."}]'::jsonb, '["Excel – Tabela Dinâmica","Dataset"]'::jsonb, 'Cada arrasto de campo equivale a um GROUP BY. No Power BI, a matriz e os visuais funcionam da mesma forma.', 120, '2026-11-12', 1) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (5, 'iniciante', 'Excel: gráficos, storytelling e entrega da Semana 1', 'Um bom gráfico encurta a decisão. Hoje você aprende a escolher o gráfico certo e a escrever o título como conclusão, fechando a semana com seu primeiro entregável.', '["Escolha do gráfico (comparação, evolução, composição, relação)","Remover ruído: grades, 3D, legendas desnecessárias","Título-conclusão e destaque de cor","Estrutura do relatório de entrega"]'::jsonb, '[{"area":"Financeiro","text":"Evolução do resultado mensal com destaque nos meses negativos."},{"area":"Comercial","text":"Participação de cada canal na receita (barras, não pizza com 8 fatias)."}]'::jsonb, '["Excel","Template de entrega semanal"]'::jsonb, 'As regras de design valem igualmente no Power BI e no matplotlib. Você reutilizará o checklist de qualidade até o dia 30.', 150, '2026-11-13', 1) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (6, 'iniciante', 'Bancos de dados, Supabase e modelo relacional', 'Dados reais vivem em bancos, não em planilhas soltas. Entender tabelas, chaves e relacionamentos permite pedir, consultar e cruzar dados com segurança e escala.', '["Tabela, linha, coluna, tipo de dado","Chave primária e chave estrangeira","Fato vs. dimensão","Supabase = Postgres na nuvem; schema treinamento; usuário somente-leitura"]'::jsonb, '[{"area":"Logística","text":"Pedidos ligados a entregas por pedido_id: onde ficam transportadora e prazo?"},{"area":"E-commerce","text":"Um cliente com muitos pedidos, um pedido com muitos itens (1:N)."}]'::jsonb, '["Cliente SQL (DBeaver) conectado ao Supabase","Diagrama ER (Mermaid)"]'::jsonb, 'O diagrama ER é o mapa que você usará em SQL (JOINs), Power BI (relacionamentos) e Python (merge).', 120, '2026-11-16', 2) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (7, 'iniciante', 'SQL I: SELECT, WHERE, ORDER BY', 'SQL é a língua franca dos dados. Saber extrair exatamente o que precisa reduz a dependência de TI e evita planilhas gigantes.', '["SELECT, FROM, WHERE, AND/OR/IN/BETWEEN/LIKE","ORDER BY, LIMIT, DISTINCT","Operadores, datas e NULL","Boas práticas: nomear colunas, comentar, evitar SELECT * em produção"]'::jsonb, '[{"area":"Comercial","text":"Pedidos do canal marketplace de uma UF no último trimestre."},{"area":"Financeiro","text":"Lançamentos de despesa acima de R$ 10 mil em um centro de custo."}]'::jsonb, '["Cliente SQL (DBeaver)","Template t-sql-basico"]'::jsonb, 'Compare cada consulta com o filtro que você fazia no Excel (dia 2–4). O resultado deve bater.', 120, '2026-11-17', 2) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (8, 'iniciante', 'SQL II: agregações e GROUP BY', 'Decisões raramente usam linhas individuais; usam totais, médias e comparações por grupo. GROUP BY é o coração da análise de negócio.', '["COUNT, SUM, AVG, MIN, MAX","GROUP BY e HAVING","date_trunc para agrupar por mês","CASE WHEN para criar categorias"]'::jsonb, '[{"area":"Marketing","text":"CTR, CPC e CPA por canal e por mês."},{"area":"Esporte","text":"Média de gols e público por rodada."},{"area":"Logística","text":"Frete médio por UF e transportadora."}]'::jsonb, '["Cliente SQL (DBeaver)","Template t-sql-agregacao"]'::jsonb, 'É a versão em SQL da tabela dinâmica do dia 4. Reproduza uma dinâmica sua em SQL.', 120, '2026-11-18', 2) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (9, 'iniciante', 'Power BI Desktop: instalação, conexão e primeiro relatório', 'O Power BI reúne conexão, modelagem e visualização em uma só ferramenta e é o padrão de mercado para dashboards gerenciais interativos.', '["Instalar o Power BI Desktop","Obter dados: PostgreSQL (Supabase) e Excel","Importar vs. DirectQuery","Visuais básicos: cartão, barras, linhas, segmentações"]'::jsonb, '[{"area":"Comercial","text":"Dashboard de receita por canal com filtro de ano para a reunião de segunda."},{"area":"E-commerce","text":"Funil de pedidos por status (pendente → entregue)."}]'::jsonb, '["Power BI Desktop (Windows)","Supabase (Postgres)","Excel"]'::jsonb, 'As tabelas do Supabase viram o modelo do Power BI. O que você fez em SQL (agregar) o Power BI faz de forma visual e interativa.', 150, '2026-11-19', 2) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (10, 'iniciante', 'Design de relatórios e entrega da Semana 2', 'Relatório bonito não é enfeite: layout e hierarquia visual guiam a leitura e evitam interpretações erradas.', '["Hierarquia visual e grade","Cores com propósito e acessibilidade","Interações: filtros cruzados, tooltips, bookmarks","Validar números contra o SQL"]'::jsonb, '[{"area":"Financeiro","text":"Painel com receitas x despesas x resultado e alerta de mês negativo."},{"area":"Marketing","text":"Painel de campanhas: investimento, conversões e CPA por canal."}]'::jsonb, '["Power BI Desktop","Checklist de qualidade"]'::jsonb, 'Seus 10 SQLs dos dias 7–8 viram a "prova real": os cartões do relatório precisam bater com eles.', 150, '2026-11-20', 2) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (11, 'intermediario', 'SQL III: JOINs e combinação de tabelas', 'Quase toda pergunta relevante cruza tabelas (quem comprou o quê, quando, entregue por quem). JOINs corretos evitam o erro mais comum: duplicar linhas e inflar números.', '["INNER, LEFT, RIGHT, FULL JOIN","Cardinalidade e o risco de duplicação","Anti-join (LEFT + IS NULL)","Conferência de totais antes e depois do JOIN"]'::jsonb, '[{"area":"E-commerce","text":"Clientes cadastrados que nunca compraram (campanha de ativação)."},{"area":"Logística","text":"Atraso por transportadora cruzando pedidos e entregas."},{"area":"Comercial","text":"Margem por categoria cruzando itens e produtos."}]'::jsonb, '["Cliente SQL (DBeaver)","Template t-sql-joins"]'::jsonb, 'Os relacionamentos que você desenhará no Power BI (dia 13) são JOINs permanentes; entender o SQL evita erros de modelo.', 120, '2026-11-23', 3) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (12, 'intermediario', 'SQL IV: CTEs, subqueries e window functions', 'Rankings, acumulados e variações período a período são perguntas diárias de gestão. Window functions resolvem sem planilhas auxiliares.', '["WITH (CTE) para organizar consultas","ROW_NUMBER, RANK, NTILE","LAG/LEAD e acumulados (SUM OVER)","FILTER e CASE em agregações"]'::jsonb, '[{"area":"Financeiro","text":"Caixa acumulado e variação mês a mês."},{"area":"Comercial","text":"Top 3 produtos por categoria."},{"area":"Esporte","text":"Classificação da temporada com pontos acumulados por rodada."}]'::jsonb, '["Cliente SQL (DBeaver)","Template t-sql-cte-window"]'::jsonb, 'As mesmas ideias aparecem como medidas DAX (YTD, mês anterior) nos dias 15–16.', 150, '2026-11-24', 3) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (13, 'intermediario', 'Modelagem dimensional: modelo estrela', 'Um bom modelo torna as medidas simples, rápidas e corretas. Um modelo ruim gera números diferentes em cada tela.', '["Fato vs. dimensão e granularidade","Esquema estrela vs. flocos de neve","Tabela de datas (calendário) obrigatória","Direção de filtro e relacionamentos 1:N"]'::jsonb, '[{"area":"E-commerce","text":"Fato vendas com dimensões Data, Cliente, Produto e Canal."},{"area":"Marketing","text":"Fato campanhas com dimensão Canal compartilhada com vendas (dimensão conforme)."}]'::jsonb, '["Power BI – Modo Modelo","Mermaid (desenho do modelo)"]'::jsonb, 'Você aplica o que viu em JOINs: cada relacionamento do modelo é um JOIN que o Power BI executa para você.', 120, '2026-11-25', 3) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (14, 'intermediario', 'Power Query: ETL sem código', 'Transformações feitas no Power Query ficam registradas e se repetem a cada atualização, eliminando a "limpeza manual" mensal.', '["Etapas aplicadas e linguagem M (visão geral)","Tipagem, divisão, mesclagem e acréscimo de consultas","Colunas personalizadas e condicionais","Parâmetros e boas práticas de desempenho"]'::jsonb, '[{"area":"Financeiro","text":"Consolidar 12 arquivos mensais de lançamentos numa só tabela."},{"area":"Logística","text":"Criar a coluna no_prazo e dias_atraso na tabela de entregas."}]'::jsonb, '["Power Query (Power BI/Excel)","Fluxo ETL (diagrama)"]'::jsonb, 'Power Query faz o papel do SQL de preparação e do pandas de limpeza. Decidir onde transformar (banco, Power Query ou Python) é uma habilidade-chave.', 120, '2026-11-26', 3) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (15, 'intermediario', 'DAX I: medidas e contexto – entrega da Semana 3', 'Medidas DAX calculam números corretos em qualquer filtro. Entender contexto de filtro é o que separa quem "arrasta campos" de quem constrói análises confiáveis.', '["Coluna calculada vs. medida","Contexto de linha e de filtro","CALCULATE, SUMX, DIVIDE, DISTINCTCOUNT","ALL / REMOVEFILTERS para % do total"]'::jsonb, '[{"area":"Comercial","text":"Ticket médio e % da receita por canal."},{"area":"Marketing","text":"CPA e ROAS por campanha."}]'::jsonb, '["Power BI Desktop","DAX Guide","Pacote de medidas DAX"]'::jsonb, 'Compare o resultado de cada medida com a query SQL equivalente (dias 8 e 11). Divergências revelam erros de modelo.', 150, '2026-11-27', 3) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (16, 'intermediario', 'DAX II: inteligência de tempo', 'Gestores comparam sempre com o período anterior. Inteligência de tempo entrega YTD, mês anterior e 12 meses móveis sem refazer cálculos.', '["Tabela de datas marcada como tal","TOTALYTD, DATEADD, SAMEPERIODLASTYEAR","Médias móveis (DATESINPERIOD)","Variações absolutas e percentuais"]'::jsonb, '[{"area":"Financeiro","text":"Resultado acumulado no ano vs. ano anterior."},{"area":"E-commerce","text":"Receita dos últimos 12 meses e crescimento mensal."}]'::jsonb, '["Power BI Desktop","Pacote DAX"]'::jsonb, 'Equivale às window functions LAG/SUM OVER do dia 12; use a SQL como gabarito.', 120, '2026-11-30', 4) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (17, 'intermediario', 'Python: instalação, VS Code e pandas básico', 'Python automatiza análises repetidas e abre portas para estatística, previsão e IA. Para o administrativo, o objetivo não é programar tudo, e sim saber pedir, ler e validar código.', '["Instalar Python e VS Code","Ambiente virtual e pip","DataFrame: ler CSV/Excel, head, info, describe","Selecionar, filtrar e ordenar com pandas"]'::jsonb, '[{"area":"Comercial","text":"Ler a planilha de pedidos e filtrar o canal app em segundos."},{"area":"Logística","text":"Calcular dias de atraso e listar os piores casos."}]'::jsonb, '["Python 3.12+","VS Code","pandas"]'::jsonb, 'Cada operação pandas tem equivalente em SQL (query, groupby) e Excel (filtro, dinâmica). Veja a tabela de tradução no template de prompt.', 150, '2026-12-01', 4) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (18, 'intermediario', 'Python com IA: limpeza e análise com pandas', 'Assistentes de IA aceleram a escrita de código, mas só quem sabe especificar e revisar evita erros silenciosos. Hoje você treina o ciclo especificar → gerar → revisar → testar.', '["Como escrever um bom prompt analítico (contexto, dados, restrições, saída)","groupby, merge, pivot_table","Revisar código da IA (joins, filtros, nulos)","Registrar prompts e versões"]'::jsonb, '[{"area":"Financeiro","text":"Conciliar lançamentos com merge e achar divergências."},{"area":"Marketing","text":"CPA por canal com groupby e formatação em R$."}]'::jsonb, '["Assistente de IA (Claude)","Python + pandas","Templates de prompt"]'::jsonb, 'O prompt carrega o que você aprendeu: pergunta (dia 1), modelo (dia 13) e regras de negócio. Quanto melhor a especificação, melhor o código.', 150, '2026-12-02', 4) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (19, 'intermediario', 'Visualização em Python e estatística descritiva', 'Média engana. Distribuição, mediana e outliers mostram o que realmente acontece, e gráficos programáticos garantem reprodutibilidade.', '["Média, mediana, desvio, percentis","Histograma, boxplot, dispersão, heatmap","Correlação ≠ causalidade","Gráficos com título-conclusão em matplotlib/seaborn"]'::jsonb, '[{"area":"Esporte","text":"Distribuição de público: a média esconde jogos lotados e vazios?"},{"area":"Logística","text":"Distribuição do tempo de entrega por transportadora (boxplot)."},{"area":"E-commerce","text":"Relação entre desconto e quantidade por pedido."}]'::jsonb, '["Python (pandas, matplotlib, seaborn)","Template p-viz"]'::jsonb, 'Aplica o checklist de qualidade visual do Excel/Power BI em código.', 120, '2026-12-03', 4) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (20, 'intermediario', 'Python + Supabase e entrega da Semana 4', 'Conectar Python direto ao banco elimina exportações manuais e garante que todos analisam a mesma versão dos dados.', '["Conexão segura (variáveis de ambiente, .env, SSL)","pandas.read_sql com SQLAlchemy","Parametrizar consultas","Estruturar um notebook reprodutível"]'::jsonb, '[{"area":"Comercial","text":"Relatório diário de vendas consultando o banco ao vivo."},{"area":"Financeiro","text":"Conferência automática do fechamento mensal."}]'::jsonb, '["Python","Supabase (usuário aluno_leitura)","Prompt p-supabase-conexao"]'::jsonb, 'Une SQL (dias 7–12) + pandas (17–19): o SQL traz o dado agregado; o Python refina, visualiza e interpreta.', 150, '2026-12-04', 4) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (21, 'avancado', 'KPIs por área e árvore de métricas', 'Métricas soltas confundem; árvores de métricas mostram o que move o resultado e onde agir.', '["Árvore de métricas (North Star → drivers)","KPIs de Comercial, Financeiro, Logística, E-commerce, Marketing e Esporte","Leading vs. lagging indicators","Metas, limites e alertas"]'::jsonb, '[{"area":"E-commerce","text":"Receita = visitantes × conversão × ticket médio; qual driver caiu?"},{"area":"Esporte","text":"Receita de bilheteria = público × preço médio; o que muda com a posição na tabela?"}]'::jsonb, '["Excel x-kpis","Power BI","SQL"]'::jsonb, 'Conecta tudo: cada folha da árvore vira uma consulta SQL ou medida DAX.', 120, '2026-12-07', 5) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (22, 'avancado', 'Segmentação de clientes: RFM e coortes', 'Nem todo cliente vale o mesmo. Segmentar permite campanhas, atendimento e preços diferentes, aumentando retenção e ROI.', '["Recência, Frequência e Valor (RFM)","NTILE e regras de segmento","Análise de coortes e retenção","Ações por segmento"]'::jsonb, '[{"area":"Marketing","text":"Reativar \"Em risco\" com cupom e proteger \"Campeões\" com benefícios."},{"area":"E-commerce","text":"Retenção por canal de aquisição."}]'::jsonb, '["SQL","Python","Power BI"]'::jsonb, 'Query RFM em SQL → visual no Power BI → interpretação com Python/IA.', 150, '2026-12-08', 5) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (23, 'avancado', 'Previsão de séries temporais (forecast)', 'Planejar estoque, caixa e metas exige olhar para frente. O essencial é saber comparar modelos simples e comunicar a incerteza.', '["Tendência e sazonalidade","Baselines: média móvel e sazonal ingênuo","Holt-Winters","Erro (MAE/MAPE) e quando não confiar"]'::jsonb, '[{"area":"Financeiro","text":"Projeção de receita e caixa para os próximos 6 meses."},{"area":"Logística","text":"Previsão de volume de pedidos para dimensionar equipe na alta temporada."}]'::jsonb, '["Python (statsmodels)","Prompt p-forecast","Power BI (forecast visual)"]'::jsonb, 'A série vem do SQL do dia 12; o Python faz o modelo; o Power BI mostra o resultado.', 150, '2026-12-09', 5) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (24, 'avancado', 'Testes A/B e inferência para decisão', 'Testar antes de escalar evita decisões caras baseadas em sorte. Você aprende a ler p-valor e intervalo de confiança como gestor.', '["Hipótese nula e alternativa","Teste de duas proporções","p-valor, intervalo de confiança e poder","Armadilhas: parar cedo, múltiplos testes, sazonalidade"]'::jsonb, '[{"area":"Marketing","text":"Assunto de e-mail A vs. B: qual converte mais?"},{"area":"E-commerce","text":"Frete grátis acima de R$ X aumenta o ticket médio?"}]'::jsonb, '["Python (statsmodels)","Prompt p-abtest"]'::jsonb, 'Usa taxas calculadas em SQL (dia 8) e a revisão crítica de código (dia 18).', 120, '2026-12-10', 5) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (25, 'avancado', 'Análise financeira e entrega da Semana 5', 'Toda análise administrativa termina em impacto financeiro. DRE, fluxo de caixa e orçado x realizado traduzem dados em decisão de investimento.', '["DRE simplificada e margem","Fluxo de caixa acumulado","Orçado x realizado e variações","Sensibilidade simples (e se o custo subir 5%?)"]'::jsonb, '[{"area":"Financeiro","text":"Variação de despesas por centro de custo vs. orçamento."},{"area":"Comercial","text":"Impacto no resultado de reduzir desconto em 2 p.p."},{"area":"Esporte","text":"Resultado da temporada: bilheteria vs. custos operacionais."}]'::jsonb, '["SQL","Excel DRE","Power BI"]'::jsonb, 'Reúne SQL (agregação), Excel (modelo) e Power BI (visual) numa análise completa com recomendação.', 150, '2026-12-11', 5) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (26, 'avancado', 'IA aplicada à análise: prompts, validação e ética', 'A IA multiplica a produtividade, mas também erra com confiança. Você precisa de processo para verificar resultados e proteger dados sensíveis.', '["Padrão de prompt: papel, contexto, tarefa, restrições, formato","Few-shot e iteração","Alucinação e checagem por testes","LGPD: nunca enviar dados pessoais reais a ferramentas não aprovadas"]'::jsonb, '[{"area":"Marketing","text":"Resumir comentários de clientes sem expor dados pessoais."},{"area":"Financeiro","text":"Gerar código de conciliação e validar com totais de controle."}]'::jsonb, '["Assistente de IA","Prompts p-*","Checklist de revisão"]'::jsonb, 'Todos os prompts da biblioteca seguem este padrão; hoje você cria os seus.', 120, '2026-12-14', 6) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (27, 'avancado', 'Automação de relatórios com Python', 'Se você repete uma análise toda semana, ela deve rodar sozinha: menos esforço, menos erros e mais tempo para interpretar.', '["Estrutura de script (funções, main, argparse)","Gerar Excel formatado e imagens","Logs e tratamento de erros","Agendamento (Windows Task Scheduler / cron)"]'::jsonb, '[{"area":"Comercial","text":"Relatório semanal de vendas por e-mail às segundas."},{"area":"Logística","text":"Alerta diário de pedidos atrasados."}]'::jsonb, '["Python (openpyxl, pandas)","Prompt p-automacao"]'::jsonb, 'Une consultas SQL, tratamento pandas e gráficos numa rotina completa.', 150, '2026-12-15', 6) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (28, 'avancado', 'Dashboard executivo avançado no Power BI', 'Executivos têm 2 minutos. Navegação clara, drill-through e segurança por perfil entregam a resposta certa para a pessoa certa.', '["Drill-through e tooltips de página","Bookmarks e botões","Segurança em nível de linha (RLS)","Desempenho e publicação"]'::jsonb, '[{"area":"Comercial","text":"Gerente regional vê só sua região (RLS)."},{"area":"Financeiro","text":"Do resultado consolidado ao detalhe por centro de custo com drill-through."}]'::jsonb, '["Power BI Desktop","Checklist de qualidade"]'::jsonb, 'Usa o modelo (dia 13), as medidas (15–16) e os KPIs (21).', 150, '2026-12-16', 6) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (29, 'avancado', 'Data storytelling e apresentação executiva', 'Uma análise só gera valor se for compreendida e levar à ação. Storytelling transforma números em decisão.', '["Estrutura Contexto → Problema → Evidência → Recomendação","Títulos como conclusões","Reduzir carga cognitiva","Responder objeções"]'::jsonb, '[{"area":"Marketing","text":"Convencer o diretor a realocar 20% do orçamento."},{"area":"Esporte","text":"Apresentar à diretoria o impacto de preços de ingresso no público."}]'::jsonb, '["PowerPoint/Google Slides","Roteiro de 5 slides"]'::jsonb, 'Seleciona os melhores resultados de SQL, Power BI e Python para a narrativa.', 120, '2026-12-17', 6) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
insert into public.sessions (day, level_slug, title, why, learn, scenarios, tools, connection, minutes, scheduled_date, week) values (30, 'avancado', 'Projeto final (capstone) e defesa', 'Fecha o ciclo: você escolhe uma área e entrega uma solução completa, do dado à decisão, defendida ao tutor.', '["Integrar SQL + Power BI + Python","Documentação e reprodutibilidade","Defesa técnica e de negócio","Plano de continuidade de estudos"]'::jsonb, '[{"area":"Comercial","text":"Plano para elevar a margem em 2 p.p."},{"area":"Logística","text":"Reduzir o atraso em 30% em 2 trimestres."},{"area":"Esporte","text":"Estratégia de ocupação do estádio."}]'::jsonb, '["Todas as ferramentas do programa"]'::jsonb, 'Use o diagrama de fluxo ETL para mostrar a arquitetura da sua solução.', 180, '2026-12-18', 6) on conflict (day) do update set level_slug=excluded.level_slug, title=excluded.title, why=excluded.why, learn=excluded.learn, scenarios=excluded.scenarios, tools=excluded.tools, connection=excluded.connection, minutes=excluded.minutes, scheduled_date=excluded.scheduled_date, week=excluded.week;
delete from public.session_dependencies;
insert into public.session_dependencies (day, requires_day) values (2, 1);
insert into public.session_dependencies (day, requires_day) values (3, 2);
insert into public.session_dependencies (day, requires_day) values (4, 3);
insert into public.session_dependencies (day, requires_day) values (5, 4);
insert into public.session_dependencies (day, requires_day) values (6, 1);
insert into public.session_dependencies (day, requires_day) values (7, 6);
insert into public.session_dependencies (day, requires_day) values (8, 7);
insert into public.session_dependencies (day, requires_day) values (9, 5);
insert into public.session_dependencies (day, requires_day) values (9, 8);
insert into public.session_dependencies (day, requires_day) values (10, 9);
insert into public.session_dependencies (day, requires_day) values (11, 8);
insert into public.session_dependencies (day, requires_day) values (12, 11);
insert into public.session_dependencies (day, requires_day) values (13, 10);
insert into public.session_dependencies (day, requires_day) values (13, 11);
insert into public.session_dependencies (day, requires_day) values (14, 13);
insert into public.session_dependencies (day, requires_day) values (15, 14);
insert into public.session_dependencies (day, requires_day) values (16, 15);
insert into public.session_dependencies (day, requires_day) values (17, 10);
insert into public.session_dependencies (day, requires_day) values (18, 17);
insert into public.session_dependencies (day, requires_day) values (19, 18);
insert into public.session_dependencies (day, requires_day) values (20, 12);
insert into public.session_dependencies (day, requires_day) values (20, 19);
insert into public.session_dependencies (day, requires_day) values (21, 16);
insert into public.session_dependencies (day, requires_day) values (21, 20);
insert into public.session_dependencies (day, requires_day) values (22, 21);
insert into public.session_dependencies (day, requires_day) values (23, 19);
insert into public.session_dependencies (day, requires_day) values (23, 21);
insert into public.session_dependencies (day, requires_day) values (24, 23);
insert into public.session_dependencies (day, requires_day) values (25, 16);
insert into public.session_dependencies (day, requires_day) values (25, 22);
insert into public.session_dependencies (day, requires_day) values (26, 20);
insert into public.session_dependencies (day, requires_day) values (27, 26);
insert into public.session_dependencies (day, requires_day) values (28, 16);
insert into public.session_dependencies (day, requires_day) values (28, 25);
insert into public.session_dependencies (day, requires_day) values (29, 28);
insert into public.session_dependencies (day, requires_day) values (30, 24);
insert into public.session_dependencies (day, requires_day) values (30, 27);
insert into public.session_dependencies (day, requires_day) values (30, 29);
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d01-e1', 1, 1, 'Dissecando 5 pedidos vagos', 'Reescreva 5 pedidos vagos (ex.: "melhorar a logística") como perguntas com métrica, recorte, período e decisão.', 'Documento com 5 perguntas SMART') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d01-e2', 1, 2, 'Reconhecimento do dataset', 'Abra o Excel do treinamento, descreva em 1 linha cada aba e a granularidade (o que representa uma linha).', 'Tabela: aba | granularidade | 2 perguntas possíveis') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d01-e3', 1, 3, 'Catálogo de KPIs', 'Escolha 2 áreas (ex.: Comercial e Logística) e liste 4 KPIs de cada com fórmula e fonte.', 'Planilha x-kpis preenchida') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d02-e1', 2, 1, 'Diagnóstico de qualidade', 'Na aba fato_pedidos, conte nulos, duplicados e tipos por coluna. Registre o que encontrou.', 'Aba "Diagnostico" com tabela de achados') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d02-e2', 2, 2, 'Limpeza com tabela', 'Converta para Tabela, padronize textos e crie coluna calculada "ano_mes".', 'Planilha com dados limpos + coluna ano_mes') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d03-e1', 3, 1, 'Receita por canal e status', 'Calcule com SOMASES a receita por canal (exclua cancelados).', 'Tabela de resultados na aba Calculos') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d03-e2', 3, 2, 'PROCX de produtos', 'Traga categoria e custo de dim_produtos para os itens e calcule a margem por item.', 'Coluna de margem funcionando') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d03-e3', 3, 3, 'Taxa de atraso', 'Calcule % de entregas com atraso por transportadora.', 'Tabela + fórmula usada') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d04-e1', 4, 1, 'Tabela dinâmica de receita', 'Monte receita por mês x categoria com % do total da linha.', 'Aba Dinamica') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d04-e2', 4, 2, 'Perguntas rápidas', 'Responda: top 5 UF por receita; mês de pico; canal com maior ticket médio.', 'Respostas com print da dinâmica') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d05-e1', 5, 1, '4 gráficos que respondem a 3 perguntas', 'Crie 4 gráficos com título-conclusão no painel.', 'Aba Painel') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d05-e2', 5, 2, 'Relatório de entrega', 'Escreva o relatório seguindo o modelo (pergunta, método, 3 achados, recomendação).', 'PDF/Doc do relatório') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d06-e1', 6, 1, 'Ler o diagrama ER', 'Identifique PK/FK e cardinalidade de cada relacionamento.', 'Tabela PK/FK + cardinalidade') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d06-e2', 6, 2, 'Primeiro acesso', 'Siga o guia "conectar ao banco" (DBeaver + usuário aluno_leitura) e rode SELECT COUNT(*) em cada tabela.', 'Print/ tabela de contagens') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d06-e3', 6, 3, 'Desenhe um modelo seu', 'Desenhe o ER de uma área da sua empresa com 4 tabelas.', 'Diagrama Mermaid ou imagem') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d07-e1', 7, 1, '10 consultas de filtro', 'Escreva 10 consultas com WHERE/ORDER/LIMIT sobre pedidos, clientes e financeiro.', 'Arquivo .sql comentado') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d07-e2', 7, 2, 'Bate com o Excel?', 'Compare 2 resultados SQL com a planilha e explique diferenças.', 'Nota de conferência') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d08-e1', 8, 1, 'Receita mensal em SQL', 'Reproduza em SQL a dinâmica de receita por mês.', 'Query + resultado') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d08-e2', 8, 2, 'Métricas de marketing', 'Calcule CTR, CPC, CPA e ROAS por canal.', 'Query com métricas nomeadas') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d08-e3', 8, 3, 'Faixas com CASE', 'Classifique pedidos em faixas de valor e conte por faixa.', 'Query + comentário') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d09-e1', 9, 1, 'Instalar e conectar', 'Instale o Power BI Desktop e conecte ao Supabase (ou ao Excel se o acesso ao banco não estiver liberado).', 'Print da lista de tabelas carregadas') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d09-e2', 9, 2, 'Página 1: Visão executiva', 'Crie 4 cartões, 1 linha mensal, 1 barras por categoria e 2 segmentações.', 'Arquivo .pbix v1') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d10-e1', 10, 1, 'Página 2 e refinamento', 'Crie a página 2 (Logística ou Marketing) e aplique o checklist em ambas.', '.pbix com 2 páginas') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d10-e2', 10, 2, '10 consultas SQL finais', 'Consolide 10 consultas comentadas e valide 3 totais contra o relatório.', 'Arquivo .sql') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d10-e3', 10, 3, 'Relatório da semana', 'Preencha o modelo de entrega semanal.', 'Documento de entrega') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d11-e1', 11, 1, 'Margem por categoria', 'Calcule receita, custo e margem % por categoria.', 'Query validada') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d11-e2', 11, 2, 'Anti-join', 'Liste clientes sem compras por canal de aquisição.', 'Query + contagem') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d11-e3', 11, 3, 'Teste de duplicação', 'Demonstre com contagens que o JOIN não duplicou linhas.', 'Nota com conferência') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d12-e1', 12, 1, 'Variação mês a mês', 'Calcule receita, mês anterior, var % e acumulado.', 'Query') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d12-e2', 12, 2, 'Top N por grupo', 'Top 3 produtos por categoria com RANK.', 'Query') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d12-e3', 12, 3, 'Tabela de classificação', 'Monte a classificação de uma temporada de esporte_partidas.', 'Query + prints') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d13-e1', 13, 1, 'Desenhar o modelo estrela', 'Desenhe o modelo com granularidade declarada.', 'Diagrama Mermaid/imagem') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d13-e2', 13, 2, 'Montar no Power BI', 'Importe as tabelas, crie dim_data e os relacionamentos corretos.', 'Print do modelo') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d14-e1', 14, 1, 'Colunas de logística', 'Crie no_prazo (booleano) e dias_atraso em fato_entregas.', 'Etapas aplicadas documentadas') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d14-e2', 14, 2, 'Mapa do fluxo ETL', 'Desenhe o fluxo fonte → transformação → modelo → relatório.', 'Diagrama') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d15-e1', 15, 1, '8 medidas base', 'Crie Receita, Custo, Margem %, Pedidos, Ticket Médio, CPA, ROAS e % do Total.', 'Lista de medidas + prints') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d15-e2', 15, 2, 'Validação cruzada', 'Prove que 3 medidas batem com SQL.', 'Tabela de conferência') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d16-e1', 16, 1, 'Painel de variação', 'Crie YTD, Mês Ant., Var % e 12M e exiba em linha + cartões.', 'Página .pbix') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d16-e2', 16, 2, 'Caso de teste', 'Escolha um mês e confirme os valores com SQL.', 'Nota de validação') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d17-e1', 17, 1, 'Ambiente funcionando', 'Instale Python, crie venv e rode um script que imprime a versão e o shape do dataset.', 'Print do terminal') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d17-e2', 17, 2, 'Exploração inicial', 'Carregue o Excel e responda 5 perguntas simples com pandas.', 'Script .py comentado') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d18-e1', 18, 1, 'Limpeza guiada por IA', 'Use o prompt de limpeza, execute o código e liste 2 correções que você precisou fazer.', 'Código + log de revisão') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d18-e2', 18, 2, 'Análise de margem', 'Gere e valide análise de margem por categoria e compare com a SQL do dia 11.', 'Script + conferência') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d19-e1', 19, 1, '3 gráficos com insight', 'Crie histograma, boxplot e dispersão com título-conclusão.', 'PNGs + script') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d19-e2', 19, 2, 'Outliers', 'Identifique outliers de frete e proponha tratamento.', 'Nota técnica') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d20-e1', 20, 1, 'Conexão segura', 'Conecte ao Supabase sem expor a senha e leia fato_pedidos.', 'Script + .env.example') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d20-e2', 20, 2, 'Notebook final', 'Notebook que consulta, limpa, analisa e gera 3 gráficos com texto de conclusão.', 'Notebook .ipynb') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d21-e1', 21, 1, 'Árvore de métricas', 'Desenhe a árvore da receita de e-commerce com 3 níveis.', 'Diagrama') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d21-e2', 21, 2, 'Implementar 5 KPIs', 'Calcule 5 KPIs da árvore em SQL ou DAX.', 'Queries/medidas') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d22-e1', 22, 1, 'RFM em SQL', 'Rode o RFM, valide a distribuição dos segmentos e explique as regras.', 'Query + tabela de segmentos') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d22-e2', 22, 2, 'Ação por segmento', 'Proponha 1 ação por segmento com meta e custo estimado.', 'Plano de ação') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d23-e1', 23, 1, 'Comparar 3 modelos', 'Compare MA3, sazonal ingênuo e Holt-Winters com MAPE.', 'Notebook + tabela de erros') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d23-e2', 23, 2, 'Previsão de 6 meses', 'Projete 6 meses com faixa de incerteza e comente premissas.', 'Gráfico + 5 linhas de leitura') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d24-e1', 24, 1, 'Rodar um teste A/B', 'Analise o cenário fornecido pelo tutor ou use dados de fato_campanhas.', 'Notebook + decisão') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d24-e2', 24, 2, 'Recomendação executiva', 'Escreva a recomendação em 3 linhas para o diretor.', 'Texto') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d25-e1', 25, 1, 'DRE e caixa', 'Monte DRE mensal e caixa acumulado em SQL e Excel.', 'Query + planilha') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d25-e2', 25, 2, 'Relatório da semana', 'Segmentação (RFM) + previsão + financeiro com recomendação por área.', 'Documento de entrega') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d26-e1', 26, 1, 'Criar 2 prompts próprios', 'Crie prompts para tarefas da sua rotina e registre versões v1→v2.', 'Biblioteca de prompts') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d26-e2', 26, 2, 'Caça aos erros', 'Revise um código com 3 erros plantados pelo tutor.', 'Tabela Problema|Correção') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d27-e1', 27, 1, 'Script de relatório', 'Gere relatorio_semanal.py com a IA, revise e rode.', 'Script + Excel gerado') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d27-e2', 27, 2, 'Plano de agendamento', 'Escreva os passos para agendar e monitorar.', 'Passo a passo') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d28-e1', 28, 1, 'Dashboard v2', 'Adicione drill-through, bookmark e tooltip.', '.pbix v2') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d28-e2', 28, 2, 'RLS de demonstração', 'Crie 2 funções e teste com Exibir como.', 'Prints dos testes') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d29-e1', 29, 1, 'Apresentação de 5 slides', 'Monte a história do seu projeto final.', 'Deck') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d29-e2', 29, 2, 'Ensaio de 5 minutos', 'Grave ou ensaie e liste as 3 perguntas difíceis que esperam de você.', 'Lista de perguntas e respostas') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d30-e1', 30, 1, 'Dashboard + notebook + SQL', 'Entregue os artefatos organizados em pasta/repositório com README.', 'Link da pasta') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.exercises (id, session_day, position, title, instructions, deliverable) values ('d30-e2', 30, 2, 'Apresentação ao tutor', 'Apresente em 10 minutos e responda perguntas.', 'Slides + gravação/ata') on conflict (id) do update set session_day=excluded.session_day, position=excluded.position, title=excluded.title, instructions=excluded.instructions, deliverable=excluded.deliverable;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('t-sql-basico', 'sql', 'Consultas básicas (SELECT / WHERE / ORDER BY)', 'Primeiras consultas no schema treinamento.', '-- 1) Conhecer a tabela
SELECT * FROM treinamento.fato_pedidos LIMIT 20;

-- 2) Filtrar: pedidos entregues do canal app em 2025
SELECT pedido_id, data_pedido, canal, frete
FROM treinamento.fato_pedidos
WHERE status = ''entregue'' AND canal = ''app'' AND data_pedido >= ''2025-01-01''
ORDER BY data_pedido DESC
LIMIT 50;

-- 3) Valores distintos e contagem
SELECT DISTINCT segmento FROM treinamento.dim_clientes;
SELECT COUNT(*) AS total_clientes FROM treinamento.dim_clientes;

-- TODO (exercício): clientes do segmento ''premium'' cadastrados após 2024-06-01, ordenados por data.', null, 't-sql-basico.sql') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('c-conexao-banco', 'checklist', 'Guia: conectar ao banco do programa (sem conta Supabase)', 'Passo a passo no DBeaver com o usuário aluno_leitura. Você NÃO faz login no painel do Supabase.', '# Conectar ao banco do programa

> Você **não** precisa de conta nem de e-mail no Supabase. O login do painel do Supabase é só do tutor.
> Para consultar os dados você usa um programa de SQL e o usuário somente leitura **aluno_leitura**.

## O que o tutor vai te passar
| Campo | Valor |
|---|---|
| Host | (informado pelo tutor, ex.: aws-0-<região>.pooler.supabase.com) |
| Porta | 5432 |
| Banco | postgres |
| Usuário | aluno_leitura.<código-do-projeto> (informado pelo tutor) |
| Senha | (informada pelo tutor, não compartilhe nem salve em arquivos do projeto) |

## Passo a passo (DBeaver Community, Windows/Mac/Linux)
1. Instale o **DBeaver Community** (dbeaver.io/download).
2. Menu **Banco de dados > Nova conexão** e escolha **PostgreSQL**.
3. Na aba **Principal**, preencha Host, Porta, Banco, Usuário e Senha com os dados do tutor.
4. Na aba **SSL**, ative SSL e use o modo **require**. Na primeira vez, o DBeaver baixa o driver PostgreSQL: aceite.
5. Clique em **Testar conexão**. Se aparecer "Conectado", clique em **Concluir**.
6. Clique com o botão direito na conexão > **Editor SQL > Novo script** (atalho Ctrl+]).
7. Rode o teste:

```sql
SELECT COUNT(*) FROM treinamento.fato_pedidos;
```

## Se der erro
- **Senha/usuário inválidos**: confira o usuário completo (com o ponto e o código do projeto) e peça a senha de novo ao tutor.
- **Timeout/host não encontrado**: use o host do Session pooler informado pelo tutor (não o host "db.").
- **Erro de certificado/SSL**: confirme o modo require e peça orientação ao tutor.
- Você só consegue **ler** (SELECT) as tabelas do schema treinamento; comandos que alteram dados são bloqueados de propósito.

## Sem acesso ao banco?
Use o dataset em Excel (recurso "Dataset de treinamento") e faça os mesmos exercícios com tabelas dinâmicas e fórmulas; avise o tutor.', null, 'c-conexao-banco.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('t-sql-agregacao', 'sql', 'Agregações (GROUP BY / HAVING)', 'Totais, médias e rankings por dimensão.', '-- Pedidos e frete médio por canal
SELECT canal, COUNT(*) AS pedidos, ROUND(AVG(frete),2) AS frete_medio
FROM treinamento.fato_pedidos
WHERE status <> ''cancelado''
GROUP BY canal
ORDER BY pedidos DESC;

-- Receita por mês (itens)
SELECT date_trunc(''month'', p.data_pedido)::date AS mes,
       SUM(i.quantidade * i.preco_unitario) AS receita
FROM treinamento.fato_itens_pedido i
JOIN treinamento.fato_pedidos p USING (pedido_id)
WHERE p.status <> ''cancelado''
GROUP BY 1 ORDER BY 1;

-- Estados com mais de 200 pedidos
SELECT uf_entrega, COUNT(*) AS pedidos
FROM treinamento.fato_pedidos
GROUP BY uf_entrega HAVING COUNT(*) > 200
ORDER BY pedidos DESC;', null, 't-sql-agregacao.sql') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('t-sql-joins', 'sql', 'JOINs entre fatos e dimensões', 'INNER/LEFT JOIN para responder perguntas de negócio.', '-- Receita e margem por categoria
SELECT pr.categoria,
       SUM(i.quantidade * i.preco_unitario)                      AS receita,
       SUM(i.quantidade * (i.preco_unitario - pr.custo))         AS margem,
       ROUND(100.0 * SUM(i.quantidade * (i.preco_unitario - pr.custo))
             / NULLIF(SUM(i.quantidade * i.preco_unitario),0),1) AS margem_pct
FROM treinamento.fato_itens_pedido i
JOIN treinamento.dim_produtos pr USING (produto_id)
JOIN treinamento.fato_pedidos p  USING (pedido_id)
WHERE p.status <> ''cancelado''
GROUP BY pr.categoria ORDER BY receita DESC;

-- Clientes que NUNCA compraram (LEFT JOIN + IS NULL)
SELECT c.cliente_id, c.nome, c.canal_aquisicao
FROM treinamento.dim_clientes c
LEFT JOIN treinamento.fato_pedidos p USING (cliente_id)
WHERE p.pedido_id IS NULL;

-- Logística: atraso por transportadora
SELECT e.transportadora,
       COUNT(*) AS entregas,
       ROUND(100.0 * AVG((e.data_entrega - e.data_envio > e.prazo_dias)::int),1) AS pct_atraso
FROM treinamento.fato_entregas e
WHERE e.data_entrega IS NOT NULL
GROUP BY 1 ORDER BY pct_atraso DESC;', null, 't-sql-joins.sql') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('t-sql-cte-window', 'sql', 'CTEs, subqueries e window functions', 'Ranking, acumulado e variação mês a mês.', 'WITH receita_mensal AS (
  SELECT date_trunc(''month'', p.data_pedido)::date AS mes,
         SUM(i.quantidade * i.preco_unitario) AS receita
  FROM treinamento.fato_itens_pedido i
  JOIN treinamento.fato_pedidos p USING (pedido_id)
  WHERE p.status <> ''cancelado''
  GROUP BY 1
)
SELECT mes, receita,
       LAG(receita) OVER (ORDER BY mes)                                  AS receita_mes_ant,
       ROUND(100.0*(receita/NULLIF(LAG(receita) OVER (ORDER BY mes),0)-1),1) AS var_pct,
       SUM(receita) OVER (ORDER BY mes)                                  AS acumulado
FROM receita_mensal ORDER BY mes;

-- Top 3 produtos por categoria
SELECT * FROM (
  SELECT pr.categoria, pr.nome,
         SUM(i.quantidade) AS unidades,
         RANK() OVER (PARTITION BY pr.categoria ORDER BY SUM(i.quantidade) DESC) AS rk
  FROM treinamento.fato_itens_pedido i JOIN treinamento.dim_produtos pr USING (produto_id)
  GROUP BY pr.categoria, pr.nome
) t WHERE rk <= 3;', null, 't-sql-cte-window.sql') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('t-sql-rfm', 'sql', 'RFM e coortes de clientes', 'Recência, Frequência, Valor e retenção por coorte.', '-- RFM
WITH base AS (
  SELECT p.cliente_id,
         (DATE ''2025-12-31'' - MAX(p.data_pedido))              AS recencia_dias,
         COUNT(DISTINCT p.pedido_id)                           AS frequencia,
         SUM(i.quantidade * i.preco_unitario)                  AS valor
  FROM treinamento.fato_pedidos p JOIN treinamento.fato_itens_pedido i USING (pedido_id)
  WHERE p.status <> ''cancelado'' GROUP BY 1
), score AS (
  SELECT *, NTILE(5) OVER (ORDER BY recencia_dias DESC) AS r,
            NTILE(5) OVER (ORDER BY frequencia)         AS f,
            NTILE(5) OVER (ORDER BY valor)              AS m
  FROM base
)
SELECT *, CASE WHEN r>=4 AND f>=4 THEN ''Campeões''
               WHEN r>=3 AND f>=3 THEN ''Leais''
               WHEN r<=2 AND f>=3 THEN ''Em risco''
               WHEN r<=2 THEN ''Hibernando'' ELSE ''Potencial'' END AS segmento_rfm
FROM score;

-- Coorte: clientes ativos por mês desde a 1ª compra
WITH primeira AS (
  SELECT cliente_id, date_trunc(''month'', MIN(data_pedido))::date AS coorte
  FROM treinamento.fato_pedidos GROUP BY 1)
SELECT pr.coorte,
       (EXTRACT(year FROM age(date_trunc(''month'',p.data_pedido), pr.coorte))*12
        + EXTRACT(month FROM age(date_trunc(''month'',p.data_pedido), pr.coorte)))::int AS mes_n,
       COUNT(DISTINCT p.cliente_id) AS clientes
FROM treinamento.fato_pedidos p JOIN primeira pr USING (cliente_id)
GROUP BY 1,2 ORDER BY 1,2;', null, 't-sql-rfm.sql') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('t-sql-financeiro', 'sql', 'DRE simplificada e orçamento x realizado', 'Resultado mensal e fluxo de caixa acumulado.', '-- DRE mensal
SELECT date_trunc(''month'', data)::date AS mes,
       SUM(valor) FILTER (WHERE tipo = ''receita'') AS receitas,
       SUM(valor) FILTER (WHERE tipo = ''despesa'') AS despesas,
       SUM(CASE WHEN tipo=''receita'' THEN valor ELSE -valor END) AS resultado
FROM treinamento.fato_financeiro GROUP BY 1 ORDER BY 1;

-- Caixa acumulado
SELECT mes, resultado, SUM(resultado) OVER (ORDER BY mes) AS caixa_acumulado
FROM (SELECT date_trunc(''month'', data)::date AS mes,
             SUM(CASE WHEN tipo=''receita'' THEN valor ELSE -valor END) AS resultado
      FROM treinamento.fato_financeiro GROUP BY 1) m;

-- Despesas por centro de custo (participação %)
SELECT centro_custo, SUM(valor) AS total,
       ROUND(100.0*SUM(valor)/SUM(SUM(valor)) OVER (),1) AS pct
FROM treinamento.fato_financeiro WHERE tipo=''despesa'' GROUP BY 1 ORDER BY total DESC;', null, 't-sql-financeiro.sql') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-pandas-limpeza', 'prompt', 'Prompt: limpeza de dados com pandas', 'Gera código Python para inspecionar e limpar um DataFrame.', 'Você é um analista de dados sênior. Escreva código Python (pandas) COMENTADO EM PORTUGUÊS para:
1. Carregar o arquivo [CAMINHO.csv/xlsx] e mostrar shape, dtypes, nulos por coluna e duplicados.
2. Padronizar nomes de colunas (minúsculas, sem acento, snake_case).
3. Converter colunas de data e numéricas; tratar nulos com a estratégia que eu indicar: [DESCREVA].
4. Remover duplicados pela chave [COLUNA_CHAVE] e listar quantas linhas foram removidas.
5. Salvar o resultado em [saida.csv].

Contexto de negócio: [DESCREVA A ÁREA E O QUE AS COLUNAS SIGNIFICAM].
Regras: use funções pequenas, não use bibliotecas além de pandas, imprima um resumo "antes x depois".
Depois do código, liste 3 riscos/pegadinhas de qualidade de dados que eu devo verificar manualmente.', null, 'p-pandas-limpeza.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-pandas-analise', 'prompt', 'Prompt: análise exploratória com pandas', 'Gera EDA guiada por perguntas de negócio.', 'Atue como analista de dados. Tenho o DataFrame df com as colunas: [LISTA DE COLUNAS E TIPOS].
Pergunta de negócio: [EX.: "Quais categorias têm maior margem e crescem mais rápido?"].
Escreva código pandas que:
- calcule as métricas necessárias (explique a fórmula em comentário);
- apresente uma tabela final ordenada e formatada (R$ e %);
- identifique outliers (IQR) e diga o que fazer com eles;
- termine com um bloco "Conclusões" que gere 3 frases em português executivo a partir dos resultados (use f-strings).
Não invente colunas. Se faltar informação, pergunte antes de codar.', null, 'p-pandas-analise.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-viz', 'prompt', 'Prompt: gráficos com matplotlib/seaborn', 'Gráficos claros, com título-conclusão e acessibilidade.', 'Escreva código matplotlib/seaborn para o DataFrame [df] com colunas [..].
Gráfico: [linha/barras/dispersão/heatmap] de [métrica] por [dimensão].
Requisitos: título que seja a CONCLUSÃO (ex.: "App cresce 2x mais que o site"), eixos com unidades, rótulos de dados nos extremos,
paleta com no máximo 4 cores e boa para daltônicos, sem bordas supérfluas, tamanho 10x5, salvar em PNG 200 dpi.
Retorne também uma versão em tabela para quem não enxerga o gráfico.', null, 'p-viz.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-supabase-conexao', 'prompt', 'Prompt: conectar Python ao Supabase (Postgres)', 'Código seguro de conexão somente leitura + leitura para pandas.', 'Escreva um script Python que se conecta ao Postgres do Supabase usando SQLAlchemy + psycopg, lendo as credenciais
de variáveis de ambiente (SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD, SUPABASE_DB_NAME, SUPABASE_DB_PORT).
Deve: (1) abrir a conexão com sslmode=require; (2) executar uma consulta SQL que eu passo como string e devolver um DataFrame;
(3) tratar erros de conexão com mensagem clara em português; (4) NUNCA imprimir a senha; (5) incluir exemplo lendo
treinamento.fato_pedidos (limite 1000). Explique como criar o arquivo .env e como NÃO versioná-lo no git.', null, 'p-supabase-conexao.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-forecast', 'prompt', 'Prompt: previsão simples de série temporal', 'Baseline (média móvel / sazonal ingênuo) e Holt-Winters.', 'Tenho uma série mensal de receita (colunas: mes, receita). Escreva código Python que:
1. separe os 3 últimos meses como teste;
2. compare 3 modelos: média móvel 3m, sazonal ingênuo (mesmo mês do ano anterior) e Holt-Winters (statsmodels);
3. calcule MAPE e MAE de cada um no teste e escolha o melhor;
4. projete os próximos 6 meses com faixa de incerteza aproximada;
5. gere gráfico (histórico, ajuste, previsão).
Explique em linguagem simples quando NÃO confiar na previsão.', null, 'p-forecast.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-abtest', 'prompt', 'Prompt: teste A/B', 'Teste de proporções, intervalo de confiança e decisão.', 'Rodei um teste A/B de e-mail marketing: grupo A [n_A, conv_A], grupo B [n_B, conv_B].
Escreva código Python (statsmodels) que: calcule taxas de conversão, diferença absoluta e relativa, teste z de duas proporções,
p-valor, intervalo de confiança 95% e poder aproximado. Termine com uma recomendação em 3 linhas para um gestor não técnico
(escale, não escale ou colete mais dados) e liste os vieses possíveis (sazonalidade, tamanho de amostra, múltiplos testes).', null, 'p-abtest.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-automacao', 'prompt', 'Prompt: automação de relatório semanal', 'Script que consulta o banco, gera Excel/PNG e pode ser agendado.', 'Crie um script Python "relatorio_semanal.py" que: consulta o Supabase (SQL abaixo), gera um Excel com abas
Resumo/Detalhe formatadas (openpyxl), salva 2 gráficos PNG e escreve um log em arquivo. Deve ter função main(), argparse
com --data-fim, tratamento de erro e código de saída diferente de zero em falha.
SQL: [COLE A QUERY]. Explique como agendar no Agendador de Tarefas do Windows (ou cron) em passos numerados.', null, 'p-automacao.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('p-revisao-codigo', 'prompt', 'Prompt: revisar código gerado por IA', 'Checklist de revisão antes de confiar no resultado.', 'Revise o código abaixo como um analista sênior cético. Responda em tabela (Problema | Linha | Risco | Correção):
- erros de lógica (joins que duplicam linhas, filtros de data, divisão por zero);
- premissas ocultas (moeda, fuso, cancelados incluídos?);
- segurança (credenciais, SQL injection);
- reprodutibilidade (sementes aleatórias, caminhos fixos).
Depois escreva 3 testes rápidos (asserts) que provem que os totais batem com a fonte.
CÓDIGO: [COLE AQUI]', null, 'p-revisao-codigo.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('d-er-modelo', 'diagram', 'Diagrama ER do banco de análise', 'Estrutura de dados do schema treinamento (renderiza no GitHub/Mermaid Live).', 'erDiagram
  DIM_CLIENTES ||--o{ FATO_PEDIDOS : "faz"
  FATO_PEDIDOS ||--|{ FATO_ITENS_PEDIDO : "contém"
  DIM_PRODUTOS ||--o{ FATO_ITENS_PEDIDO : "vendido em"
  FATO_PEDIDOS ||--o| FATO_ENTREGAS : "gera"
  DIM_CLIENTES { int cliente_id PK
    text nome
    text uf
    text segmento
    text canal_aquisicao
    date data_cadastro }
  DIM_PRODUTOS { int produto_id PK
    text nome
    text categoria
    numeric preco
    numeric custo }
  FATO_PEDIDOS { int pedido_id PK
    int cliente_id FK
    date data_pedido
    text status
    text canal
    text uf_entrega
    numeric frete }
  FATO_ITENS_PEDIDO { int item_id PK
    int pedido_id FK
    int produto_id FK
    int quantidade
    numeric preco_unitario }
  FATO_ENTREGAS { int pedido_id PK
    text transportadora
    date data_envio
    int prazo_dias
    date data_entrega }
  FATO_CAMPANHAS { int campanha_id PK
    text canal
    date mes
    numeric investimento
    int cliques
    int conversoes }
  FATO_FINANCEIRO { int lancamento_id PK
    date data
    text tipo
    text categoria
    text centro_custo
    numeric valor }
  ESPORTE_PARTIDAS { int partida_id PK
    text temporada
    date data_jogo
    text mandante
    text visitante
    int publico
    numeric receita_bilheteria }', null, 'd-er-modelo.mmd') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('d-star-schema', 'diagram', 'Modelo estrela para Power BI', 'Fato Vendas no centro, dimensões Data, Cliente, Produto, Canal.', 'flowchart LR
  D[dim_data<br/>data, ano, mês, trimestre] --> F
  C[dim_clientes<br/>cliente_id, uf, segmento] --> F
  P[dim_produtos<br/>produto_id, categoria] --> F
  K[dim_canal<br/>canal] --> F
  F((fato_vendas<br/>pedido_id · item_id<br/>quantidade · receita · custo))
  style F fill:#2563eb,color:#fff', null, 'd-star-schema.mmd') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('d-fluxo-etl', 'diagram', 'Fluxo ETL: fonte → modelo → relatório', 'Desenho do fluxo de dados para sua entrega.', 'flowchart LR
  A[(Supabase<br/>Postgres)] -->|Power Query: filtrar,<br/>tipar, mesclar| B[Modelo<br/>estrela]
  B -->|Medidas DAX| C[Relatório<br/>Power BI]
  A -->|SQL + pandas| D[Notebook<br/>Python]
  D -->|PNG / insights| E[Apresentação<br/>executiva]
  C --> E', null, 'd-fluxo-etl.mmd') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('x-painel-vendas', 'excel', 'Planilha: painel de vendas (Excel)', 'Modelo com abas Dados, Fórmulas, Dinâmica e Painel, pronto para colar o dataset.', 'Abas: LEIAME · Dados (cole a aba fato_pedidos) · Calculos (SOMASES/PROCV de exemplo) · Painel (KPIs + espaço para gráficos).', '/templates/painel-vendas.xlsx', 'painel-vendas.xlsx') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('x-kpis', 'excel', 'Planilha: catálogo de KPIs por área', 'KPI, fórmula, fonte, frequência e dono para Comercial, Financeiro, Logística, E-commerce, Esporte e Marketing.', 'Abas por área com colunas: KPI, definição, fórmula, fonte (tabela/coluna), frequência, meta, dono.', '/templates/kpis-areas.xlsx', 'kpis-areas.xlsx') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('x-dre-fluxo', 'excel', 'Planilha: DRE e fluxo de caixa', 'Modelo com receitas, despesas, resultado e caixa acumulado com fórmulas.', 'Abas: DRE_Mensal (fórmulas SOMA/ SOMASES) · Fluxo_Caixa (acumulado) · Orcado_vs_Realizado.', '/templates/dre-fluxo-caixa.xlsx', 'dre-fluxo-caixa.xlsx') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('b-pbix-guia', 'pbix', 'Roteiro .pbix: relatório de vendas (3 páginas)', 'Especificação para construir seu arquivo .pbix no Power BI Desktop (e modelo de correção do tutor).', '# Roteiro do arquivo vendas.pbix
Fonte: PostgreSQL (Supabase) → schema treinamento (modo Importar).

Página 1 – Visão Executiva
- Cartões: Receita, Margem %, Pedidos, Ticket Médio
- Linha: Receita por mês | Barras: Receita por categoria | Mapa/barras: Receita por UF
- Segmentações: Ano, Canal

Página 2 – Clientes
- Matriz Segmento x Canal, Top 10 clientes, RFM (se já existir)

Página 3 – Logística
- % Entregas no prazo por transportadora, atraso médio (dias)

Medidas mínimas (DAX):
Receita = SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * fato_itens_pedido[preco_unitario])
Pedidos = DISTINCTCOUNT(fato_pedidos[pedido_id])
Ticket Médio = DIVIDE([Receita], [Pedidos])

Checklist de entrega: nome de abas claro, título-conclusão, cores consistentes, sem poluição, tooltip, bookmark de reset.
Exporte o .pbix e anexe o link (OneDrive/Drive) na submissão.', null, 'b-pbix-guia.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('b-dax-pack', 'pbix', 'Pacote de medidas DAX', 'Medidas básicas e de inteligência de tempo.', 'Receita := SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * fato_itens_pedido[preco_unitario])
Custo := SUMX(fato_itens_pedido, fato_itens_pedido[quantidade] * RELATED(dim_produtos[custo]))
Margem % := DIVIDE([Receita] - [Custo], [Receita])
Receita YTD := TOTALYTD([Receita], dim_data[data])
Receita Mês Ant := CALCULATE([Receita], DATEADD(dim_data[data], -1, MONTH))
Var % Mês := DIVIDE([Receita] - [Receita Mês Ant], [Receita Mês Ant])
Receita 12M := CALCULATE([Receita], DATESINPERIOD(dim_data[data], MAX(dim_data[data]), -12, MONTH))
% Entregas no Prazo := DIVIDE(CALCULATE(COUNTROWS(fato_entregas), fato_entregas[no_prazo] = TRUE()), COUNTROWS(fato_entregas))', null, 'b-dax-pack.dax') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('c-relatorio', 'checklist', 'Checklist de qualidade de relatório/dashboard', 'Use antes de enviar qualquer entrega visual.', '- [ ] A pergunta de negócio está no topo da página?
- [ ] Cada gráfico tem título-conclusão (não só "Vendas por mês")?
- [ ] Números têm unidade e formato (R$, %, mil/mi)?
- [ ] Máximo de 5–7 visuais por página; alinhados em grade?
- [ ] Paleta limitada (≤ 4 cores) e consistente entre páginas?
- [ ] Filtros funcionam e há botão de limpar?
- [ ] Totais batem com a consulta SQL de referência?
- [ ] Alguém fora da área entendeu em 30 segundos?', null, 'c-relatorio.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('c-entrega-semanal', 'entrega', 'Modelo de relatório de entrega semanal', 'Estrutura para o documento que acompanha cada entrega semanal.', '# Entrega da Semana [N] – [Seu nome]
## 1. Pergunta de negócio
## 2. Dados e método (fonte, filtros, ferramentas)
## 3. Resultados (3 achados com números)
## 4. Recomendações (o que o gestor deve fazer)
## 5. Limitações e próximos passos
## 6. Links dos arquivos (xlsx / pbix / sql / ipynb)
## 7. Autoavaliação (0–10) e dúvidas para o tutor', null, 'c-entrega-semanal.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.templates (slug, kind, title, description, content, url, filename) values ('c-storytelling', 'checklist', 'Roteiro de storytelling (5 slides)', 'Contexto → Problema → Evidência → Recomendação → Próximos passos.', '1. Contexto (1 frase + 1 número)
2. Problema/Oportunidade (o que está em jogo, em R$)
3. Evidência (1 gráfico principal + 1 de apoio)
4. Recomendação (ação, responsável, prazo, impacto esperado)
5. Riscos e próximos passos
Regra: 1 mensagem por slide, título = conclusão, máximo 30 palavras no corpo.', null, 'c-storytelling.md') on conflict (slug) do update set kind=excluded.kind, title=excluded.title, description=excluded.description, content=excluded.content, url=excluded.url, filename=excluded.filename;
insert into public.resources (slug, category, title, url, description) values ('r-dataset-xlsx', 'Dados', 'Dataset de treinamento (Excel)', '/data/dataset_treinamento.xlsx', 'Mesmo dataset do Supabase (clientes, produtos, pedidos, itens, entregas, campanhas, financeiro, partidas) em abas de Excel. Usado nos dias 2–5.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-supabase-url', 'Dados', 'Supabase do programa (banco de análise)', '{{SUPABASE_URL}}', 'Projeto Supabase usado como banco de análise (schema "treinamento"). Host de conexão e usuário somente-leitura são informados pelo tutor.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-dbeaver', 'Ferramentas', 'DBeaver Community (cliente SQL gratuito)', 'https://dbeaver.io/download/', 'Programa para escrever SQL no banco do programa. Não precisa de conta no Supabase: conecte com o usuário aluno_leitura (host e senha informados pelo tutor). Passo a passo no template "Guia: conectar ao banco".') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-pbi-desktop', 'Ferramentas', 'Download do Power BI Desktop', 'https://www.microsoft.com/en-us/download/details.aspx?id=58494', 'Instalador oficial da Microsoft (ou instale pela Microsoft Store: aka.ms/pbidesktopstore, que atualiza sozinho). Somente Windows.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-pbi-samples', 'Ferramentas', 'Exemplos .pbix oficiais da Microsoft', 'https://github.com/microsoft/powerbi-desktop-samples', 'Repositório oficial com relatórios .pbix de exemplo para abrir, estudar o modelo e os visuais.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-pbi-sample-docs', 'Referência', 'Power BI – Sample datasets (Microsoft Learn)', 'https://learn.microsoft.com/power-bi/create-reports/sample-datasets', 'Guia oficial para baixar e abrir os exemplos; no Desktop também há Início > "Aprender com dados de exemplo".') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-python', 'Ferramentas', 'Download do Python', 'https://www.python.org/downloads/', 'Instale Python 3.12+ e marque "Add python.exe to PATH". Depois: pip install pandas matplotlib seaborn psycopg[binary] sqlalchemy statsmodels.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-vscode', 'Ferramentas', 'Visual Studio Code + extensão Python/Jupyter', 'https://code.visualstudio.com/download', 'Editor para rodar scripts e notebooks (.ipynb) das sessões de Python.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-pandas', 'Referência', 'Documentação do pandas', 'https://pandas.pydata.org/docs/user_guide/10min.html', '"10 minutes to pandas": leitura rápida antes dos dias 17–18.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-dax', 'Referência', 'DAX Guide', 'https://dax.guide/', 'Referência de todas as funções DAX com exemplos.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-pg-tutorial', 'Referência', 'Tutorial SQL do PostgreSQL', 'https://www.postgresql.org/docs/current/tutorial.html', 'Documentação oficial do Postgres (mesmo motor do Supabase).') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
insert into public.resources (slug, category, title, url, description) values ('r-pbi-learn', 'Referência', 'Microsoft Learn – Power BI', 'https://learn.microsoft.com/power-bi/', 'Trilhas gratuitas e documentação completa do Power BI.') on conflict (slug) do update set category=excluded.category, title=excluded.title, url=excluded.url, description=excluded.description;
delete from public.session_templates; delete from public.session_resources;
delete from public.resources where slug <> all (array['r-dataset-xlsx', 'r-supabase-url', 'r-dbeaver', 'r-pbi-desktop', 'r-pbi-samples', 'r-pbi-sample-docs', 'r-python', 'r-vscode', 'r-pandas', 'r-dax', 'r-pg-tutorial', 'r-pbi-learn']);
delete from public.templates where slug <> all (array['t-sql-basico', 'c-conexao-banco', 't-sql-agregacao', 't-sql-joins', 't-sql-cte-window', 't-sql-rfm', 't-sql-financeiro', 'p-pandas-limpeza', 'p-pandas-analise', 'p-viz', 'p-supabase-conexao', 'p-forecast', 'p-abtest', 'p-automacao', 'p-revisao-codigo', 'd-er-modelo', 'd-star-schema', 'd-fluxo-etl', 'x-painel-vendas', 'x-kpis', 'x-dre-fluxo', 'b-pbix-guia', 'b-dax-pack', 'c-relatorio', 'c-entrega-semanal', 'c-storytelling']);
insert into public.session_templates (session_day, template_slug, position) values (1, 'x-kpis', 0);
insert into public.session_templates (session_day, template_slug, position) values (1, 'c-entrega-semanal', 1);
insert into public.session_resources (session_day, resource_slug, position) values (1, 'r-dataset-xlsx', 0);
insert into public.session_templates (session_day, template_slug, position) values (2, 'x-painel-vendas', 0);
insert into public.session_resources (session_day, resource_slug, position) values (2, 'r-dataset-xlsx', 0);
insert into public.session_templates (session_day, template_slug, position) values (3, 'x-painel-vendas', 0);
insert into public.session_resources (session_day, resource_slug, position) values (3, 'r-dataset-xlsx', 0);
insert into public.session_templates (session_day, template_slug, position) values (4, 'x-painel-vendas', 0);
insert into public.session_resources (session_day, resource_slug, position) values (4, 'r-dataset-xlsx', 0);
insert into public.session_templates (session_day, template_slug, position) values (5, 'x-painel-vendas', 0);
insert into public.session_templates (session_day, template_slug, position) values (5, 'c-relatorio', 1);
insert into public.session_templates (session_day, template_slug, position) values (5, 'c-entrega-semanal', 2);
insert into public.session_resources (session_day, resource_slug, position) values (5, 'r-dataset-xlsx', 0);
insert into public.session_templates (session_day, template_slug, position) values (6, 'c-conexao-banco', 0);
insert into public.session_templates (session_day, template_slug, position) values (6, 'd-er-modelo', 1);
insert into public.session_templates (session_day, template_slug, position) values (6, 't-sql-basico', 2);
insert into public.session_resources (session_day, resource_slug, position) values (6, 'r-supabase-url', 0);
insert into public.session_resources (session_day, resource_slug, position) values (6, 'r-dbeaver', 1);
insert into public.session_resources (session_day, resource_slug, position) values (6, 'r-pg-tutorial', 2);
insert into public.session_templates (session_day, template_slug, position) values (7, 't-sql-basico', 0);
insert into public.session_resources (session_day, resource_slug, position) values (7, 'r-dbeaver', 0);
insert into public.session_resources (session_day, resource_slug, position) values (7, 'r-pg-tutorial', 1);
insert into public.session_templates (session_day, template_slug, position) values (8, 't-sql-agregacao', 0);
insert into public.session_resources (session_day, resource_slug, position) values (8, 'r-dbeaver', 0);
insert into public.session_resources (session_day, resource_slug, position) values (8, 'r-pg-tutorial', 1);
insert into public.session_templates (session_day, template_slug, position) values (9, 'b-pbix-guia', 0);
insert into public.session_templates (session_day, template_slug, position) values (9, 'c-relatorio', 1);
insert into public.session_resources (session_day, resource_slug, position) values (9, 'r-pbi-desktop', 0);
insert into public.session_resources (session_day, resource_slug, position) values (9, 'r-pbi-samples', 1);
insert into public.session_resources (session_day, resource_slug, position) values (9, 'r-pbi-sample-docs', 2);
insert into public.session_resources (session_day, resource_slug, position) values (9, 'r-supabase-url', 3);
insert into public.session_templates (session_day, template_slug, position) values (10, 'b-pbix-guia', 0);
insert into public.session_templates (session_day, template_slug, position) values (10, 'c-relatorio', 1);
insert into public.session_templates (session_day, template_slug, position) values (10, 'c-entrega-semanal', 2);
insert into public.session_templates (session_day, template_slug, position) values (10, 't-sql-agregacao', 3);
insert into public.session_resources (session_day, resource_slug, position) values (10, 'r-pbi-desktop', 0);
insert into public.session_resources (session_day, resource_slug, position) values (10, 'r-pbi-learn', 1);
insert into public.session_templates (session_day, template_slug, position) values (11, 't-sql-joins', 0);
insert into public.session_resources (session_day, resource_slug, position) values (11, 'r-dbeaver', 0);
insert into public.session_resources (session_day, resource_slug, position) values (11, 'r-pg-tutorial', 1);
insert into public.session_templates (session_day, template_slug, position) values (12, 't-sql-cte-window', 0);
insert into public.session_resources (session_day, resource_slug, position) values (12, 'r-dbeaver', 0);
insert into public.session_resources (session_day, resource_slug, position) values (12, 'r-pg-tutorial', 1);
insert into public.session_templates (session_day, template_slug, position) values (13, 'd-star-schema', 0);
insert into public.session_templates (session_day, template_slug, position) values (13, 'd-er-modelo', 1);
insert into public.session_resources (session_day, resource_slug, position) values (13, 'r-pbi-learn', 0);
insert into public.session_resources (session_day, resource_slug, position) values (13, 'r-dax', 1);
insert into public.session_templates (session_day, template_slug, position) values (14, 'd-fluxo-etl', 0);
insert into public.session_resources (session_day, resource_slug, position) values (14, 'r-pbi-learn', 0);
insert into public.session_templates (session_day, template_slug, position) values (15, 'b-dax-pack', 0);
insert into public.session_templates (session_day, template_slug, position) values (15, 'd-star-schema', 1);
insert into public.session_templates (session_day, template_slug, position) values (15, 'c-entrega-semanal', 2);
insert into public.session_resources (session_day, resource_slug, position) values (15, 'r-dax', 0);
insert into public.session_resources (session_day, resource_slug, position) values (15, 'r-pbi-learn', 1);
insert into public.session_templates (session_day, template_slug, position) values (16, 'b-dax-pack', 0);
insert into public.session_templates (session_day, template_slug, position) values (16, 't-sql-cte-window', 1);
insert into public.session_resources (session_day, resource_slug, position) values (16, 'r-dax', 0);
insert into public.session_templates (session_day, template_slug, position) values (17, 'p-pandas-analise', 0);
insert into public.session_resources (session_day, resource_slug, position) values (17, 'r-python', 0);
insert into public.session_resources (session_day, resource_slug, position) values (17, 'r-vscode', 1);
insert into public.session_resources (session_day, resource_slug, position) values (17, 'r-pandas', 2);
insert into public.session_templates (session_day, template_slug, position) values (18, 'p-pandas-limpeza', 0);
insert into public.session_templates (session_day, template_slug, position) values (18, 'p-pandas-analise', 1);
insert into public.session_templates (session_day, template_slug, position) values (18, 'p-revisao-codigo', 2);
insert into public.session_resources (session_day, resource_slug, position) values (18, 'r-pandas', 0);
insert into public.session_templates (session_day, template_slug, position) values (19, 'p-viz', 0);
insert into public.session_resources (session_day, resource_slug, position) values (19, 'r-pandas', 0);
insert into public.session_templates (session_day, template_slug, position) values (20, 'p-supabase-conexao', 0);
insert into public.session_templates (session_day, template_slug, position) values (20, 'p-pandas-analise', 1);
insert into public.session_templates (session_day, template_slug, position) values (20, 'p-viz', 2);
insert into public.session_templates (session_day, template_slug, position) values (20, 'c-entrega-semanal', 3);
insert into public.session_resources (session_day, resource_slug, position) values (20, 'r-python', 0);
insert into public.session_resources (session_day, resource_slug, position) values (20, 'r-vscode', 1);
insert into public.session_resources (session_day, resource_slug, position) values (20, 'r-supabase-url', 2);
insert into public.session_templates (session_day, template_slug, position) values (21, 'x-kpis', 0);
insert into public.session_templates (session_day, template_slug, position) values (21, 't-sql-agregacao', 1);
insert into public.session_resources (session_day, resource_slug, position) values (21, 'r-pbi-learn', 0);
insert into public.session_templates (session_day, template_slug, position) values (22, 't-sql-rfm', 0);
insert into public.session_resources (session_day, resource_slug, position) values (22, 'r-dbeaver', 0);
insert into public.session_templates (session_day, template_slug, position) values (23, 'p-forecast', 0);
insert into public.session_templates (session_day, template_slug, position) values (23, 't-sql-cte-window', 1);
insert into public.session_resources (session_day, resource_slug, position) values (23, 'r-python', 0);
insert into public.session_templates (session_day, template_slug, position) values (24, 'p-abtest', 0);
insert into public.session_templates (session_day, template_slug, position) values (24, 'p-revisao-codigo', 1);
insert into public.session_resources (session_day, resource_slug, position) values (24, 'r-python', 0);
insert into public.session_templates (session_day, template_slug, position) values (25, 't-sql-financeiro', 0);
insert into public.session_templates (session_day, template_slug, position) values (25, 'x-dre-fluxo', 1);
insert into public.session_templates (session_day, template_slug, position) values (25, 'c-entrega-semanal', 2);
insert into public.session_resources (session_day, resource_slug, position) values (25, 'r-dbeaver', 0);
insert into public.session_resources (session_day, resource_slug, position) values (25, 'r-pbi-learn', 1);
insert into public.session_templates (session_day, template_slug, position) values (26, 'p-revisao-codigo', 0);
insert into public.session_templates (session_day, template_slug, position) values (26, 'p-pandas-analise', 1);
insert into public.session_resources (session_day, resource_slug, position) values (26, 'r-python', 0);
insert into public.session_templates (session_day, template_slug, position) values (27, 'p-automacao', 0);
insert into public.session_templates (session_day, template_slug, position) values (27, 'p-revisao-codigo', 1);
insert into public.session_resources (session_day, resource_slug, position) values (27, 'r-python', 0);
insert into public.session_resources (session_day, resource_slug, position) values (27, 'r-vscode', 1);
insert into public.session_templates (session_day, template_slug, position) values (28, 'b-pbix-guia', 0);
insert into public.session_templates (session_day, template_slug, position) values (28, 'b-dax-pack', 1);
insert into public.session_templates (session_day, template_slug, position) values (28, 'c-relatorio', 2);
insert into public.session_resources (session_day, resource_slug, position) values (28, 'r-pbi-desktop', 0);
insert into public.session_resources (session_day, resource_slug, position) values (28, 'r-pbi-learn', 1);
insert into public.session_resources (session_day, resource_slug, position) values (28, 'r-dax', 2);
insert into public.session_templates (session_day, template_slug, position) values (29, 'c-storytelling', 0);
insert into public.session_templates (session_day, template_slug, position) values (29, 'c-relatorio', 1);
insert into public.session_resources (session_day, resource_slug, position) values (29, 'r-pbi-learn', 0);
insert into public.session_templates (session_day, template_slug, position) values (30, 'd-fluxo-etl', 0);
insert into public.session_templates (session_day, template_slug, position) values (30, 'c-storytelling', 1);
insert into public.session_templates (session_day, template_slug, position) values (30, 'c-entrega-semanal', 2);
insert into public.session_templates (session_day, template_slug, position) values (30, 'c-relatorio', 3);
insert into public.session_resources (session_day, resource_slug, position) values (30, 'r-supabase-url', 0);
insert into public.session_resources (session_day, resource_slug, position) values (30, 'r-pbi-desktop', 1);
insert into public.session_resources (session_day, resource_slug, position) values (30, 'r-python', 2);
insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (1, 'Painel de vendas em Excel', 'Planilha com dados limpos, fórmulas, tabela dinâmica e 4 gráficos respondendo a 3 perguntas de negócio, mais o relatório de entrega.', '2026-11-09', '2026-11-13', 5) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;
insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (2, 'Primeiro relatório Power BI + 10 consultas SQL', 'Arquivo .pbix de 2 páginas conectado ao Supabase e um .sql com 10 consultas comentadas.', '2026-11-16', '2026-11-20', 10) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;
insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (3, 'Modelo estrela com medidas DAX', 'Arquivo .pbix com modelo estrela (dim_data, dim_clientes, dim_produtos), Power Query documentado e 8 medidas DAX.', '2026-11-23', '2026-11-27', 15) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;
insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (4, 'Notebook Python de análise', 'Notebook .ipynb (ou .py) que lê o Supabase, limpa, analisa e gera 3 gráficos, com prompts de IA registrados e revisados.', '2026-11-30', '2026-12-04', 20) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;
insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (5, 'Segmentação e previsão', 'Relatório com RFM de clientes, previsão de receita de 6 meses e análise financeira (DRE + caixa), com recomendação por área.', '2026-12-07', '2026-12-11', 25) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;
insert into public.weekly_deliverables (week, title, description, start_date, due_date, session_day) values (6, 'Projeto final (capstone)', 'Dashboard executivo + apresentação de 5 slides + repositório/pasta com SQL, Python e documentação, apresentado ao tutor.', '2026-12-14', '2026-12-18', 30) on conflict (week) do update set title=excluded.title, description=excluded.description, start_date=excluded.start_date, due_date=excluded.due_date, session_day=excluded.session_day;
commit;
-- ============================================================================
-- Autenticação gerenciada pelo app (substitui o login Google / Supabase Auth).
--
-- Modelo: tabela app_users (professores e alunos) + sessões com token opaco.
-- Segurança: NENHUMA tabela é acessível diretamente pela API (RLS ativo sem policies +
-- privilégios revogados). Todo acesso passa por funções RPC (security definer) que
-- validam o token de sessão e o perfil (student | teacher).
--   - senhas: bcrypt (pgcrypto), nunca retornadas
--   - token: 256 bits aleatórios; só o hash SHA-256 é guardado; validade de 30 dias
--   - bloqueio temporário após 5 senhas erradas
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

-- ───────────── Remove o modelo anterior (Supabase Auth + RLS por auth.uid()) ─────────────
drop trigger if exists on_auth_user_created on auth.users;

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop table if exists public.reviews, public.submissions, public.profiles cascade;
drop function if exists public.handle_new_user();
drop function if exists public.before_submission_insert();
drop function if exists public.before_review_write();
drop function if exists public.after_review_write();
drop function if exists public.is_teacher();
drop function if exists public.session_done(uuid, int);
drop function if exists public.session_unlocked(uuid, int);

-- ───────────── Usuários e sessões ─────────────
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  full_name text not null check (length(trim(full_name)) between 2 and 100),
  password_hash text not null,
  role text not null default 'student' check (role in ('student', 'teacher')),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.app_users is 'Usuários do app (professores e alunos). Senha em bcrypt. Acesso somente via RPC.';
comment on table public.teacher_allowlist is 'E-mails que, ao se cadastrar, entram como tutor (teacher). Gerenciada via SQL.';

create table public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index app_sessions_user_idx on public.app_sessions (user_id);
create index app_sessions_exp_idx on public.app_sessions (expires_at);

-- ───────────── Entregas e avaliações ─────────────
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  exercise_id text not null references public.exercises (id) on delete cascade,
  student_id uuid not null references public.app_users (id) on delete cascade,
  attempt int not null,
  content text check (length(content) <= 20000),
  link_url text check (link_url is null or (link_url ~* '^https?://' and length(link_url) <= 2000)),
  status text not null default 'submitted' check (status in ('submitted','approved','revision_requested')),
  created_at timestamptz not null default now(),
  unique (exercise_id, student_id, attempt),
  check (coalesce(length(trim(content)), 0) > 0 or coalesce(length(trim(link_url)), 0) > 0)
);
create index submissions_student_idx on public.submissions (student_id);
create index submissions_status_idx on public.submissions (status);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  tutor_id uuid not null references public.app_users (id),
  score numeric(3,1) not null check (score between 0 and 10),
  verdict text not null check (verdict in ('approved','revision_requested')),
  feedback text not null check (length(trim(feedback)) > 0 and length(feedback) <= 5000),
  created_at timestamptz not null default now()
);

-- ───────────── Acesso direto às tabelas: negado ─────────────
do $$
declare t text;
begin
  foreach t in array array['teacher_allowlist','levels','sessions','session_dependencies','exercises','templates',
                           'resources','session_templates','session_resources','weekly_deliverables',
                           'app_users','app_sessions','submissions','reviews']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ───────────── Funções internas (não expostas) ─────────────
create function public._app_user_json(u public.app_users)
returns json language sql immutable set search_path = public as $$
  select json_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'avatar_url', null,
                           'role', u.role, 'created_at', u.created_at);
$$;

create function public._app_new_session(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  delete from public.app_sessions where expires_at < now();
  insert into public.app_sessions (token_hash, user_id, expires_at)
  values (encode(digest(t, 'sha256'), 'hex'), p_user, now() + interval '30 days');
  return t;
end;
$$;

create function public._app_user(p_token text)
returns public.app_users language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  if p_token is null or length(p_token) <> 64 then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = '28000';
  end if;
  select au.* into u
  from public.app_sessions s join public.app_users au on au.id = s.user_id
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.expires_at > now();
  if not found then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  return u;
end;
$$;

-- Sessão concluída = todos os exercícios têm ao menos uma entrega aprovada pelo tutor.
create function public._session_done(p_student uuid, p_day int)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.exercises e
    where e.session_day = p_day
      and not exists (select 1 from public.submissions s
                      where s.exercise_id = e.id and s.student_id = p_student and s.status = 'approved'));
$$;

-- Sessão liberada = todas as dependências concluídas.
create function public._session_unlocked(p_student uuid, p_day int)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.session_dependencies d
    where d.day = p_day and not public._session_done(p_student, d.requires_day));
$$;

-- ───────────── API pública (RPC) ─────────────
create function public.app_register(p_email text, p_password text, p_name text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  u public.app_users;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Informe um e-mail válido.';
  end if;
  if length(v_name) < 2 or length(v_name) > 100 then
    raise exception 'Informe seu nome (2 a 100 caracteres).';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'A senha deve ter pelo menos 8 caracteres.';
  end if;
  if octet_length(p_password) > 72 then
    raise exception 'A senha deve ter no máximo 72 caracteres.';
  end if;
  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end if;

  begin
    insert into public.app_users (email, full_name, password_hash, role)
    values (v_email, v_name, crypt(p_password, gen_salt('bf', 10)),
            case when exists (select 1 from public.teacher_allowlist t where lower(t.email) = v_email)
                 then 'teacher' else 'student' end)
    returning * into u;
  exception when unique_violation then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end;

  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

-- Erros de credencial retornam {error} (não exceção) para que o contador de tentativas seja gravado.
create function public.app_login(p_email text, p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  u public.app_users;
begin
  select * into u from public.app_users where email = v_email;
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));   -- equaliza o tempo de resposta
    return json_build_object('error', 'E-mail ou senha inválidos.');
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    return json_build_object('error', 'Muitas tentativas incorretas. Tente novamente em alguns minutos.');
  end if;
  if p_password is null or u.password_hash <> crypt(p_password, u.password_hash) then
    update public.app_users
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '10 minutes' else null end
     where id = u.id;
    return json_build_object('error', 'E-mail ou senha inválidos.');
  end if;
  update public.app_users set failed_attempts = 0, locked_until = null where id = u.id;
  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

create function public.app_logout(p_token text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.app_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return true;
end;
$$;

create function public.app_me(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  begin u := public._app_user(p_token); exception when others then return null; end;
  return public._app_user_json(u);
end;
$$;

-- Tudo que a interface precisa em uma chamada. Aluno: só os próprios dados. Tutor: turma inteira.
create function public.app_bootstrap(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_user(p_token);
begin
  return json_build_object(
    'levels',           (select coalesce(json_agg(x order by x.position), '[]') from public.levels x),
    'sessions',         (select coalesce(json_agg(x order by x.day), '[]') from public.sessions x),
    'deps',             (select coalesce(json_agg(x), '[]') from public.session_dependencies x),
    'exercises',        (select coalesce(json_agg(x order by x.session_day, x.position), '[]') from public.exercises x),
    'templates',        (select coalesce(json_agg(x order by x.slug), '[]') from public.templates x),
    'resources',        (select coalesce(json_agg(x order by x.category), '[]') from public.resources x),
    'sessionTemplates', (select coalesce(json_agg(x), '[]') from public.session_templates x),
    'sessionResources', (select coalesce(json_agg(x), '[]') from public.session_resources x),
    'weekly',           (select coalesce(json_agg(x order by x.week), '[]') from public.weekly_deliverables x),
    'submissions',      (select coalesce(json_agg(x order by x.created_at), '[]') from public.submissions x
                          where u.role = 'teacher' or x.student_id = u.id),
    'reviews',          (select coalesce(json_agg(r order by r.created_at), '[]') from public.reviews r
                          where u.role = 'teacher'
                             or exists (select 1 from public.submissions s where s.id = r.submission_id and s.student_id = u.id)),
    'profiles',         (select coalesce(json_agg(public._app_user_json(p) order by p.created_at), '[]') from public.app_users p
                          where u.role = 'teacher' or p.id = u.id)
  );
end;
$$;

create function public.app_submit(p_token text, p_exercise_id text, p_content text, p_link text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_user(p_token);
  v_day int;
  v_last record;
  v_content text := nullif(trim(coalesce(p_content, '')), '');
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  s public.submissions;
begin
  if u.role <> 'student' then raise exception 'Apenas alunos enviam entregas.' using errcode = '42501'; end if;
  if v_content is null and v_link is null then raise exception 'Escreva uma resposta ou informe um link.'; end if;
  if v_content is not null and length(v_content) > 20000 then raise exception 'Resposta muito longa (máx. 20.000 caracteres).'; end if;
  if v_link is not null and (v_link !~* '^https?://' or length(v_link) > 2000) then
    raise exception 'O link deve começar com http:// ou https://.';
  end if;

  select e.session_day into v_day from public.exercises e where e.id = p_exercise_id;
  if v_day is null then raise exception 'Exercício inexistente.'; end if;
  if not public._session_unlocked(u.id, v_day) then
    raise exception 'Sessão bloqueada: conclua as sessões anteriores (dependências) primeiro.';
  end if;

  select x.attempt, x.status into v_last from public.submissions x
   where x.exercise_id = p_exercise_id and x.student_id = u.id order by x.attempt desc limit 1;
  if found and v_last.status = 'submitted' then
    raise exception 'Você já tem uma entrega aguardando avaliação do tutor neste exercício.';
  end if;

  insert into public.submissions (exercise_id, student_id, attempt, content, link_url)
  values (p_exercise_id, u.id, coalesce(v_last.attempt, 0) + 1, v_content, v_link)
  returning * into s;
  return row_to_json(s);
end;
$$;

create function public.app_review(p_token text, p_submission_id uuid, p_score numeric, p_verdict text, p_feedback text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_user(p_token);
  r public.reviews;
begin
  if u.role <> 'teacher' then raise exception 'Apenas tutores podem avaliar.' using errcode = '42501'; end if;
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'A nota deve estar entre 0 e 10.'; end if;
  if p_verdict not in ('approved', 'revision_requested') then raise exception 'Resultado inválido.'; end if;
  if length(trim(coalesce(p_feedback, ''))) = 0 or length(p_feedback) > 5000 then
    raise exception 'Escreva um feedback (até 5.000 caracteres).';
  end if;
  if not exists (select 1 from public.submissions where id = p_submission_id) then
    raise exception 'Entrega inexistente.';
  end if;

  insert into public.reviews (submission_id, tutor_id, score, verdict, feedback)
  values (p_submission_id, u.id, round(p_score, 1), p_verdict, trim(p_feedback))
  on conflict (submission_id) do update
     set tutor_id = excluded.tutor_id, score = excluded.score, verdict = excluded.verdict, feedback = excluded.feedback
  returning * into r;
  update public.submissions set status = p_verdict where id = p_submission_id;
  return row_to_json(r);
end;
$$;

-- ───────────── Permissões das funções ─────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like '\_app\_%' or p.proname like '\_session\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('app_register','app_login','app_logout','app_me','app_bootstrap','app_submit','app_review') loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon', f.sig);   -- o app usa a chave anon; Supabase Auth não é usado
  end loop;
end $$;
