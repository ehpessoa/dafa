// Edge Function: correção automática de entregas com Gemini.
//
//   Manual    (tutor, pelo app):   POST {token, limit?, submission_ids?}      — o app já envia isso no botão "Corrigir com IA"
//   Agendado  (pg_cron / qualquer):  POST + header x-cron-secret: <CRON_SECRET>
//   Contagem:                        POST {token, action:"status"}  →  {pending}
//
// Deploy:  supabase functions deploy grade-submissions --no-verify-jwt
// Segredos: supabase secrets set GEMINI_API_KEY=… CRON_SECRET=… [GEMINI_MODEL=gemini-2.5-flash]
// (--no-verify-jwt porque o app não usa Supabase Auth; a função faz a própria autenticação: token de tutor ou segredo do agendador.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from '../_shared/handler.mjs';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

const db = {
  teacherId: (token: string) => rpc('ai_teacher_id', { p_token: token }),
  pendingCount: () => rpc('ai_pending_count'),
  claim: ({ limit, ids, trigger, runBy }: { limit: number; ids: string[] | null; trigger: string; runBy: string | null }) =>
    rpc('ai_claim', { p_limit: limit, p_submission_ids: ids, p_trigger: trigger, p_run_by: runBy }),
  fail: (id: string, msg: string) => rpc('ai_fail', { p_submission: id, p_error: msg }),
  apply: ({ submission, evaluation: e, feedback, model }: { submission: string; evaluation: any; feedback: string; model: string }) =>
    rpc('ai_apply', {
      p_submission: submission, p_score: e.score, p_criteria: e.criteria, p_summary: e.summary, p_strengths: e.strengths, p_gaps: e.gaps,
      p_sug_instructions: e.suggested_instructions, p_sug_examples: e.suggested_examples, p_evidence_sufficient: e.evidence_sufficient,
      p_confidence: e.confidence, p_manipulation: e.suspected_manipulation, p_feedback: feedback, p_model: model,
    }),
};

Deno.serve((req) => handleRequest(req, { env: Deno.env.toObject(), db, fetchImpl: fetch }));
