export type Role = 'student' | 'teacher';
export interface Profile { id: string; email: string; full_name: string | null; avatar_url: string | null; role: Role; created_at: string; phone_verified?: boolean; phone_hint?: string | null }
export interface Level { slug: string; position: number; title: string; emoji: string | null; color: string | null; objective: string | null; description: string | null }
export interface Scenario { area: string; text: string }
export interface Session {
  day: number; level_slug: string; title: string; why: string; learn: string[]; scenarios: Scenario[]; tools: string[];
  connection: string | null; minutes: number; scheduled_date: string; week: number;
}
export interface Dependency { day: number; requires_day: number }
export interface Exercise { id: string; session_day: number; position: number; title: string; instructions: string; deliverable: string }
export type TemplateKind = 'sql' | 'prompt' | 'diagram' | 'excel' | 'pbix' | 'checklist' | 'entrega';
export interface Template { slug: string; kind: TemplateKind; title: string; description: string | null; content: string | null; url: string | null; filename: string | null }
export interface Resource { slug: string; category: string; title: string; url: string; description: string | null }
export interface SessionTemplate { session_day: number; template_slug: string; position: number }
export interface SessionResource { session_day: number; resource_slug: string; position: number }
export interface Weekly { week: number; title: string; description: string; start_date: string; due_date: string; session_day: number }
export type SubStatus = 'submitted' | 'needs_review' | 'approved' | 'revision_requested' | 'rejected';
export type Verdict = 'approved' | 'revision_requested' | 'rejected';
export interface LinkCheck { ok: boolean; kind?: string | null; warning?: string | null; checked_at?: string }
export interface Submission { id: string; exercise_id: string; student_id: string; attempt: number; content: string | null; link_url: string | null; status: SubStatus; created_at: string; link_check?: LinkCheck | null; attachment_count?: number }
export interface SubFile { id: string; student_id: string; exercise_id: string; submission_id: string; name: string; mime: string | null; size_bytes: number; created_at: string }
export interface Review {
  id: string; submission_id: string; tutor_id: string | null; score: number; verdict: Verdict; feedback: string; created_at: string;
  source: 'tutor' | 'ai'; instructions: string | null; examples: string | null;
}
export type NotifKind = 'ai_approved' | 'in_review' | 'approved' | 'revision_requested' | 'rejected';
export interface Notification { id: string; user_id: string; kind: NotifKind; title: string; body: string; submission_id: string | null; created_at: string; read_at: string | null }
export interface RubricCheck { id: string; label: string; weight: number; dim: 'num' | 'neg' | 'tec' | 'vis' | 'rep' }
export interface Rubric { exercise_id: string; mode: 'text' | 'sql' | 'file' | 'mixed'; expected: string; checks: RubricCheck[]; grading_notes: string | null; force_tutor: boolean }
export interface AiCriterion extends RubricCheck { score: number; comment: string }
export interface AiEvaluation {
  submission_id: string; status: 'processing' | 'done' | 'error'; score: number | null; criteria: AiCriterion[] | null; summary: string | null;
  strengths: string[] | null; gaps: string[] | null; suggested_instructions: string | null; suggested_examples: string | null;
  evidence_sufficient: boolean | null; confidence: 'low' | 'medium' | 'high' | null; suspected_manipulation: boolean | null;
  attachments: { source: string; status: 'read' | 'failed' | 'ignored'; origin?: 'upload' | 'link'; kind?: string; detail?: string; truncated?: boolean }[] | null; requires_tutor: boolean | null;
  outcome: 'auto_approved' | 'sent_to_tutor' | 'discarded' | null; outcome_reason: string | null; model: string | null; error: string | null; finished_at: string | null;
}

export interface Data {
  levels: Level[]; sessions: Session[]; deps: Dependency[]; exercises: Exercise[]; templates: Template[]; resources: Resource[];
  sessionTemplates: SessionTemplate[]; sessionResources: SessionResource[]; weekly: Weekly[];
  submissions: Submission[]; reviews: Review[]; profiles: Profile[];
  notifications: Notification[]; files: SubFile[]; rubrics: Rubric[]; aiEvaluations: AiEvaluation[];
}
