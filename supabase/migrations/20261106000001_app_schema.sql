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
