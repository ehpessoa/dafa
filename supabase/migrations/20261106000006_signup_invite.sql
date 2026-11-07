-- Cadastro controlado: modo 'open' (qualquer pessoa), 'invite' (exige código de convite) ou 'closed' (só tutores da lista).
-- E-mails da teacher_allowlist sempre podem se cadastrar (tutores autorizados pela coordenação).
-- Padrão seguro: 'invite' sem código definido = ninguém (exceto tutores) se cadastra até a coordenação definir o código.
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;   -- sem políticas: inacessível pela API
revoke all on public.app_settings from public, anon, authenticated;
comment on table public.app_settings is 'Configurações do app (modo de cadastro, hash do código de convite). Acesso somente via funções.';
insert into public.app_settings (key, value) values ('signup_mode', 'invite') on conflict (key) do nothing;

-- Informa à tela de cadastro se deve pedir o código (não revela o código nem seu hash).
create or replace function public.app_signup_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('mode', coalesce((select value from public.app_settings where key = 'signup_mode'), 'invite'));
$$;

-- Normaliza o código (maiúsculas, sem espaços/hífens) para tolerar digitação.
create or replace function public._invite_hash(p_code text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'sha256'), 'hex');
$$;

-- Administração (SQL Editor): define o modo e, opcionalmente, o código de convite.
create or replace function public.admin_set_signup(p_mode text, p_code text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_mode not in ('open', 'invite', 'closed') then raise exception 'Modo inválido: use open, invite ou closed.'; end if;
  if p_code is not null and length(regexp_replace(p_code, '[\s-]', '', 'g')) < 8 then raise exception 'O código deve ter pelo menos 8 caracteres.'; end if;
  insert into public.app_settings (key, value) values ('signup_mode', p_mode)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_code is not null then
    insert into public.app_settings (key, value) values ('invite_code_hash', public._invite_hash(p_code))
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return 'cadastro: ' || p_mode;
end;
$$;
revoke all on function public.admin_set_signup(text, text) from public, anon, authenticated;
revoke all on function public._invite_hash(text) from public, anon, authenticated;

-- app_register passa a validar o convite (4º parâmetro opcional).
drop function if exists public.app_register(text, text, text);
create function public.app_register(p_email text, p_password text, p_name text, p_invite text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
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
    elsif v_mode = 'invite' and (v_hash is null or public._invite_hash(p_invite) <> v_hash) then
      raise exception 'Código de convite inválido. Peça o código à coordenação do programa.';
    end if;
  end if;

  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end if;

  begin
    insert into public.app_users (email, full_name, password_hash, role)
    values (v_email, v_name, crypt(p_password, gen_salt('bf', 10)), case when v_tutor then 'teacher' else 'student' end)
    returning * into u;
  exception when unique_violation then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end;

  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

revoke all on function public.app_register(text, text, text, text) from public;
revoke all on function public.app_signup_status() from public;
grant execute on function public.app_register(text, text, text, text) to anon;
grant execute on function public.app_signup_status() to anon;
