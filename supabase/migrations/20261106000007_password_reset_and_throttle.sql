-- 1) Redefinição de senha assistida pelo tutor (sem e-mail): o tutor gera um código de uso único e o aluno define a nova senha.
-- 2) Limite de tentativas de código de convite (proteção contra adivinhação).

-- ── Redefinição de senha ──
create table if not exists public.password_resets (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_attempts int not null default 0,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from public, anon, authenticated;

create or replace function public._reset_hash(p_code text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'sha256'), 'hex');
$$;
revoke all on function public._reset_hash(text) from public, anon, authenticated;

-- Tutor gera o código (válido por 1 hora) para um ALUNO. Tutores não redefinem senha de outros tutores.
create or replace function public.app_teacher_reset_code(p_token text, p_student_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.app_users := public._app_user(p_token);
  s public.app_users;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw text := '';
  i int;
  v_exp timestamptz := now() + interval '1 hour';
begin
  if me.role <> 'teacher' then raise exception 'Apenas tutores podem gerar códigos de redefinição.'; end if;
  select * into s from public.app_users where id = p_student_id;
  if not found or s.role <> 'student' then raise exception 'Aluno não encontrado.'; end if;
  for i in 1..8 loop
    raw := raw || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
  end loop;
  insert into public.password_resets (user_id, code_hash, expires_at, failed_attempts, created_by)
  values (s.id, public._reset_hash(raw), v_exp, 0, me.id)
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, failed_attempts = 0, created_by = excluded.created_by, created_at = now();
  return json_build_object('code', substr(raw, 1, 4) || '-' || substr(raw, 5, 4), 'expires_at', v_exp, 'student', s.full_name);
end;
$$;

-- Aluno informa e-mail + código + nova senha. Erros voltam como {error} para que o contador de tentativas seja gravado.
create or replace function public.app_reset_password(p_email text, p_code text, p_new_password text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  u public.app_users;
  r public.password_resets;
  v_msg constant text := 'Código inválido ou expirado. Peça um novo código ao tutor.';
begin
  if p_new_password is null or length(p_new_password) < 8 then
    return json_build_object('error', 'A senha deve ter pelo menos 8 caracteres.');
  end if;
  if octet_length(p_new_password) > 72 then
    return json_build_object('error', 'A senha deve ter no máximo 72 caracteres.');
  end if;
  select * into u from public.app_users where email = v_email and role = 'student';
  if not found then return json_build_object('error', v_msg); end if;
  select * into r from public.password_resets where user_id = u.id;
  if not found or r.expires_at < now() then
    delete from public.password_resets where user_id = u.id;
    return json_build_object('error', v_msg);
  end if;
  if r.code_hash <> public._reset_hash(p_code) then
    if r.failed_attempts + 1 >= 5 then delete from public.password_resets where user_id = u.id;   -- queima o código após 5 erros
    else update public.password_resets set failed_attempts = failed_attempts + 1 where user_id = u.id; end if;
    return json_build_object('error', v_msg);
  end if;
  update public.app_users
     set password_hash = crypt(p_new_password, gen_salt('bf', 10)), failed_attempts = 0, locked_until = null
   where id = u.id;
  delete from public.password_resets where user_id = u.id;
  delete from public.app_sessions where user_id = u.id;   -- encerra sessões antigas
  return json_build_object('ok', true);
end;
$$;

-- ── Limite de tentativas de convite ──
create table if not exists public.signup_failures (id bigserial primary key, at timestamptz not null default now());
alter table public.signup_failures enable row level security;
revoke all on public.signup_failures from public, anon, authenticated;

-- app_register: convite inválido/limite excedido voltam como {error} (para gravar a tentativa); demais erros seguem como exceção.
create or replace function public.app_register(p_email text, p_password text, p_name text, p_invite text default null)
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
    insert into public.app_users (email, full_name, password_hash, role)
    values (v_email, v_name, crypt(p_password, gen_salt('bf', 10)), case when v_tutor then 'teacher' else 'student' end)
    returning * into u;
  exception when unique_violation then
    raise exception 'Este e-mail já está cadastrado. Use "Entrar".';
  end;

  return json_build_object('token', public._app_new_session(u.id), 'user', public._app_user_json(u));
end;
$$;

revoke all on function public.app_teacher_reset_code(text, uuid) from public;
revoke all on function public.app_reset_password(text, text, text) from public;
grant execute on function public.app_teacher_reset_code(text, uuid) to anon;   -- o app usa a chave anon; a função valida o token e o perfil
grant execute on function public.app_reset_password(text, text, text) to anon;
