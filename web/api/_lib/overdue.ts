// Alertas de atraso da entrega semanal: monta as mensagens de WhatsApp e coordena a rodada diária.
// O banco decide QUEM é avisado (regras, pausa por aluno, intervalo entre avisos, notificações no app);
// aqui só se envia o WhatsApp e se registra o resultado. Sem dependências do Vercel, para testar em Node.

export interface OverdueItem { week: number; title: string; due_date: string; days_late: number; session_day: number }
export interface ClaimStudent { alert_id: string; student_id: string; name: string; phone: string | null; n: number; worst_days: number; first_day: number; items: OverdueItem[] }
export interface ClaimTutor { id: string; name: string; phone: string | null }
export interface Claim { skipped?: string; run_date?: string; students?: ClaimStudent[]; tutors?: ClaimTutor[]; paused_count?: number }

export interface Deps {
  rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<T>;
  send: (phone: string, text: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  appUrl: string;
  /** pausa entre mensagens, para não parecer disparo em massa no WhatsApp */
  gapMs?: number;
}

export interface Summary {
  skipped?: string;
  students_alerted: number;
  whatsapp_sent: number;
  whatsapp_failed: number;
  whatsapp_skipped: number;
  tutors_notified: number;
  paused_count: number;
}

const first = (full: string) => full.trim().split(/\s+/)[0] || 'aluno';
export const dateBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const days = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
const base = (u: string) => u.replace(/\/$/, '');

export function studentMessage(s: ClaimStudent, appUrl: string): string {
  const shown = s.items.slice(0, 3);
  const more = s.items.length - shown.length;
  return [
    `Olá, ${first(s.name)}! ⏰`,
    '',
    s.items.length === 1 ? 'Sua entrega semanal está em atraso:' : 'Suas entregas semanais estão em atraso:',
    ...shown.map((i) => `• *Semana ${i.week}* — ${i.title} (venceu em ${dateBR(i.due_date)} · ${days(i.days_late)} de atraso)`),
    ...(more > 0 ? [`• … e mais ${more}`] : []),
    '',
    `Envie pelo app: ${base(appUrl)}/sessao/${s.first_day}?tab=exercicios`,
    'Se precisar de mais tempo, fale com o tutor.',
  ].join('\n');
}

export function tutorMessage(students: ClaimStudent[], paused: number, appUrl: string): string {
  const shown = students.slice(0, 15);
  return [
    '📋 *DAFA — entregas semanais em atraso*',
    `Avisamos hoje ${students.length} ${students.length === 1 ? 'aluno' : 'alunos'}:`,
    ...shown.map((s) => `• ${s.name} — Semana ${s.items[0]?.week} (${days(s.worst_days)})`),
    ...(students.length > shown.length ? [`• … e mais ${students.length - shown.length}`] : []),
    ...(paused > 0 ? ['', `(${paused} com alertas pausados)`] : []),
    '',
    `${base(appUrl)}/tutor/alunos`,
  ].join('\n');
}

export async function runOverdueAlerts(deps: Deps, force = false): Promise<Summary> {
  const gap = deps.gapMs ?? 800;
  const claim = await deps.rpc<Claim>('alerts_overdue_claim', { p_force: force });
  const out: Summary = { students_alerted: 0, whatsapp_sent: 0, whatsapp_failed: 0, whatsapp_skipped: 0, tutors_notified: 0, paused_count: claim.paused_count ?? 0 };
  if (claim.skipped) return { ...out, skipped: claim.skipped };
  const students = claim.students ?? [];
  out.students_alerted = students.length;

  let sentAny = false;
  const pause = async () => { if (sentAny) await deps.sleep(gap); sentAny = true; };
  const record = (id: string, status: 'sent' | 'failed' | 'skipped', error?: string) =>
    deps.rpc('alerts_overdue_result', { p_alert_id: id, p_status: status, p_error: error ?? null }).catch(() => undefined);

  for (const s of students) {
    if (!s.phone) { out.whatsapp_skipped += 1; await record(s.alert_id, 'skipped'); continue; }
    await pause();
    try { await deps.send(s.phone, studentMessage(s, deps.appUrl)); out.whatsapp_sent += 1; await record(s.alert_id, 'sent'); }
    catch (e) { out.whatsapp_failed += 1; await record(s.alert_id, 'failed', e instanceof Error ? e.message : String(e)); }
  }

  if (students.length > 0) {
    const text = tutorMessage(students, claim.paused_count ?? 0, deps.appUrl);
    for (const t of claim.tutors ?? []) {
      out.tutors_notified += 1;                       // a notificação no app já foi criada pelo banco
      if (!t.phone) continue;
      await pause();
      try { await deps.send(t.phone, text); } catch { /* o resumo no app já existe; o erro de WhatsApp do tutor não bloqueia a rodada */ }
    }
  }
  return out;
}
