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
