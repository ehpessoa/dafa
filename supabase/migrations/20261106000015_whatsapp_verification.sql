-- ============================================================================
-- WhatsApp no cadastro, verificação do número e recuperação de senha por código.
-- ADITIVA: mantém o código de convite e a redefinição assistida pelo tutor (migrations 006/007).
--
--   - app_users.phone (somente dígitos, DDI 55), phone_verified_at, welcome_sent_at
--   - Conta nova nasce NÃO verificada: o servidor só libera currículo/entregas/avaliações depois
--     que o usuário confirma o código de 6 dígitos enviado ao número (15 min, 5 tentativas, hash, 1/min).
--   - Contas existentes ficam como verificadas (sem telefone; a recuperação por WhatsApp não vale para elas).
--   - Recuperação por WhatsApp: tabela própria (whatsapp_resets); só para contas com número verificado.
--   - O ENVIO é feito pelo backend (web/api, Vercel). Funções com telefone/código: só service_role.
-- ============================================================================

alter table public.app_users
  add column phone text check (phone is null or phone ~ '^55[0-9]{10,11}$'),
  add column phone_verified_at timestamptz,
  add column welcome_sent_at timestamptz;
update public.app_users set phone_verified_at = created_at;      -- contas existentes (grandfathering)
comment on column public.app_users.phone is 'WhatsApp do usuário: só dígitos com DDI (55 + DDD + número).';

create table public.phone_verifications (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table public.whatsapp_resets (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.phone_verifications enable row level security;
alter table public.whatsapp_resets enable row level security;
revoke all on public.phone_verifications, public.whatsapp_resets from public, anon, authenticated;

-- ───────────── Auxiliares (internas) ─────────────
create function public._normalize_phone(p text)
returns text language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) in (10, 11) then d := '55' || d; end if;
  if d !~ '^55[0-9]{10,11}$' then return null; end if;
  return d;
end;
$$;

-- Código numérico de 6 dígitos.
create function public._code6()
returns text language sql volatile set search_path = public, extensions as $$
  select lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
$$;
create function public._code_hash(p_user uuid, p_code text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(p_user::text || ':' || trim(coalesce(p_code, '')), 'sha256'), 'hex');
$$;

-- Perfil devolvido ao app: inclui se o WhatsApp foi verificado e os 4 últimos dígitos (para exibir).
create or replace function public._app_user_json(u public.app_users)
returns json language sql immutable set search_path = public as $$
  select json_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name, 'avatar_url', null,
                           'role', u.role, 'created_at', u.created_at,
                           'phone_verified', u.phone_verified_at is not null,
                           'phone_hint', case when u.phone is null then null else right(u.phone, 4) end);
$$;

-- Usuário com sessão válida E WhatsApp verificado.
create function public._app_active_user(p_token text)
returns public.app_users language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_user(p_token);
begin
  if u.phone_verified_at is null then
    raise exception 'Confirme seu WhatsApp para continuar.' using errcode = '42501';
  end if;
  return u;
end;
$$;

-- As funções de dados passam a exigir conta verificada (troca _app_user → _app_active_user).
do $$
declare f text; d text;
begin
  foreach f in array array['app_bootstrap(text)', 'app_submit(text,text,text,text)', 'app_review(text,uuid,numeric,text,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('public._app_user(p_token)' in d) = 0 then raise exception 'função % sem _app_user(p_token)', f; end if;
    execute replace(d, 'public._app_user(p_token)', 'public._app_active_user(p_token)');
  end loop;
end $$;

-- ───────────── Cadastro: WhatsApp obrigatório (convite e limite de tentativas preservados) ─────────────
drop function public.app_register(text, text, text, text);
create function public.app_register(p_email text, p_password text, p_name text, p_invite text default null, p_phone text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := public._normalize_phone(p_phone);
  v_mode text := coalesce((select value from public.app_settings where key = 'signup_mode'), 'invite');
  v_hash text := (select value from public.app_settings where key = 'invite_code_hash');
  v_tutor boolean;
  u public.app_users;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Informe um e-mail válido.';
  end if;
  if length(v_name) < 2 or length(v_name) > 100 then
    raise exception 'Informe seu nome (2 a 100 caracteres).';
  end if;
  if v_phone is null then
    raise exception 'Informe um WhatsApp válido no formato (99) 99999-9999.';
  end if;
  if p_password is null or length(p_password) < 8 then
    raise exception 'A senha deve ter pelo menos 8 caracteres.';
  end if;
  if octet_length(p_password) > 72 then
    raise exception 'A senha deve ter no máximo 72 caracteres.';
  end if;

  v_tutor := exists (select 1 from public.teacher_allowlist t where lower(t.email) = v_email);
  if not v_tutor then
    if v_mode = 'closed' then
      raise exception 'O cadastro está fechado. Fale com a coordenação do programa.';
    elsif v_mode = 'invite' then
      delete from public.signup_failures where at < now() - interval '1 day';
      if (select count(*) from public.signup_failures where at > now() - interval '15 minutes') >= 20 then
        return json_build_object('error', 'Muitas tentativas de código incorretas. Aguarde alguns minutos e tente de novo.');
      end if;
      if v_hash is null or public._invite_hash(p_invite) <> v_hash then
        insert into public.signup_failures default values;
        return json_build_object('error', 'Código de convite inválido. Peça o código à coordenação do programa.');
      end if;
    end if;
  end if;

  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end if;

  begin
    insert into public.app_users (email, full_name, password_hash, role, phone)
    values (v_email, v_name, crypt(p_password, gen_salt('bf', 10)), case when v_tutor then 'teacher' else 'student' end, v_phone)
    returning * into u;
  exception when unique_violation then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end;

  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

-- ───────────── Verificação do número ─────────────
-- Gera o código (somente service_role). Retorna null se a sessão for inválida ou o número já estiver verificado.
create function public.app_verify_issue(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  r public.phone_verifications;
  v_code text;
begin
  begin u := public._app_user(p_token); exception when others then return null; end;
  if u.phone is null or u.phone_verified_at is not null then return null; end if;
  select * into r from public.phone_verifications where user_id = u.id;
  if found and r.created_at > now() - interval '60 seconds' then return json_build_object('throttled', true); end if;

  v_code := public._code6();
  insert into public.phone_verifications (user_id, code_hash, attempts, created_at, expires_at)
  values (u.id, public._code_hash(u.id, v_code), 0, now(), now() + interval '15 minutes')
  on conflict (user_id) do update
     set code_hash = excluded.code_hash, attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return json_build_object('name', u.full_name, 'phone', u.phone, 'code', v_code);
end;
$$;

-- Confirma o código (anon, com o token da sessão). Erros voltam como {error} para gravar as tentativas.
create function public.app_verify_confirm(p_token text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  r public.phone_verifications;
  v_msg constant text := 'Código inválido ou expirado. Peça um novo código.';
begin
  begin u := public._app_user(p_token); exception when others then
    return json_build_object('error', 'Sessão expirada. Entre novamente.');
  end;
  if u.phone_verified_at is not null then return json_build_object('ok', true, 'user', public._app_user_json(u)); end if;
  select * into r from public.phone_verifications where user_id = u.id;
  if not found or r.expires_at < now() or r.attempts >= 5 then return json_build_object('error', v_msg); end if;
  if r.code_hash <> public._code_hash(u.id, p_code) then
    update public.phone_verifications set attempts = attempts + 1 where user_id = u.id;
    return json_build_object('error', v_msg);
  end if;
  update public.app_users set phone_verified_at = now() where id = u.id returning * into u;
  delete from public.phone_verifications where user_id = u.id;
  return json_build_object('ok', true, 'user', public._app_user_json(u));
end;
$$;

-- Corrige o número digitado errado (só enquanto não verificado). Invalida o código anterior.
create function public.app_change_phone(p_token text, p_phone text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users := public._app_user(p_token);
  v_phone text := public._normalize_phone(p_phone);
begin
  if u.phone_verified_at is not null then raise exception 'O WhatsApp já foi verificado.'; end if;
  if v_phone is null then raise exception 'Informe um WhatsApp válido no formato (99) 99999-9999.'; end if;
  update public.app_users set phone = v_phone where id = u.id returning * into u;
  delete from public.phone_verifications where user_id = u.id;
  return public._app_user_json(u);
end;
$$;

-- ───────────── Boas-vindas (service_role): só depois de verificar, uma única vez ─────────────
create function public.app_welcome_claim(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  begin u := public._app_user(p_token); exception when others then return null; end;
  if u.phone is null or u.phone_verified_at is null then return null; end if;
  update public.app_users set welcome_sent_at = now()
   where id = u.id and welcome_sent_at is null returning * into u;
  if not found then return null; end if;
  return json_build_object('user_id', u.id, 'name', u.full_name, 'email', u.email, 'phone', u.phone);
end;
$$;
create function public.app_welcome_release(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.app_users set welcome_sent_at = null where id = p_user;
$$;

-- ───────────── Recuperação de senha por WhatsApp ─────────────
-- Gera o código (service_role). Retorna null se não houver conta com WhatsApp verificado
-- (o backend responde sempre igual, para não revelar quais e-mails existem).
create function public.app_wa_reset_issue(p_email text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  r public.whatsapp_resets;
  v_code text;
begin
  select * into u from public.app_users where email = lower(trim(coalesce(p_email, '')));
  if not found or u.phone is null or u.phone_verified_at is null then return null; end if;
  select * into r from public.whatsapp_resets where user_id = u.id;
  if found and r.created_at > now() - interval '60 seconds' then return json_build_object('throttled', true); end if;

  v_code := public._code6();
  insert into public.whatsapp_resets (user_id, code_hash, attempts, created_at, expires_at)
  values (u.id, public._code_hash(u.id, v_code), 0, now(), now() + interval '15 minutes')
  on conflict (user_id) do update
     set code_hash = excluded.code_hash, attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return json_build_object('name', u.full_name, 'phone', u.phone, 'code', v_code);
end;
$$;

-- Confirma o código e define a nova senha (anon). Encerra as sessões antigas.
create function public.app_wa_reset_confirm(p_email text, p_code text, p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  r public.whatsapp_resets;
  v_msg constant text := 'Código inválido ou expirado. Solicite um novo.';
begin
  if p_password is null or length(p_password) < 8 then
    return json_build_object('error', 'A senha deve ter pelo menos 8 caracteres.');
  end if;
  if octet_length(p_password) > 72 then
    return json_build_object('error', 'A senha deve ter no máximo 72 caracteres.');
  end if;
  select * into u from public.app_users where email = lower(trim(coalesce(p_email, '')));
  if not found then return json_build_object('error', v_msg); end if;
  select * into r from public.whatsapp_resets where user_id = u.id;
  if not found or r.expires_at < now() or r.attempts >= 5 then return json_build_object('error', v_msg); end if;
  if r.code_hash <> public._code_hash(u.id, p_code) then
    update public.whatsapp_resets set attempts = attempts + 1 where user_id = u.id;
    return json_build_object('error', v_msg);
  end if;
  update public.app_users
     set password_hash = crypt(p_password, gen_salt('bf', 10)), failed_attempts = 0, locked_until = null
   where id = u.id;
  delete from public.whatsapp_resets where user_id = u.id;
  delete from public.app_sessions where user_id = u.id;
  return json_build_object('ok', true);
end;
$$;

-- ───────────── Permissões ─────────────
revoke all on function public._normalize_phone(text), public._code6(), public._code_hash(uuid, text), public._app_active_user(text)
  from public, anon, authenticated;
revoke all on function public.app_register(text, text, text, text, text), public.app_verify_confirm(text, text),
  public.app_change_phone(text, text), public.app_wa_reset_confirm(text, text, text) from public;
grant execute on function public.app_register(text, text, text, text, text), public.app_verify_confirm(text, text),
  public.app_change_phone(text, text), public.app_wa_reset_confirm(text, text, text) to anon;
revoke all on function public.app_verify_issue(text), public.app_welcome_claim(text), public.app_welcome_release(uuid),
  public.app_wa_reset_issue(text) from public, anon, authenticated;
grant execute on function public.app_verify_issue(text), public.app_welcome_claim(text), public.app_welcome_release(uuid),
  public.app_wa_reset_issue(text) to service_role;
