-- ============================================================================
-- Correção automática por IA (Gemini) + revisão do tutor + notificações ao aluno.
--
-- Fluxo:  aluno envia (submitted)
--           └─ IA corrige (0–10)
--                ├─ nota ≥ 7 (e evidência suficiente)  → approved  (aprovação automática, aluno notificado)
--                └─ nota < 7  ou  evidência insuficiente → needs_review (fila do tutor)
--                       └─ tutor decide: approved · revision_requested (instruções + exemplos) · rejected
--                                         └─ todas as decisões geram notificação ao aluno
--
-- Segurança: as funções ai_* só são executáveis pelo papel service_role (Edge Function).
-- O app (anon) continua acessando apenas as RPCs app_*.
-- ============================================================================

-- ───────────── Novos estados e campos ─────────────
alter table public.submissions drop constraint if exists submissions_status_check;
alter table public.submissions add constraint submissions_status_check
  check (status in ('submitted', 'needs_review', 'approved', 'revision_requested', 'rejected'));

alter table public.reviews drop constraint if exists reviews_verdict_check;
alter table public.reviews add constraint reviews_verdict_check
  check (verdict in ('approved', 'revision_requested', 'rejected'));
alter table public.reviews alter column tutor_id drop not null;               -- null = correção automática da IA
alter table public.reviews add column if not exists source text not null default 'tutor' check (source in ('tutor', 'ai'));
alter table public.reviews add column if not exists instructions text check (instructions is null or length(instructions) <= 5000);
alter table public.reviews add column if not exists examples text check (examples is null or length(examples) <= 5000);

-- ───────────── Gabarito por exercício (solução esperada) ─────────────
create table if not exists public.exercise_rubrics (
  exercise_id text primary key references public.exercises (id) on delete cascade,
  mode text not null check (mode in ('text', 'sql', 'file', 'mixed')),
  expected text not null,
  checks jsonb not null,            -- [{id,label,weight,dim}] — pesos somam 100
  reference jsonb not null default '[]',   -- números calculados no banco de treinamento
  grading_notes text,
  force_tutor boolean not null default false   -- etapas presenciais: sempre vão ao tutor
);
comment on table public.exercise_rubrics is 'Solução esperada e critérios de cada exercício. Gerada de content/rubrics.mjs.';

-- ───────────── Avaliações da IA ─────────────
create table if not exists public.ai_evaluations (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  status text not null check (status in ('processing', 'done', 'error')),
  attempts int not null default 0,
  score numeric(3,1) check (score between 0 and 10),
  criteria jsonb,                   -- [{id,label,weight,dim,score,comment}]
  summary text,
  strengths jsonb,
  gaps jsonb,
  suggested_instructions text,      -- rascunho para o tutor (nunca enviado ao aluno sem revisão)
  suggested_examples text,
  evidence_sufficient boolean,
  confidence text check (confidence in ('low', 'medium', 'high')),
  suspected_manipulation boolean,
  outcome text check (outcome in ('auto_approved', 'sent_to_tutor', 'discarded')),
  outcome_reason text,
  model text,
  trigger text check (trigger in ('manual', 'scheduled')),
  run_by uuid references public.app_users (id) on delete set null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_evaluations_status_idx on public.ai_evaluations (status);

-- ───────────── Notificações ao aluno ─────────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  kind text not null check (kind in ('ai_approved', 'in_review', 'approved', 'revision_requested', 'rejected')),
  title text not null,
  body text not null,
  submission_id uuid references public.submissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['exercise_rubrics', 'ai_evaluations', 'notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Cria a notificação (interna).
create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text, p_submission uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, submission_id) values (p_user, p_kind, p_title, p_body, p_submission);
$$;

-- Texto padrão "Dia X · exercício" para as mensagens.
create or replace function public._submission_label(p_submission uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'Dia ' || e.session_day || ' · ' || e.title
  from public.submissions s join public.exercises e on e.id = s.exercise_id where s.id = p_submission;
$$;

-- ───────────── app_submit: bloqueia reenvio enquanto está em correção/revisão ou reprovada ─────────────
create or replace function public.app_submit(p_token text, p_exercise_id text, p_content text, p_link text)
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
  if found and v_last.status in ('submitted', 'needs_review') then
    raise exception 'Você já tem uma entrega aguardando avaliação neste exercício.';
  end if;
  if found and v_last.status = 'rejected'
     and not exists (select 1 from public.submissions x where x.exercise_id = p_exercise_id and x.student_id = u.id and x.status = 'approved') then
    raise exception 'Esta entrega foi reprovada pelo tutor. Fale com o tutor para reabrir o exercício.';
  end if;

  insert into public.submissions (exercise_id, student_id, attempt, content, link_url)
  values (p_exercise_id, u.id, coalesce(v_last.attempt, 0) + 1, v_content, v_link)
  returning * into s;
  return row_to_json(s);
end;
$$;

-- ───────────── app_review: decisão do tutor (aprovar · refazer · reprovar) ─────────────
drop function if exists public.app_review(text, uuid, numeric, text, text);
create function public.app_review(p_token text, p_submission_id uuid, p_score numeric, p_verdict text, p_feedback text,
                                  p_instructions text default null, p_examples text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_user(p_token);
  r public.reviews;
  v_fb text := trim(coalesce(p_feedback, ''));
  v_ins text := nullif(trim(coalesce(p_instructions, '')), '');
  v_ex text := nullif(trim(coalesce(p_examples, '')), '');
  v_student uuid;
  v_label text;
begin
  if u.role <> 'teacher' then raise exception 'Apenas tutores podem avaliar.' using errcode = '42501'; end if;
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'A nota deve estar entre 0 e 10.'; end if;
  if p_verdict not in ('approved', 'revision_requested', 'rejected') then raise exception 'Resultado inválido.'; end if;
  if length(v_fb) = 0 or length(v_fb) > 5000 then raise exception 'Escreva um feedback (até 5.000 caracteres).'; end if;
  if p_verdict = 'revision_requested' and (v_ins is null or v_ex is null) then
    raise exception 'Para pedir que o aluno refaça, informe as instruções e um exemplo de como refazer.';
  end if;
  if p_verdict <> 'revision_requested' then v_ins := null; v_ex := null; end if;
  select student_id into v_student from public.submissions where id = p_submission_id;
  if v_student is null then raise exception 'Entrega inexistente.'; end if;

  insert into public.reviews (submission_id, tutor_id, score, verdict, feedback, source, instructions, examples)
  values (p_submission_id, u.id, round(p_score, 1), p_verdict, v_fb, 'tutor', v_ins, v_ex)
  on conflict (submission_id) do update
     set tutor_id = excluded.tutor_id, score = excluded.score, verdict = excluded.verdict, feedback = excluded.feedback,
         source = 'tutor', instructions = excluded.instructions, examples = excluded.examples, created_at = now()
  returning * into r;
  update public.submissions set status = p_verdict where id = p_submission_id;

  v_label := public._submission_label(p_submission_id);
  perform public._notify(v_student, p_verdict,
    case p_verdict when 'approved' then '✅ Entrega aprovada' when 'revision_requested' then '↩ Refaça a entrega' else '❌ Entrega reprovada' end,
    v_label || ' — nota ' || round(p_score, 1) || '/10. ' ||
    case p_verdict when 'approved' then 'O tutor aprovou sua entrega.'
                   when 'revision_requested' then 'O tutor pediu ajustes: veja as instruções e o exemplo no exercício e envie uma nova versão.'
                   else 'O tutor reprovou esta entrega. Veja o motivo no exercício.' end,
    p_submission_id);
  return row_to_json(r);
end;
$$;

-- ───────────── Notificações: marcar como lidas ─────────────
create function public.app_notifications_read(p_token text, p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_user(p_token); n int;
begin
  update public.notifications set read_at = now()
   where user_id = u.id and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ───────────── app_bootstrap: inclui notificações; tutor recebe rubricas e avaliações da IA ─────────────
create or replace function public.app_bootstrap(p_token text)
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
                          where u.role = 'teacher' or p.id = u.id),
    'notifications',    (select coalesce(json_agg(n order by n.created_at desc), '[]')
                           from (select * from public.notifications where user_id = u.id order by created_at desc limit 100) n),
    'rubrics',          (select coalesce(json_agg(x), '[]') from public.exercise_rubrics x where u.role = 'teacher'),
    'aiEvaluations',    (select coalesce(json_agg(x), '[]') from public.ai_evaluations x where u.role = 'teacher' and x.status <> 'processing')
  );
end;
$$;

-- ============================================================================
-- Funções da automação (apenas service_role — chamadas pela Edge Function)
-- ============================================================================

-- Tutor autenticado? Retorna o id (ou levanta erro). Usada no acionamento manual.
create function public.ai_teacher_id(p_token text)
returns uuid language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_user(p_token);
begin
  if u.role <> 'teacher' then raise exception 'Apenas tutores podem acionar a correção por IA.' using errcode = '42501'; end if;
  return u.id;
end;
$$;

-- Reserva entregas para corrigir (sem corrida entre execuções) e devolve tudo que a IA precisa.
-- Pega: status 'submitted' sem avaliação, com erro (até 3 tentativas) ou presas em 'processing' há > 10 min.
create function public.ai_claim(p_limit int default 10, p_submission_ids uuid[] default null,
                                p_trigger text default 'scheduled', p_run_by uuid default null)
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
            or (a.status = 'error' and a.attempts < 3)
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

-- Aplica o resultado da IA. A regra de aprovação automática mora aqui (fonte única de verdade):
--   nota ≥ 7  E  evidência suficiente  E  confiança ≠ baixa  E  sem tentativa de manipulação  E  exercício não é só-tutor
create function public.ai_apply(p_submission uuid, p_score numeric, p_criteria jsonb, p_summary text, p_strengths jsonb, p_gaps jsonb,
                                p_sug_instructions text, p_sug_examples text, p_evidence_sufficient boolean, p_confidence text,
                                p_manipulation boolean, p_feedback text, p_model text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c_pass constant numeric := 7;
  s public.submissions;
  v_force boolean;
  v_outcome text;
  v_reason text;
  v_label text;
begin
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'Nota da IA fora do intervalo 0–10.'; end if;
  select * into s from public.submissions where id = p_submission for update;
  if not found then raise exception 'Entrega inexistente.'; end if;
  select coalesce(r.force_tutor, false) into v_force from public.exercise_rubrics r where r.exercise_id = s.exercise_id;

  if s.status <> 'submitted' then
    -- o tutor decidiu enquanto a IA corrigia: guarda a avaliação, mas não altera nada
    v_outcome := 'discarded'; v_reason := 'already_decided';
  elsif p_score >= c_pass and coalesce(p_evidence_sufficient, false) and p_confidence <> 'low'
        and not coalesce(p_manipulation, false) and not coalesce(v_force, false) then
    v_outcome := 'auto_approved'; v_reason := 'score_at_or_above_pass';
  else
    v_outcome := 'sent_to_tutor';
    v_reason := case when coalesce(p_manipulation, false) then 'suspected_manipulation'
                     when coalesce(v_force, false) then 'tutor_only_exercise'
                     when not coalesce(p_evidence_sufficient, false) then 'insufficient_evidence'
                     when p_confidence = 'low' then 'low_confidence'
                     else 'score_below_pass' end;
  end if;

  update public.ai_evaluations set
    status = 'done', score = round(p_score, 1), criteria = p_criteria, summary = p_summary, strengths = p_strengths, gaps = p_gaps,
    suggested_instructions = p_sug_instructions, suggested_examples = p_sug_examples, evidence_sufficient = p_evidence_sufficient,
    confidence = p_confidence, suspected_manipulation = coalesce(p_manipulation, false), outcome = v_outcome, outcome_reason = v_reason,
    model = p_model, error = null, finished_at = now(), attempts = attempts + 1
  where submission_id = p_submission;

  v_label := public._submission_label(p_submission);
  if v_outcome = 'auto_approved' then
    insert into public.reviews (submission_id, tutor_id, score, verdict, feedback, source)
    values (p_submission, null, round(p_score, 1), 'approved', left(p_feedback, 5000), 'ai')
    on conflict (submission_id) do nothing;
    update public.submissions set status = 'approved' where id = p_submission;
    perform public._notify(s.student_id, 'ai_approved', '✅ Entrega aprovada (correção automática)',
      v_label || ' — nota ' || round(p_score, 1) || '/10. Corrigida automaticamente pela IA; veja o feedback no exercício.', p_submission);
  elsif v_outcome = 'sent_to_tutor' then
    update public.submissions set status = 'needs_review' where id = p_submission;
    perform public._notify(s.student_id, 'in_review', '🔎 Entrega em revisão pelo tutor',
      v_label || ' — sua entrega passou pela correção automática e agora será revisada pelo tutor. Você será avisado da decisão.', p_submission);
  end if;
  return json_build_object('outcome', v_outcome, 'reason', v_reason, 'score', round(p_score, 1));
end;
$$;

-- Registra falha (a entrega volta a ser elegível até 3 tentativas).
create function public.ai_fail(p_submission uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.ai_evaluations set status = 'error', error = left(p_error, 1000), attempts = attempts + 1, finished_at = now()
   where submission_id = p_submission;
$$;

-- Quantas entregas aguardam correção (para o botão e o agendador).
create function public.ai_pending_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.submissions s left join public.ai_evaluations a on a.submission_id = s.id
   where s.status = 'submitted' and (a.submission_id is null or (a.status = 'error' and a.attempts < 3)
                                     or (a.status = 'processing' and a.started_at < now() - interval '10 minutes'));
$$;

-- ───────────── Permissões ─────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'ai\_%' or p.proname in ('_notify', '_submission_label')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if exists (select 1 from pg_roles where rolname = 'service_role') and f.name like 'ai\_%' then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('app_submit', 'app_review', 'app_bootstrap', 'app_notifications_read') loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon', f.sig);
  end loop;
end $$;
