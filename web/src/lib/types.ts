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
export type SubStatus = 'submitted' | 'approved' | 'revision_requested';
export interface Submission { id: string; exercise_id: string; student_id: string; attempt: number; content: string | null; link_url: string | null; status: SubStatus; created_at: string }
export interface Review { id: string; submission_id: string; tutor_id: string; score: number; verdict: 'approved' | 'revision_requested'; feedback: string; created_at: string }

export interface Data {
  levels: Level[]; sessions: Session[]; deps: Dependency[]; exercises: Exercise[]; templates: Template[]; resources: Resource[];
  sessionTemplates: SessionTemplate[]; sessionResources: SessionResource[]; weekly: Weekly[];
  submissions: Submission[]; reviews: Review[]; profiles: Profile[];
}
