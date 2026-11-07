-- ============================================================================
-- Correção por IA, parte 2:
--   · job diário: ai_claim só reserva o que AINDA está 'submitted' (o que o tutor já decidiu fica de fora);
--     p_skip_errors evita repetir, no mesmo job, o que acabou de falhar
--   · pré-análise de arquivos (Excel, Python, DAX, Power BI, slides…): a IA lê e dá nota, mas a decisão final é SEMPRE do tutor
-- ============================================================================
alter table public.ai_evaluations add column if not exists requires_tutor boolean not null default false;
alter table public.ai_evaluations add column if not exists attachments jsonb not null default '[]';   -- [{source,status,kind,detail}]

drop function if exists public.ai_claim(int, uuid[], text, uuid);
create function public.ai_claim(p_limit int default 10, p_submission_ids uuid[] default null,
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

drop function if exists public.ai_apply(uuid, numeric, jsonb, text, jsonb, jsonb, text, text, boolean, text, boolean, text, text);
create function public.ai_apply(p_submission uuid, p_score numeric, p_criteria jsonb, p_summary text, p_strengths jsonb, p_gaps jsonb,
                                p_sug_instructions text, p_sug_examples text, p_evidence_sufficient boolean, p_confidence text,
                                p_manipulation boolean, p_feedback text, p_model text,
                                p_requires_tutor boolean default false, p_attachments jsonb default '[]')
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
        and not coalesce(p_manipulation, false) and not coalesce(v_force, false) and not coalesce(p_requires_tutor, false) then
    v_outcome := 'auto_approved'; v_reason := 'score_at_or_above_pass';
  else
    v_outcome := 'sent_to_tutor';
    v_reason := case when coalesce(p_manipulation, false) then 'suspected_manipulation'
                     when coalesce(v_force, false) then 'tutor_only_exercise'
                     when not coalesce(p_evidence_sufficient, false) then 'insufficient_evidence'
                     when p_confidence = 'low' then 'low_confidence'
                     when coalesce(p_requires_tutor, false) and p_score >= c_pass then 'file_requires_tutor'
                     else 'score_below_pass' end;
  end if;

  update public.ai_evaluations set
    status = 'done', score = round(p_score, 1), criteria = p_criteria, summary = p_summary, strengths = p_strengths, gaps = p_gaps,
    suggested_instructions = p_sug_instructions, suggested_examples = p_sug_examples, evidence_sufficient = p_evidence_sufficient,
    confidence = p_confidence, suspected_manipulation = coalesce(p_manipulation, false), outcome = v_outcome, outcome_reason = v_reason,
    model = p_model, requires_tutor = coalesce(p_requires_tutor, false), attachments = coalesce(p_attachments, '[]'::jsonb), error = null, finished_at = now(), attempts = attempts + 1
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
      v_label || case when coalesce(p_requires_tutor, false) then ' — a IA fez uma pré-análise do seu arquivo e o tutor fará a análise final. Você será avisado da decisão.'
                    else ' — sua entrega passou pela correção automática e agora será revisada pelo tutor. Você será avisado da decisão.' end, p_submission);
  end if;
  return json_build_object('outcome', v_outcome, 'reason', v_reason, 'score', round(p_score, 1));
end;
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('ai_claim', 'ai_apply') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
