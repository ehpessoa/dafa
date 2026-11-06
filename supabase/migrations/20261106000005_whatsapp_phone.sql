-- ============================================================================
-- WhatsApp no cadastro + recuperação de senha por código.
--
--   - app_users.phone: número do WhatsApp (somente dígitos, com DDI 55). Obrigatório no
--     cadastro; contas antigas ficam sem número (e sem recuperação por WhatsApp).
--   - Mensagem de boas-vindas: enviada pelo backend (web/api/welcome) após o cadastro.
--   - Recuperação: código de 6 dígitos, validade 15 min, 5 tentativas, guardado só como hash.
--
-- O ENVIO das mensagens é feito pelo backend (funções serverless na Vercel), nunca pelo navegador:
-- a apikey da Evolution API e a service_role ficam só no servidor. As funções que expõem dados
-- sensíveis (telefone, código) são executáveis APENAS pela service_role.
-- ============================================================================

alter table public.app_users
  add column phone text check (phone is null or phone ~ '^55[0-9]{10,11}$'),
  add column welcome_sent_at timestamptz;
comment on column public.app_users.phone is 'WhatsApp do usuário: só dígitos com DDI (55 + DDD + número).';

create table public.password_resets (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon, authenticated;

-- Normaliza telefone brasileiro: remove máscara e acrescenta 55 se vier só DDD+número.
create function public._normalize_phone(p text)
returns text language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) in (10, 11) then d := '55' || d; end if;
  if d !~ '^55[0-9]{10,11}$' then return null; end if;
  return d;
end;
$$;

-- ───────────── Cadastro (agora com WhatsApp) ─────────────
drop function public.app_register(text, text, text);
create function public.app_register(p_email text, p_password text, p_name text, p_phone text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := public._normalize_phone(p_phone);
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
  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end if;

  begin
    insert into public.app_users (email, full_name, password_hash, role, phone)
    values (v_email, v_name, crypt(p_password, gen_salt('bf', 10)),
            case when exists (select 1 from public.teacher_allowlist t where lower(t.email) = v_email)
                 then 'teacher' else 'student' end, v_phone)
    returning * into u;
  exception when unique_violation then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end;

  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

-- ───────────── Boas-vindas (somente service_role, chamada pelo backend) ─────────────
-- Valida o token de sessão e "reserva" o envio (uma única vez por usuário).
create function public.app_welcome_claim(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u public.app_users;
begin
  begin u := public._app_user(p_token); exception when others then return null; end;
  if u.phone is null then return null; end if;
  update public.app_users set welcome_sent_at = now()
   where id = u.id and welcome_sent_at is null returning * into u;
  if not found then return null; end if;
  return json_build_object('user_id', u.id, 'name', u.full_name, 'email', u.email, 'phone', u.phone);
end;
$$;

-- Se o envio falhar, devolve a reserva para permitir nova tentativa.
create function public.app_welcome_release(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.app_users set welcome_sent_at = null where id = p_user;
$$;

-- ───────────── Recuperação de senha ─────────────
-- Gera o código (somente service_role). Retorna null se não houver conta com WhatsApp
-- (o backend responde sempre igual, para não revelar quais e-mails existem).
create function public.app_reset_issue(p_email text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  r public.password_resets;
  v_code text;
begin
  select * into u from public.app_users where email = lower(trim(coalesce(p_email, '')));
  if not found or u.phone is null then return null; end if;

  select * into r from public.password_resets where user_id = u.id;
  if found and r.created_at > now() - interval '60 seconds' then
    return json_build_object('throttled', true);      -- no máx. 1 código por minuto
  end if;

  v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.password_resets (user_id, code_hash, attempts, created_at, expires_at)
  values (u.id, encode(digest(u.id::text || ':' || v_code, 'sha256'), 'hex'), 0, now(), now() + interval '15 minutes')
  on conflict (user_id) do update
     set code_hash = excluded.code_hash, attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return json_build_object('user_id', u.id, 'name', u.full_name, 'phone', u.phone, 'code', v_code);
end;
$$;

-- Confirma o código e define a nova senha (anon). Erros retornam {error} para gravar as tentativas.
create function public.app_reset_confirm(p_email text, p_code text, p_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  u public.app_users;
  r public.password_resets;
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
  select * into r from public.password_resets where user_id = u.id;
  if not found or r.expires_at < now() or r.attempts >= 5 then
    return json_build_object('error', v_msg);
  end if;
  if r.code_hash <> encode(digest(u.id::text || ':' || trim(coalesce(p_code, '')), 'sha256'), 'hex') then
    update public.password_resets set attempts = attempts + 1 where user_id = u.id;
    return json_build_object('error', v_msg);
  end if;

  update public.app_users
     set password_hash = crypt(p_password, gen_salt('bf', 10)), failed_attempts = 0, locked_until = null
   where id = u.id;
  delete from public.password_resets where user_id = u.id;
  delete from public.app_sessions where user_id = u.id;          -- encerra sessões antigas
  return json_build_object('ok', true);
end;
$$;

-- ───────────── Permissões ─────────────
revoke all on function public._normalize_phone(text) from public, anon, authenticated;
revoke all on function public.app_register(text, text, text, text) from public;
grant execute on function public.app_register(text, text, text, text) to anon;
revoke all on function public.app_reset_confirm(text, text, text) from public;
grant execute on function public.app_reset_confirm(text, text, text) to anon;

revoke all on function public.app_welcome_claim(text) from public, anon, authenticated;
revoke all on function public.app_welcome_release(uuid) from public, anon, authenticated;
revoke all on function public.app_reset_issue(text) from public, anon, authenticated;
grant execute on function public.app_welcome_claim(text), public.app_welcome_release(uuid), public.app_reset_issue(text) to service_role;
