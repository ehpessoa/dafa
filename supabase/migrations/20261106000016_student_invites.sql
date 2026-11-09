-- ============================================================================
-- Convites personalizados: o tutor informa nome, e-mail e WhatsApp do aluno; o servidor envia por
-- WhatsApp um link com token único. O aluno abre o link, define a senha e a conta é criada já
-- verificada (receber o link no WhatsApp comprova o número). Dispensa o código de convite geral
-- e vale mesmo com o cadastro fechado.
--
--   - Token: 256 bits aleatórios; só o hash SHA-256 é guardado; vale 7 dias; uso único.
--   - Criar convite (app_invite_issue) é restrito à service_role: o token bruto nunca vai ao navegador.
--   - Listar/revogar: só tutores (token de sessão). Limite de 30 convites por tutor por hora.
-- ============================================================================
create table public.student_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null check (email = lower(email)),
  full_name text not null check (length(trim(full_name)) between 2 and 100),
  phone text not null check (phone ~ '^55[0-9]{10,11}$'),
  created_by uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.app_users (id) on delete set null
);
create index student_invites_email_idx on public.student_invites (email);
alter table public.student_invites enable row level security;
revoke all on public.student_invites from public, anon, authenticated;

-- Cria o convite (service_role). Substitui convites pendentes do mesmo e-mail.
create function public.app_invite_issue(p_token text, p_name text, p_email text, p_phone text)
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
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Informe um e-mail válido.'; end if;
  if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Informe o nome do aluno (2 a 100 caracteres).'; end if;
  if v_phone is null then raise exception 'Informe um WhatsApp válido no formato (99) 99999-9999.'; end if;
  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'Este e-mail já tem conta no app.';
  end if;
  if (select count(*) from public.student_invites where created_by = me.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Limite de 30 convites por hora atingido. Tente mais tarde.';
  end if;

  delete from public.student_invites where email = v_email and used_at is null;
  insert into public.student_invites (token_hash, email, full_name, phone, created_by, expires_at)
  values (encode(digest(v_raw, 'sha256'), 'hex'), v_email, v_name, v_phone, me.id, now() + interval '7 days')
  returning id into v_id;
  return json_build_object('id', v_id, 'invite', v_raw, 'name', v_name, 'phone', v_phone);
end;
$$;

-- Dados do convite para a tela do aluno (anon). Não revela mais que o necessário.
create function public.app_invite_info(p_invite text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare i public.student_invites;
begin
  select * into i from public.student_invites where token_hash = encode(digest(coalesce(p_invite, ''), 'sha256'), 'hex');
  if not found or i.used_at is not null or i.expires_at < now() then
    return json_build_object('error', 'Convite inválido ou expirado. Peça um novo convite ao seu tutor.');
  end if;
  return json_build_object('name', i.full_name, 'email', i.email, 'phone_hint', right(i.phone, 4));
end;
$$;

-- Aceita o convite: cria a conta de aluno (já verificada) e abre a sessão.
create function public.app_invite_accept(p_invite text, p_password text)
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
  values (i.email, i.full_name, crypt(p_password, gen_salt('bf', 10)), 'student', i.phone, now())
  returning * into u;
  update public.student_invites set used_at = now(), used_by = u.id where id = i.id;
  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

-- Lista os convites (tutor).
create function public.app_invite_list(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.app_users := public._app_active_user(p_token);
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores veem os convites.' using errcode = '42501'; end if;
  return (select coalesce(json_agg(json_build_object(
            'id', i.id, 'full_name', i.full_name, 'email', i.email, 'phone_hint', right(i.phone, 4),
            'created_at', i.created_at, 'expires_at', i.expires_at, 'used_at', i.used_at,
            'status', case when i.used_at is not null then 'used' when i.expires_at < now() then 'expired' else 'pending' end)
          order by i.created_at desc), '[]')
          from (select * from public.student_invites order by created_at desc limit 200) i);
end;
$$;

-- Revoga um convite pendente (tutor).
create function public.app_invite_revoke(p_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare me public.app_users := public._app_active_user(p_token);
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores revogam convites.' using errcode = '42501'; end if;
  delete from public.student_invites where id = p_id and used_at is null;
  return true;
end;
$$;

revoke all on function public.app_invite_issue(text, text, text, text) from public, anon, authenticated;
grant execute on function public.app_invite_issue(text, text, text, text) to service_role;
revoke all on function public.app_invite_info(text), public.app_invite_accept(text, text),
  public.app_invite_list(text), public.app_invite_revoke(text, uuid) from public;
grant execute on function public.app_invite_info(text), public.app_invite_accept(text, text),
  public.app_invite_list(text), public.app_invite_revoke(text, uuid) to anon;

-- Desfaz o convite quando o envio por WhatsApp falha (service_role).
create function public.app_invite_revoke_by_id(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.student_invites where id = p_id and used_at is null;
$$;
revoke all on function public.app_invite_revoke_by_id(uuid) from public, anon, authenticated;
grant execute on function public.app_invite_revoke_by_id(uuid) to service_role;
