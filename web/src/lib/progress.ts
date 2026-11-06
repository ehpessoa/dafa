import type { Data, Review, Submission } from './types';

export type ExState = 'todo' | 'submitted' | 'revision' | 'approved';
export type SessState = 'locked' | 'available' | 'in_progress' | 'review' | 'done';

export const SESS_LABEL: Record<SessState, string> = {
  locked: 'Bloqueada', available: 'Disponível', in_progress: 'Em andamento', review: 'Aguardando tutor', done: 'Concluída',
};
export const EX_LABEL: Record<ExState, string> = {
  todo: 'A fazer', submitted: 'Aguardando avaliação', revision: 'Ajustes solicitados', approved: 'Aprovado',
};

export function makeProgress(d: Data) {
  const subs = new Map<string, Submission[]>();
  for (const s of d.submissions) {
    const k = `${s.student_id}|${s.exercise_id}`;
    const arr = subs.get(k);
    if (arr) arr.push(s); else subs.set(k, [s]);
  }
  for (const arr of subs.values()) arr.sort((a, b) => a.attempt - b.attempt);
  const reviewBySub = new Map<string, Review>(d.reviews.map((r) => [r.submission_id, r]));
  const exBySession = new Map<number, string[]>();
  for (const e of d.exercises) exBySession.set(e.session_day, [...(exBySession.get(e.session_day) ?? []), e.id]);
  const depsOf = new Map<number, number[]>();
  for (const x of d.deps) depsOf.set(x.day, [...(depsOf.get(x.day) ?? []), x.requires_day]);

  const attempts = (student: string, ex: string) => subs.get(`${student}|${ex}`) ?? [];
  const reviewOf = (subId: string) => reviewBySub.get(subId);

  function exState(student: string, ex: string): ExState {
    const a = attempts(student, ex);
    if (!a.length) return 'todo';
    if (a.some((s) => s.status === 'approved')) return 'approved';
    return a[a.length - 1].status === 'submitted' ? 'submitted' : 'revision';
  }
  const isDone = (student: string, day: number) => {
    const ids = exBySession.get(day) ?? [];
    return ids.length > 0 && ids.every((id) => exState(student, id) === 'approved');
  };
  const missingDeps = (student: string, day: number) => (depsOf.get(day) ?? []).filter((r) => !isDone(student, r));

  function sessState(student: string, day: number): SessState {
    if (missingDeps(student, day).length) return 'locked';
    if (isDone(student, day)) return 'done';
    const st = (exBySession.get(day) ?? []).map((id) => exState(student, id));
    if (st.includes('submitted')) return 'review';
    if (st.some((s) => s !== 'todo')) return 'in_progress';
    return 'available';
  }

  function summary(student: string) {
    const states = d.sessions.map((s) => sessState(student, s.day));
    const mySubs = d.submissions.filter((s) => s.student_id === student);
    const scores = mySubs.map((s) => reviewBySub.get(s.id)?.score).filter((x): x is number => x != null);
    const approvedEx = d.exercises.filter((e) => exState(student, e.id) === 'approved').length;
    return {
      doneSessions: states.filter((s) => s === 'done').length,
      totalSessions: d.sessions.length,
      approvedEx, totalEx: d.exercises.length,
      pct: d.exercises.length ? Math.round((approvedEx / d.exercises.length) * 100) : 0,
      pending: mySubs.filter((s) => s.status === 'submitted').length,
      revisions: d.exercises.filter((e) => exState(student, e.id) === 'revision').length,
      avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      attempts: mySubs.length,
      last: mySubs.length ? mySubs.map((s) => s.created_at).sort().at(-1)! : null,
      states,
    };
  }
  return { attempts, reviewOf, exState, sessState, isDone, missingDeps, summary, exBySession, depsOf };
}
export type Progress = ReturnType<typeof makeProgress>;

// Datas "puras" (YYYY-MM-DD) são tratadas ao meio-dia local para evitar deslocamento de fuso.
const isDateOnly = (iso: string) => /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z?)?$/.test(iso);
const toDate = (iso: string) => new Date(isDateOnly(iso) ? iso.slice(0, 10) + 'T12:00:00' : iso);
export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' }) => toDate(iso).toLocaleDateString('pt-BR', opts);
export const weekday = (iso: string) => toDate(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
export const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
