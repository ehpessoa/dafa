-- ============================================================================
-- Edição de perfil, convite de tutores e troca de perfil (aluno ⇄ tutor).
--
--   - Nome: livre. E-mail e senha: exigem a SENHA ATUAL (com a mesma proteção de tentativas do login).
--   - WhatsApp: exige a senha atual e um código enviado ao NOVO número; só então o número é trocado
--     (a recuperação de senha depende dele). O envio é feito pelo backend (service_role).
--   - Convites passam a ter perfil (student | teacher): um tutor pode convidar outro tutor.
--   - app_set_role: tutor promove aluno a tutor ou rebaixa tutor a aluno (nunca o próprio perfil,
--     o que garante que sempre reste ao menos um tutor).
-- ============================================================================

-- Confere a senha atual e aplica o bloqueio por tentativas. Retorna null se correta, senão a mensagem de erro.
create function public._pw_check(p_user uuid, p_pw text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  select * into u from public.app_users where id = p_user;
  if u.locked_until is not null and u.locked_until > now() then
    return 'Muitas tentativas incorretas. Tente novamente em alguns minutos.';
  end if;
  if p_pw is null or u.password_hash <> crypt(p_pw, u.password_hash) then
    update public.app_users
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '10 minutes' else null end
     where id = u.id;
    return 'Senha atual incorreta.';
  end if;
  update public.app_users set failed_attempts = 0, locked_until = null where id = u.id and failed_attempts <> 0;
  return null;
end;
$$;
revoke all on function public._pw_check(uuid, text) from public, anon, authenticated;

-- ───────────── Perfil ─────────────
create function public.app_profile_update(p_token text, p_name text, p_email text, p_password text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_active_user(p_token);
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_err text;
begin
  if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Informe seu nome (2 a 100 caracteres).'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Informe um e-mail válido.'; end if;
  if v_email <> u.email then
    v_err := public._pw_check(u.id, p_password);
    if v_err is not null then return json_build_object('error', v_err); end if;
    if exists (select 1 from public.app_users where email = v_email) then raise exception 'Este e-mail já está em uso.'; end if;
  end if;
  begin
    update public.app_users set full_name = v_name, email = v_email where id = u.id returning * into u;
  exception when unique_violation then
    raise exception 'Este e-mail já está em uso.';
  end;
  return json_build_object('user', public._app_user_json(u));
end;
$$;

create function public.app_change_password(p_token text, p_current text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_active_user(p_token);
  v_err text;
begin
  if p_new is null or length(p_new) < 8 then return json_build_object('error', 'A nova senha deve ter pelo menos 8 caracteres.'); end if;
  if octet_length(p_new) > 72 then return json_build_object('error', 'A nova senha deve ter no máximo 72 caracteres.'); end if;
  v_err := public._pw_check(u.id, p_current);
  if v_err is not null then return json_build_object('error', v_err); end if;
  update public.app_users set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = u.id;
  delete from public.app_sessions where user_id = u.id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');   -- encerra os outros dispositivos
  return json_build_object('ok', true);
end;
$$;

-- ───────────── Troca de WhatsApp (com verificação do novo número) ─────────────
create table public.phone_changes (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  new_phone text not null check (new_phone ~ '^55[0-9]{10,11}$'),
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.phone_changes enable row level security;
revoke all on public.phone_changes from public, anon, authenticated;

-- (service_role) confere a senha e gera o código que será enviado ao NOVO número.
create function public.app_phone_change_issue(p_token text, p_password text, p_phone text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_active_user(p_token);
  v_phone text := public._normalize_phone(p_phone);
  v_err text;
  r public.phone_changes;
  v_code text;
begin
  if v_phone is null then raise exception 'Informe um WhatsApp válido no formato (99) 99999-9999.'; end if;
  if v_phone = u.phone then raise exception 'Este já é o seu WhatsApp cadastrado.'; end if;
  v_err := public._pw_check(u.id, p_password);
  if v_err is not null then return json_build_object('error', v_err); end if;
  select * into r from public.phone_changes where user_id = u.id;
  if found and r.created_at > now() - interval '60 seconds' then return json_build_object('throttled', true); end if;

  v_code := public._code6();
  insert into public.phone_changes (user_id, new_phone, code_hash, attempts, created_at, expires_at)
  values (u.id, v_phone, public._code_hash(u.id, v_code), 0, now(), now() + interval '15 minutes')
  on conflict (user_id) do update
     set new_phone = excluded.new_phone, code_hash = excluded.code_hash, attempts = 0,
         created_at = excluded.created_at, expires_at = excluded.expires_at;
  return json_build_object('name', u.full_name, 'phone', v_phone, 'code', v_code);
end;
$$;

-- (anon) confirma o código e troca o número.
create function public.app_phone_change_confirm(p_token text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_active_user(p_token);
  r public.phone_changes;
  v_msg constant text := 'Código inválido ou expirado. Peça um novo código.';
begin
  select * into r from public.phone_changes where user_id = u.id;
  if not found or r.expires_at < now() or r.attempts >= 5 then return json_build_object('error', v_msg); end if;
  if r.code_hash <> public._code_hash(u.id, p_code) then
    update public.phone_changes set attempts = attempts + 1 where user_id = u.id;
    return json_build_object('error', v_msg);
  end if;
  update public.app_users set phone = r.new_phone, phone_verified_at = now() where id = u.id returning * into u;
  delete from public.phone_changes where user_id = u.id;
  return json_build_object('ok', true, 'user', public._app_user_json(u));
end;
$$;

-- ───────────── Troca de perfil (tutor) ─────────────
create function public.app_set_role(p_token text, p_user_id uuid, p_role text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.app_users := public._app_active_user(p_token);
  t public.app_users;
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores alteram perfis.' using errcode = '42501'; end if;
  if p_role not in ('student', 'teacher') then raise exception 'Perfil inválido.'; end if;
  if p_user_id = me.id then raise exception 'Você não pode alterar o seu próprio perfil.'; end if;
  update public.app_users set role = p_role where id = p_user_id returning * into t;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  return public._app_user_json(t);
end;
$$;

-- ───────────── Convites com perfil (aluno ou tutor) ─────────────
alter table public.student_invites add column role text not null default 'student' check (role in ('student', 'teacher'));

drop function public.app_invite_issue(text, text, text, text);
create function public.app_invite_issue(p_token text, p_name text, p_email text, p_phone text, p_role text default 'student')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.app_users;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := public._normalize_phone(p_phone);
  v_raw text := encode(gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  begin me := public._app_user(p_token); exception when others then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end;
  if me.role <> 'teacher' or me.phone_verified_at is null then
    raise exception 'Apenas tutores podem enviar convites.' using errcode = '42501';
  end if;
  if p_role not in ('student', 'teacher') then raise exception 'Perfil inválido.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Informe um e-mail válido.'; end if;
  if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Informe o nome (2 a 100 caracteres).'; end if;
  if v_phone is null then raise exception 'Informe um WhatsApp válido no formato (99) 99999-9999.'; end if;
  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'Este e-mail já tem conta no app.';
  end if;
  if (select count(*) from public.student_invites where created_by = me.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Limite de 30 convites por hora atingido. Tente mais tarde.';
  end if;

  delete from public.student_invites where email = v_email and used_at is null;
  insert into public.student_invites (token_hash, email, full_name, phone, role, created_by, expires_at)
  values (encode(digest(v_raw, 'sha256'), 'hex'), v_email, v_name, v_phone, p_role, me.id, now() + interval '7 days')
  returning id into v_id;
  return json_build_object('id', v_id, 'invite', v_raw, 'name', v_name, 'phone', v_phone, 'role', p_role);
end;
$$;
revoke all on function public.app_invite_issue(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.app_invite_issue(text, text, text, text, text) to service_role;

create or replace function public.app_invite_info(p_invite text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare i public.student_invites;
begin
  select * into i from public.student_invites where token_hash = encode(digest(coalesce(p_invite, ''), 'sha256'), 'hex');
  if not found or i.used_at is not null or i.expires_at < now() then
    return json_build_object('error', 'Convite inválido ou expirado. Peça um novo convite ao seu tutor.');
  end if;
  return json_build_object('name', i.full_name, 'email', i.email, 'phone_hint', right(i.phone, 4), 'role', i.role);
end;
$$;

create or replace function public.app_invite_accept(p_invite text, p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  i public.student_invites;
  u public.app_users;
begin
  if p_password is null or length(p_password) < 8 then raise exception 'A senha deve ter pelo menos 8 caracteres.'; end if;
  if octet_length(p_password) > 72 then raise exception 'A senha deve ter no máximo 72 caracteres.'; end if;
  select * into i from public.student_invites
   where token_hash = encode(digest(coalesce(p_invite, ''), 'sha256'), 'hex') for update;
  if not found or i.used_at is not null or i.expires_at < now() then
    raise exception 'Convite inválido ou expirado. Peça um novo convite ao seu tutor.';
  end if;
  if exists (select 1 from public.app_users where email = i.email) then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end if;
  insert into public.app_users (email, full_name, password_hash, role, phone, phone_verified_at)
  values (i.email, i.full_name, crypt(p_password, gen_salt('bf', 10)), i.role, i.phone, now())
  returning * into u;
  update public.student_invites set used_at = now(), used_by = u.id where id = i.id;
  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

create or replace function public.app_invite_list(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.app_users := public._app_active_user(p_token);
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores veem os convites.' using errcode = '42501'; end if;
  return (select coalesce(json_agg(json_build_object(
            'id', i.id, 'full_name', i.full_name, 'email', i.email, 'phone_hint', right(i.phone, 4), 'role', i.role,
            'created_at', i.created_at, 'expires_at', i.expires_at, 'used_at', i.used_at,
            'status', case when i.used_at is not null then 'used' when i.expires_at < now() then 'expired' else 'pending' end)
          order by i.created_at desc), '[]')
          from (select * from public.student_invites order by created_at desc limit 200) i);
end;
$$;

-- ───────────── Permissões ─────────────
revoke all on function public.app_profile_update(text, text, text, text), public.app_change_password(text, text, text),
  public.app_phone_change_confirm(text, text), public.app_set_role(text, uuid, text) from public;
grant execute on function public.app_profile_update(text, text, text, text), public.app_change_password(text, text, text),
  public.app_phone_change_confirm(text, text), public.app_set_role(text, uuid, text) to anon;
revoke all on function public.app_phone_change_issue(text, text, text) from public, anon, authenticated;
grant execute on function public.app_phone_change_issue(text, text, text) to service_role;
