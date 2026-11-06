-- ============================================================================
-- Editor SQL do app: o aluno digita uma consulta no navegador e o banco a executa
-- com os privilégios da role somente-leitura `aluno_leitura` (schema `treinamento`).
--
-- Camadas de proteção (nenhuma depende só da outra):
--   1. app_run_sql exige sessão válida do app (token) e valida o texto da consulta:
--      uma única instrução SELECT/WITH/VALUES/TABLE, sem ';' no meio, parênteses balanceados,
--      sem aspas abertas, sem $$ e sem funções que executam SQL dinâmico ou alteram a sessão.
--   2. A consulta roda em app_runner.run, função cujo DONO é `aluno_leitura`
--      (SECURITY DEFINER): o Postgres aplica os privilégios dessa role, que só tem SELECT em
--      `treinamento` e nenhum acesso às tabelas do app (app_users, app_sessions, ...).
--   3. O schema app_runner é fechado para anon/authenticated (a API não o alcança).
--   4. Limite de 500 linhas e de tamanho da resposta.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'aluno_leitura') then
    create role aluno_leitura nologin;
  end if;
end $$;

-- Para transferir a propriedade da função, quem executa a migration precisa poder assumir a role.
-- (Em superusuário não é necessário; em Supabase, `postgres` precisa ser membro.)
do $$ begin
  begin
    execute 'grant aluno_leitura to current_user';
  exception when others then
    raise notice 'grant aluno_leitura to current_user ignorado: %', sqlerrm;
  end;
end $$;

-- Garantia: a role não enxerga nada do schema public (tabelas do app).
revoke all on all tables in schema public from aluno_leitura;
revoke all on all functions in schema public from aluno_leitura;

create schema if not exists app_runner;
revoke all on schema app_runner from public, anon, authenticated;

-- ───────────── Executor (dono: aluno_leitura) ─────────────
create or replace function app_runner.run(p_sql text, p_limit int)
returns json language plpgsql security definer set search_path = treinamento, pg_catalog as $$
declare v json;
begin
  -- A quebra de linha antes do ")" evita que um comentário "--" no fim da consulta engula o fechamento.
  execute format('select coalesce(json_agg(r), ''[]''::json) from (select * from (%s
) r limit %s) r', p_sql, p_limit + 1) into v;
  return v;
end;
$$;

grant create on schema app_runner to aluno_leitura;
alter function app_runner.run(text, int) owner to aluno_leitura;
revoke create on schema app_runner from aluno_leitura;

-- ───────────── Validação do texto (retorna a mensagem de erro, ou null se estiver ok) ─────────────
create or replace function public._app_sql_check(p_sql text)
returns text language plpgsql immutable set search_path = pg_catalog as $$
declare
  v_skel text;   -- sem textos entre aspas, identificadores entre aspas e comentários
  v_ids  text;   -- como v_skel, mas mantendo o conteúdo dos identificadores "entre aspas"
  v_depth int := 0;
  ch text;
begin
  if p_sql is null or length(btrim(p_sql)) = 0 then return 'Escreva uma consulta.'; end if;
  if length(p_sql) > 20000 then return 'Consulta muito longa (máximo 20.000 caracteres).'; end if;

  -- (O regex do Postgres usa uma só preferência gulosa/preguiçosa para tudo; por isso o comentário
  -- de bloco é escrito sem quantificador preguiçoso.)
  -- Passagem única: o primeiro "token" que começa vence (texto, identificador ou comentário).
  v_skel := regexp_replace(p_sql, '''(?:[^'']|'''')*''|"(?:[^"]|"")*"|--[^\n]*|/\*(?:[^*]|\*+[^*/])*\*+/', ' ', 'g');
  v_ids  := regexp_replace(p_sql, '''(?:[^'']|'''')*''|"((?:[^"]|"")*)"|--[^\n]*|/\*(?:[^*]|\*+[^*/])*\*+/', ' \1 ', 'g');

  if v_skel ~ '[''"]' or position('/*' in v_skel) > 0 then
    return 'Há aspas ou comentário /* */ sem fechar.';
  end if;
  if position('$' in v_skel) > 0 then return 'O caractere $ não é permitido.'; end if;

  v_skel := regexp_replace(v_skel, '[\s;]+$', '');           -- um ";" no fim é tolerado
  if position(';' in v_skel) > 0 then
    return 'Execute uma consulta por vez (sem ";" no meio). Selecione o trecho e use Ctrl+Enter.';
  end if;
  if btrim(v_skel) = '' then return 'Escreva uma consulta (só há comentários).'; end if;
  if v_skel !~* '^\s*(select|with|values|table)\M' then
    return 'Apenas consultas de leitura (SELECT, WITH, VALUES ou TABLE) são permitidas.';
  end if;

  for i in 1 .. length(v_skel) loop
    ch := substr(v_skel, i, 1);
    if ch = '(' then v_depth := v_depth + 1;
    elsif ch = ')' then
      v_depth := v_depth - 1;
      if v_depth < 0 then return 'Parênteses desbalanceados.'; end if;
    end if;
  end loop;
  if v_depth <> 0 then return 'Parênteses desbalanceados.'; end if;

  if v_ids ~* '\m(into|set_config|current_setting|query_to_xml\w*|cursor_to_xml\w*|table_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|ts_stat|dblink\w*|pg_read_\w+|pg_ls_\w+|pg_stat_file|pg_sleep\w*|pg_notify|pg_terminate_backend|pg_cancel_backend|pg_advisory\w*|lo_\w+|lowrite|loread|nextval|setval|currval)\M' then
    return 'Esta consulta usa um recurso que não é permitido no editor (INTO, SET_CONFIG, QUERY_TO_XML, etc.).';
  end if;
  return null;
end;
$$;

-- ───────────── API (RPC) ─────────────
create or replace function public.app_run_sql(p_token text, p_sql text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  c_limit constant int := 500;
  u public.app_users := public._app_user(p_token);       -- exige sessão válida (erro 28000 se não)
  v_err text;
  v_sql text;
  v_rows json;
  v_n int;
  t0 timestamptz := clock_timestamp();
  v_ms int;
begin
  v_err := public._app_sql_check(p_sql);
  if v_err is not null then return json_build_object('error', v_err); end if;
  v_sql := regexp_replace(p_sql, '[\s;]+$', '');

  begin
    v_rows := app_runner.run(v_sql, c_limit);
  exception
    when query_canceled then
      return json_build_object('error', 'A consulta demorou demais e foi interrompida. Filtre mais ou use LIMIT.');
    when others then
      return json_build_object('error', sqlerrm, 'code', sqlstate);
  end;

  v_ms := (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  v_n := json_array_length(v_rows);
  if v_n > c_limit then
    select json_agg(e order by ord) into v_rows from json_array_elements(v_rows) with ordinality t(e, ord) where ord <= c_limit;
  end if;
  if length(v_rows::text) > 4000000 then
    return json_build_object('error', 'Resultado muito grande. Selecione menos colunas ou use LIMIT.');
  end if;
  return json_build_object(
    'columns', (select coalesce(json_agg(k), '[]'::json) from json_object_keys(coalesce(v_rows -> 0, '{}'::json)) k),
    'rows', v_rows, 'truncated', v_n > c_limit, 'limit', c_limit, 'ms', v_ms);
end;
$$;

-- Tabelas e colunas do schema treinamento (para o painel lateral do editor).
create or replace function public.app_sql_schema(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.app_users := public._app_user(p_token);
begin
  return (select coalesce(json_agg(json_build_object(
            'table', t.table_name,
            'columns', (select json_agg(json_build_object('name', c.column_name, 'type', c.data_type) order by c.ordinal_position)
                          from information_schema.columns c where c.table_schema = 'treinamento' and c.table_name = t.table_name))
          order by t.table_name), '[]'::json)
          from information_schema.tables t where t.table_schema = 'treinamento' and t.table_type = 'BASE TABLE');
end;
$$;

revoke all on function public._app_sql_check(text) from public, anon, authenticated;
revoke all on function public.app_run_sql(text, text) from public;
revoke all on function public.app_sql_schema(text) from public;
grant execute on function public.app_run_sql(text, text) to anon;     -- o app usa a chave anon (sem Supabase Auth)
grant execute on function public.app_sql_schema(text) to anon;
