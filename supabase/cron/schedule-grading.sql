-- Agenda a correção automática por IA (job de correção).
--
-- Pré-requisitos: Edge Function `grade-submissions` publicada e segredos GEMINI_API_KEY e CRON_SECRET
-- definidos em Supabase → Edge Functions → Secrets (ver docs/06-correcao-ia.md).
--
-- O segredo do job fica no Vault do Supabase (não dentro do texto do job, nem no repositório):
--   1) Execute UMA vez, no SQL Editor, trocando pelo MESMO valor do CRON_SECRET da função:
--        select vault.create_secret('COLE_AQUI_O_MESMO_VALOR_DO_CRON_SECRET', 'dafa_cron_secret');
--      (para trocar depois: select vault.update_secret(id, 'novo valor') from vault.secrets where name = 'dafa_cron_secret';)
--   2) Execute o restante deste arquivo, trocando <PROJECT_REF> pela referência do projeto.
-- NÃO commite este arquivo com valores reais.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- UMA vez por dia, 08:00 em Brasília (11:00 UTC). Só entram as entregas que ainda estão na fila ('submitted') nesse
-- momento: o que o tutor já decidiu antes do job não é reprocessado. O job repete lotes até esvaziar a fila (limite de tempo).
select cron.unschedule(jobid) from cron.job where jobname = 'dafa-corrigir-entregas';
select cron.schedule(
  'dafa-corrigir-entregas',
  '0 11 * * *',
  $job$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/grade-submissions',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dafa_cron_secret')),
    body    := '{"limit": 10}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);

-- Pausar:    select cron.unschedule('dafa-corrigir-entregas');
-- Histórico: select * from cron.job_run_details order by start_time desc limit 20;
-- Respostas: select id, status_code, content from net._http_response order by created desc limit 5;
