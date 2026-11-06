-- ============================================================================
-- Verificação do WhatsApp no cadastro.
--
-- Conta nova nasce NÃO verificada: o app só libera currículo/entregas/avaliações depois que o
-- usuário digita o código de 6 dígitos enviado ao número informado (validade 15 min, 5 tentativas,
-- só o hash é guardado, 1 envio por minuto). Contas anteriores a esta migration ficam como verificadas.
-- O envio do código é feito pelo backend (service_role); a confirmação é pública (token + código).
-- ============================================================================
alter table public.app_users add column phone_verified_at timestamptz;
update public.app_users set phone_verified_at = created_at;      -- contas existentes (grandfathering)

create table public.phone_verifications (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from anon, authenticated;

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
revoke all on function public._app_active_user(text) from public, anon, authenticated;

-- Funções de dados passam a exigir conta verificada (troca _app_user → _app_active_user).
do $$
declare f text; d text;
begin
  foreach f in array array['app_bootstrap(text)', 'app_submit(text,text,text,text)', 'app_review(text,uuid,numeric,text,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('public._app_user(p_token)' in d) = 0 then raise exception 'função % sem _app_user', f; end if;
    execute replace(d, 'public._app_user(p_token)', 'public._app_active_user(p_token)');
  end loop;
end $$;

-- ───────────── Envio do código (somente service_role) ─────────────
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
  if found and r.created_at > now() - interval '60 seconds' then
    return json_build_object('throttled', true);
  end if;

  v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.phone_verifications (user_id, code_hash, attempts, created_at, expires_at)
  values (u.id, encode(digest(u.id::text || ':' || v_code, 'sha256'), 'hex'), 0, now(), now() + interval '15 minutes')
  on conflict (user_id) do update
     set code_hash = excluded.code_hash, attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return json_build_object('name', u.full_name, 'phone', u.phone, 'code', v_code);
end;
$$;

-- ───────────── Confirmação do código (anon, com o token da sessão) ─────────────
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
  if r.code_hash <> encode(digest(u.id::text || ':' || trim(coalesce(p_code, '')), 'sha256'), 'hex') then
    update public.phone_verifications set attempts = attempts + 1 where user_id = u.id;
    return json_build_object('error', v_msg);
  end if;
  update public.app_users set phone_verified_at = now() where id = u.id returning * into u;
  delete from public.phone_verifications where user_id = u.id;
  return json_build_object('ok', true, 'user', public._app_user_json(u));
end;
$$;

-- Corrigir o número digitado errado (só enquanto não verificado). Invalida o código anterior.
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

-- ───────────── Boas-vindas só após a verificação ─────────────
create or replace function public.app_welcome_claim(p_token text)
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

revoke all on function public.app_verify_issue(text) from public, anon, authenticated;
grant execute on function public.app_verify_issue(text) to service_role;
revoke all on function public.app_verify_confirm(text, text) from public;
revoke all on function public.app_change_phone(text, text) from public;
grant execute on function public.app_verify_confirm(text, text), public.app_change_phone(text, text) to anon;
