-- Agenda a correção automática por IA (job de correção).
-- Pré-requisitos: Edge Function `grade-submissions` publicada e segredos GEMINI_API_KEY e CRON_SECRET definidos
-- (ver docs/06-correcao-ia.md). Execute no SQL Editor, trocando <PROJECT_REF> e <CRON_SECRET>.
-- NÃO commite este arquivo com o segredo preenchido.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- UMA vez por dia, 08:00 em Brasília (11:00 UTC). Só entram as entregas que ainda estão na fila ('submitted') nesse
-- momento: o que o tutor já decidiu antes do job não é reprocessado. O job repete lotes até esvaziar a fila (limite de tempo).
select cron.schedule(
  'dafa-corrigir-entregas',
  '0 11 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/grade-submissions',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{"limit": 10}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Pausar:   select cron.unschedule('dafa-corrigir-entregas');
-- Histórico: select * from cron.job_run_details order by start_time desc limit 20;
