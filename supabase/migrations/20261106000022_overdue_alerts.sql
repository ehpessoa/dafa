-- ============================================================================
-- Alertas de atraso da ENTREGA SEMANAL (WhatsApp + notificação no app) para alunos e tutores.
--
-- Atraso = o prazo (weekly_deliverables.due_date) já passou e o aluno ainda NÃO enviou alguma entrega
-- (nenhuma tentativa, de qualquer status) de algum exercício da sessão que fecha a semana (weekly_deliverables.session_day).
-- Quem já enviou e aguarda correção, ou precisa refazer, NÃO conta como atrasado.
--
-- Regras (constantes em alerts_overdue_claim):
--   · só dias úteis (seg–sex, horário de Brasília)
--   · só semanas com prazo DEPOIS do cadastro do aluno (quem entra no meio do programa não recebe aviso de semanas antigas)
--   · no máximo 1 aviso a cada 3 dias por aluno, e no máximo 8 avisos por aluno
--   · alunos com alerts_paused = true não recebem (nem entram no resumo do tutor)
--   · tutores recebem um resumo (notificação no app + WhatsApp, se tiverem número) dos alunos avisados na rodada
-- O envio de WhatsApp é feito pela função serverless /api/overdue-alerts (Vercel), que chama este banco com a service_role.
-- ============================================================================
alter table public.app_users add column if not exists alerts_paused boolean not null default false;

alter table public.notifications add column if not exists link text;   -- rota do app aberta pelo botão da notificação
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('ai_approved', 'in_review', 'approved', 'revision_requested', 'rejected', 'overdue', 'overdue_tutor'));

create table if not exists public.overdue_alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.app_users (id) on delete cascade,
  weeks int[] not null,                       -- semanas em atraso informadas neste aviso
  n int not null,                             -- nº do aviso para este aluno (1, 2, …)
  sent_at timestamptz not null default now(),
  whatsapp_status text not null default 'pending' check (whatsapp_status in ('pending', 'sent', 'failed', 'skipped')),
  whatsapp_error text
);
create index if not exists overdue_alerts_student_idx on public.overdue_alerts (student_id, sent_at desc);
alter table public.overdue_alerts enable row level security;
revoke all on public.overdue_alerts from anon, authenticated;

-- O perfil devolvido ao app passa a informar se os alertas do aluno estão pausados.
create or replace function public._app_user_json(u public.app_users)
returns json language sql immutable set search_path = public as $$
  select json_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'avatar_url', null,
                           'role', u.role, 'created_at', u.created_at,
                           'phone_verified', u.phone_verified_at is not null,
                           'phone_hint', case when u.phone is null then null else right(u.phone, 4) end,
                           'alerts_paused', u.alerts_paused);
$$;

-- ───────────── Quem está em atraso (interna) ─────────────
create or replace function public._overdue_list(p_today date, p_include_paused boolean default false)
returns table (student_id uuid, week int, title text, due_date date, session_day int, days_late int)
language sql stable security definer set search_path = public as $$
  select u.id, w.week, w.title, w.due_date, w.session_day, (p_today - w.due_date)
    from public.app_users u
    cross join public.weekly_deliverables w
   where u.role = 'student'
     and u.phone_verified_at is not null
     and (p_include_paused or not u.alerts_paused)
     and w.due_date < p_today
     and w.due_date >= (u.created_at at time zone 'America/Sao_Paulo')::date
     and exists (select 1 from public.exercises e
                  where e.session_day = w.session_day
                    and not exists (select 1 from public.submissions s where s.exercise_id = e.id and s.student_id = u.id))
   order by u.id, w.week;
$$;

-- ───────────── Rodada diária (service_role): registra, cria notificações e devolve o que enviar por WhatsApp ─────────────
create or replace function public.alerts_overdue_claim(p_force boolean default false, p_today date default null, p_limit int default 40)
returns json language plpgsql security definer set search_path = public as $$
declare
  c_gap constant interval := interval '3 days';
  c_max constant int := 8;
  v_today date := coalesce(p_today, (now() at time zone 'America/Sao_Paulo')::date);
  r record;
  v_n int;
  v_id uuid;
  v_body text;
  v_students jsonb := '[]';
  v_lines text;
  v_count int := 0;
  v_paused int;
begin
  if not p_force and extract(isodow from v_today) in (6, 7) then
    return json_build_object('skipped', 'fim_de_semana');
  end if;
  perform pg_advisory_xact_lock(7340022);          -- duas execuções simultâneas não duplicam avisos

  for r in
    select l.student_id, u.full_name, u.phone,
           json_agg(json_build_object('week', l.week, 'title', l.title, 'due_date', l.due_date,
                                      'days_late', l.days_late, 'session_day', l.session_day) order by l.week) as items,
           min(l.session_day) as first_day, max(l.days_late) as worst
      from public._overdue_list(v_today, false) l
      join public.app_users u on u.id = l.student_id
     where not exists (select 1 from public.overdue_alerts a where a.student_id = l.student_id and a.sent_at > now() - c_gap)
       and (select count(*) from public.overdue_alerts a where a.student_id = l.student_id) < c_max
     group by l.student_id, u.full_name, u.phone
     order by max(l.days_late) desc, u.full_name
     limit greatest(1, least(coalesce(p_limit, 40), 100))
  loop
    select count(*) + 1 into v_n from public.overdue_alerts where student_id = r.student_id;
    insert into public.overdue_alerts (student_id, weeks, n, whatsapp_status)
    values (r.student_id, array(select (x ->> 'week')::int from json_array_elements(r.items) x), v_n,
            case when r.phone is null then 'skipped' else 'pending' end)
    returning id into v_id;

    select string_agg('• Semana ' || (x ->> 'week') || ' — ' || (x ->> 'title') || ' (venceu em ' || to_char((x ->> 'due_date')::date, 'DD/MM')
                      || ', ' || (x ->> 'days_late') || case when (x ->> 'days_late') = '1' then ' dia' else ' dias' end || ' de atraso)',
                      E'\n' order by (x ->> 'week')::int)
      into v_body from json_array_elements(r.items) x;
    insert into public.notifications (user_id, kind, title, body, link)
    values (r.student_id, 'overdue', '⏰ Entrega semanal em atraso',
            v_body || E'\nEnvie assim que puder. Se precisar de mais tempo, fale com o tutor.',
            '/sessao/' || r.first_day || '?tab=exercicios');

    v_students := v_students || jsonb_build_array(jsonb_build_object(
      'alert_id', v_id, 'student_id', r.student_id, 'name', r.full_name, 'phone', r.phone, 'n', v_n,
      'worst_days', r.worst, 'first_day', r.first_day, 'items', r.items::jsonb));
    v_count := v_count + 1;
  end loop;

  select count(distinct student_id)::int into v_paused from public._overdue_list(v_today, true) l
   where exists (select 1 from public.app_users u where u.id = l.student_id and u.alerts_paused);

  if v_count > 0 then
    select string_agg(x ->> 'name' || ' (Semana ' || ((x -> 'items' -> 0) ->> 'week') || ', ' || (x ->> 'worst_days') || 'd)', '; ')
      into v_lines from (select value as x from jsonb_array_elements(v_students) limit 15) t;
    insert into public.notifications (user_id, kind, title, body, link)
    select t.id, 'overdue_tutor', '📋 ' || v_count || case when v_count = 1 then ' aluno com entrega semanal em atraso' else ' alunos com entrega semanal em atraso' end,
           'Avisados hoje: ' || v_lines || case when v_count > 15 then ' …' else '' end
           || case when v_paused > 0 then E'\n(' || v_paused || ' com alertas pausados)' else '' end,
           '/tutor/alunos'
      from public.app_users t where t.role = 'teacher' and t.phone_verified_at is not null;
  end if;

  return json_build_object(
    'run_date', v_today, 'students', v_students, 'paused_count', v_paused,
    'tutors', (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.full_name, 'phone', t.phone)), '[]')
                 from public.app_users t where t.role = 'teacher' and t.phone_verified_at is not null and v_count > 0));
end;
$$;

-- Resultado do envio por WhatsApp de um aviso.
create or replace function public.alerts_overdue_result(p_alert_id uuid, p_status text, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.overdue_alerts set whatsapp_status = p_status, whatsapp_error = left(p_error, 300)
   where id = p_alert_id and p_status in ('sent', 'failed', 'skipped');
$$;

-- A chamada do agendador é autenticada pelo mesmo segredo do Vault usado pelos outros jobs (dafa_cron_secret).
create or replace function public.cron_secret_ok(p_secret text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare ok boolean;
begin
  if p_secret is null or length(p_secret) < 16 then return false; end if;
  execute 'select exists (select 1 from vault.decrypted_secrets where name = ''dafa_cron_secret'' and decrypted_secret = $1)' into ok using p_secret;
  return coalesce(ok, false);
exception when others then
  return false;
end;
$$;

-- ───────────── API do app (tutor) ─────────────
-- Pausar/retomar os alertas de UM aluno.
create or replace function public.app_set_student_alerts(p_token text, p_student_id uuid, p_paused boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.app_users := public._app_active_user(p_token);
  s public.app_users;
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores podem pausar alertas.' using errcode = '42501'; end if;
  update public.app_users set alerts_paused = coalesce(p_paused, false)
   where id = p_student_id and role = 'student' returning * into s;
  if not found then raise exception 'Aluno não encontrado.'; end if;
  return public._app_user_json(s);
end;
$$;

-- Quem está em atraso agora (inclui alunos com alertas pausados), para a tela do tutor.
create or replace function public.app_overdue_overview(p_token text, p_today date default null)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.app_users := public._app_active_user(p_token);
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores veem os atrasos.' using errcode = '42501'; end if;
  return (select coalesce(json_agg(x), '[]') from (
    select l.student_id,
           json_agg(json_build_object('week', l.week, 'title', l.title, 'due_date', l.due_date, 'days_late', l.days_late) order by l.week) as weeks
      from public._overdue_list(coalesce(p_today, (now() at time zone 'America/Sao_Paulo')::date), true) l
     group by l.student_id) x);
end;
$$;

-- ───────────── Permissões ─────────────
revoke all on function public._overdue_list(date, boolean) from public, anon, authenticated;
revoke all on function public.alerts_overdue_claim(boolean, date, int) from public, anon, authenticated;
revoke all on function public.alerts_overdue_result(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
revoke all on function public.app_set_student_alerts(text, uuid, boolean) from public;
revoke all on function public.app_overdue_overview(text, date) from public;
grant execute on function public.app_set_student_alerts(text, uuid, boolean) to anon;
grant execute on function public.app_overdue_overview(text, date) to anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.alerts_overdue_claim(boolean, date, int) to service_role;
    grant execute on function public.alerts_overdue_result(uuid, text, text) to service_role;
    grant execute on function public.cron_secret_ok(text) to service_role;
  end if;
end $$;
