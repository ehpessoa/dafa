-- ============================================================================
-- Entrega por ARQUIVO anexado ou por LINK PÚBLICO validado.
--   · arquivos: guardados no Supabase Storage (bucket privado 'submission-files'); só a Edge Function `submission-files`
--     (service_role) grava/lê. O app vê apenas os metadados.
--   · links: antes de aceitar a entrega, a Edge Function baixa o link (público?) e registra o resultado em link_checks.
--     app_submit EXIGE uma validação ok e recente (1 h) do mesmo link — não dá para burlar pelo cliente.
-- ============================================================================
create table if not exists public.submission_files (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.app_users (id) on delete cascade,
  exercise_id text not null references public.exercises (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete cascade,   -- null = anexado, ainda não enviado
  name text not null check (length(name) between 1 and 200),
  mime text,
  size_bytes int not null check (size_bytes between 1 and 8388608),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists submission_files_sub_idx on public.submission_files (submission_id);
create index if not exists submission_files_pending_idx on public.submission_files (student_id, exercise_id) where submission_id is null;

create table if not exists public.link_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  url text not null check (length(url) <= 2000),
  ok boolean not null,
  kind text,
  detail text,
  warning text,
  checked_at timestamptz not null default now()
);
create index if not exists link_checks_lookup_idx on public.link_checks (user_id, url, checked_at desc);

alter table public.submissions add column if not exists link_check jsonb;
-- a entrega pode ter só arquivos anexados: a regra "texto ou link" passa a aceitar também anexos
alter table public.submissions add column if not exists attachment_count int not null default 0;
alter table public.submissions drop constraint if exists submissions_check;
alter table public.submissions drop constraint if exists submissions_evidence_check;
alter table public.submissions add constraint submissions_evidence_check
  check (coalesce(length(trim(content)), 0) > 0 or coalesce(length(trim(link_url)), 0) > 0 or attachment_count > 0);   -- {ok, kind, warning, checked_at} no momento do envio

do $$
declare t text;
begin
  foreach t in array array['submission_files', 'link_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  -- bucket privado (sem policies: só o service_role acessa); ignorado fora do Supabase
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit) values ('submission-files', 'submission-files', false, 8388608)
    on conflict (id) do nothing;
  end if;
end $$;

-- ───────────── app_submit: arquivos e link validado ─────────────
drop function if exists public.app_submit(text, text, text, text);
create function public.app_submit(p_token text, p_exercise_id text, p_content text, p_link text, p_file_ids uuid[] default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_active_user(p_token);
  v_day int;
  v_last record;
  v_content text := nullif(trim(coalesce(p_content, '')), '');
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  v_files uuid[] := coalesce(array(select distinct x from unnest(p_file_ids) x), '{}');
  lc public.link_checks;
  s public.submissions;
begin
  if u.role <> 'student' then raise exception 'Apenas alunos enviam entregas.' using errcode = '42501'; end if;
  if v_content is null and v_link is null and cardinality(v_files) = 0 then
    raise exception 'Escreva uma resposta, anexe arquivos ou informe um link.';
  end if;
  if v_content is not null and length(v_content) > 20000 then raise exception 'Resposta muito longa (máx. 20.000 caracteres).'; end if;
  if v_link is not null and (v_link !~* '^https?://' or length(v_link) > 2000) then
    raise exception 'O link deve começar com http:// ou https://.';
  end if;
  if cardinality(v_files) > 5 then raise exception 'Anexe no máximo 5 arquivos por entrega.'; end if;

  select e.session_day into v_day from public.exercises e where e.id = p_exercise_id;
  if v_day is null then raise exception 'Exercício inexistente.'; end if;
  if not public._session_unlocked(u.id, v_day) then
    raise exception 'Sessão bloqueada: conclua as sessões anteriores (dependências) primeiro.';
  end if;

  if cardinality(v_files) > 0 and (select count(*) from public.submission_files f
        where f.id = any (v_files) and f.student_id = u.id and f.exercise_id = p_exercise_id and f.submission_id is null) <> cardinality(v_files) then
    raise exception 'Algum arquivo anexado não está mais disponível. Anexe novamente.';
  end if;
  if v_link is not null then
    select * into lc from public.link_checks c
     where c.user_id = u.id and c.url = v_link and c.ok and c.checked_at > now() - interval '1 hour'
     order by c.checked_at desc limit 1;
    if not found then
      raise exception 'Valide o link antes de enviar: ele precisa estar público (“qualquer pessoa com o link”) e acessível.';
    end if;
  end if;

  select x.attempt, x.status into v_last from public.submissions x
   where x.exercise_id = p_exercise_id and x.student_id = u.id order by x.attempt desc limit 1;
  if found and v_last.status in ('submitted', 'needs_review') then
    raise exception 'Você já tem uma entrega aguardando avaliação neste exercício.';
  end if;
  if found and v_last.status = 'rejected'
     and not exists (select 1 from public.submissions x where x.exercise_id = p_exercise_id and x.student_id = u.id and x.status = 'approved') then
    raise exception 'Esta entrega foi reprovada pelo tutor. Fale com o tutor para reabrir o exercício.';
  end if;

  insert into public.submissions (exercise_id, student_id, attempt, content, link_url, attachment_count, link_check)
  values (p_exercise_id, u.id, coalesce(v_last.attempt, 0) + 1, v_content, v_link, cardinality(v_files),
          case when v_link is null then null else jsonb_build_object('ok', true, 'kind', lc.kind, 'warning', lc.warning, 'checked_at', lc.checked_at) end)
  returning * into s;
  update public.submission_files set submission_id = s.id where id = any (v_files);
  return row_to_json(s);
end;
$$;

-- ───────────── Bootstrap com metadados dos arquivos ─────────────
create or replace function public.app_bootstrap(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_active_user(p_token);
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
                          where u.role = 'teacher' or p.id = u.id),
    'notifications',    (select coalesce(json_agg(n order by n.created_at desc), '[]')
                           from (select * from public.notifications where user_id = u.id order by created_at desc limit 100) n),
    'files',            (select coalesce(json_agg(json_build_object('id', f.id, 'student_id', f.student_id, 'exercise_id', f.exercise_id, 'submission_id', f.submission_id,
                           'name', f.name, 'mime', f.mime, 'size_bytes', f.size_bytes, 'created_at', f.created_at) order by f.created_at), '[]')
                          from public.submission_files f where f.submission_id is not null and (u.role = 'teacher' or f.student_id = u.id)),
    'rubrics',          (select coalesce(json_agg(x), '[]') from public.exercise_rubrics x where u.role = 'teacher'),
    'aiEvaluations',    (select coalesce(json_agg(x), '[]') from public.ai_evaluations x where u.role = 'teacher' and x.status <> 'processing')
  );
end;
$$;

create or replace function public.ai_claim(p_limit int default 10, p_submission_ids uuid[] default null,
                                p_trigger text default 'scheduled', p_run_by uuid default null,
                                p_skip_errors boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    select s.id
      from public.submissions s
      left join public.ai_evaluations a on a.submission_id = s.id
     where s.status = 'submitted'
       and (p_submission_ids is null or s.id = any (p_submission_ids))
       and (a.submission_id is null
            or (a.status = 'error' and a.attempts < 3 and not p_skip_errors)
            or (a.status = 'processing' and a.started_at < now() - interval '10 minutes'))
     order by s.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 25))
       for update of s skip locked) q;

  insert into public.ai_evaluations (submission_id, status, attempts, trigger, run_by, started_at)
  select id, 'processing', 0, p_trigger, p_run_by, now() from unnest(v_ids) id
  on conflict (submission_id) do update
     set status = 'processing', trigger = excluded.trigger, run_by = excluded.run_by, started_at = now(), error = null;

  return (select coalesce(json_agg(json_build_object(
      'submission', json_build_object('id', s.id, 'attempt', s.attempt, 'content', s.content, 'link_url', s.link_url),
      'exercise',   json_build_object('id', e.id, 'title', e.title, 'instructions', e.instructions, 'deliverable', e.deliverable),
      'session',    json_build_object('day', se.day, 'title', se.title, 'level', se.level_slug),
      'files',      (select coalesce(json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes, 'path', f.storage_path) order by f.created_at), '[]')
                       from public.submission_files f where f.submission_id = s.id),
      'rubric',     (select to_json(r) from public.exercise_rubrics r where r.exercise_id = e.id),
      'previous',   (select coalesce(json_agg(json_build_object('attempt', p.attempt, 'status', p.status,
                        'score', rv.score, 'feedback', rv.feedback, 'instructions', rv.instructions) order by p.attempt), '[]')
                       from public.submissions p left join public.reviews rv on rv.submission_id = p.id
                      where p.exercise_id = s.exercise_id and p.student_id = s.student_id and p.attempt < s.attempt)
    ) order by s.created_at), '[]')
    from public.submissions s
    join public.exercises e on e.id = s.exercise_id
    join public.sessions se on se.day = e.session_day
   where s.id = any (v_ids));
end;
$$;

-- ───────────── Funções da Edge Function submission-files (apenas service_role) ─────────────
-- Identifica quem envia; com p_exercise exige aluno, exercício existente e sessão liberada.
create function public.file_actor(p_token text, p_exercise text default null)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_active_user(p_token); v_day int;
begin
  if p_exercise is not null then
    if u.role <> 'student' then raise exception 'Apenas alunos anexam arquivos.' using errcode = '42501'; end if;
    select e.session_day into v_day from public.exercises e where e.id = p_exercise;
    if v_day is null then raise exception 'Exercício inexistente.'; end if;
    if not public._session_unlocked(u.id, v_day) then raise exception 'Sessão bloqueada: conclua as sessões anteriores primeiro.'; end if;
  end if;
  return json_build_object('id', u.id, 'role', u.role);
end;
$$;

create function public.file_register(p_user uuid, p_exercise text, p_name text, p_mime text, p_size int, p_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if (select count(*) from public.submission_files where student_id = p_user and exercise_id = p_exercise and submission_id is null) >= 5 then
    raise exception 'Você já anexou 5 arquivos. Remova algum ou envie a entrega.';
  end if;
  insert into public.submission_files (student_id, exercise_id, name, mime, size_bytes, storage_path)
  values (p_user, p_exercise, left(p_name, 200), p_mime, p_size, p_path) returning id into v_id;
  return v_id;
end;
$$;

-- Remove um anexo ainda não enviado; devolve o caminho no Storage (ou null).
create function public.file_pending_delete(p_user uuid, p_id uuid)
returns text language sql security definer set search_path = public as $$
  delete from public.submission_files where id = p_id and student_id = p_user and submission_id is null returning storage_path;
$$;

-- Acesso a um arquivo: dono ou tutor.
create function public.file_access(p_token text, p_id uuid)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_active_user(p_token); f public.submission_files;
begin
  select * into f from public.submission_files where id = p_id;
  if not found or (u.role <> 'teacher' and f.student_id <> u.id) then raise exception 'Arquivo não encontrado.'; end if;
  return json_build_object('path', f.storage_path, 'name', f.name, 'mime', f.mime);
end;
$$;

-- Início de uma validação de link: só aluno, no máximo 30 por hora.
create function public.link_check_begin(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_active_user(p_token);
begin
  if u.role <> 'student' then raise exception 'Apenas alunos validam links de entrega.' using errcode = '42501'; end if;
  if (select count(*) from public.link_checks where user_id = u.id and checked_at > now() - interval '1 hour') >= 30 then
    raise exception 'Muitas validações de link. Tente novamente em alguns minutos.';
  end if;
  return u.id;
end;
$$;

create function public.link_check_save(p_user uuid, p_url text, p_ok boolean, p_kind text, p_detail text, p_warning text)
returns void language sql security definer set search_path = public as $$
  insert into public.link_checks (user_id, url, ok, kind, detail, warning) values (p_user, left(p_url, 2000), p_ok, p_kind, left(p_detail, 500), left(p_warning, 500));
$$;

-- Limpeza: anexos não enviados há mais de p_hours e validações antigas. Devolve os caminhos para apagar no Storage.
create function public.files_cleanup_pending(p_hours int default 24)
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  with d as (delete from public.submission_files where submission_id is null and created_at < now() - make_interval(hours => p_hours) returning storage_path)
  select coalesce(array_agg(storage_path), '{}') into v from d;
  delete from public.link_checks where checked_at < now() - interval '7 days';
  return v;
end;
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'file\_%' or p.proname like 'link\_check%' or p.proname = 'files_cleanup_pending'
                                           or p.proname in ('ai_claim', 'app_submit', 'app_bootstrap')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.name in ('app_submit', 'app_bootstrap') then
      execute format('grant execute on function %s to anon', f.sig);
    elsif exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
