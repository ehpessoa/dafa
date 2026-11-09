import { useCallback, useEffect, useState } from 'react';
import { api } from './supabase';
import { useAuth } from './auth';

export interface OverdueWeek { week: number; title: string; due_date: string; days_late: number }
export interface OverdueEntry { student_id: string; weeks: OverdueWeek[] }

/** Entregas semanais em atraso por aluno (só tutores). Inclui alunos com alertas pausados. */
export function useOverdue() {
  const { token, isTeacher } = useAuth();
  const [map, setMap] = useState<Map<string, OverdueWeek[]>>(new Map());
  const load = useCallback(async () => {
    if (!isTeacher || !token) return;
    try {
      const list = await api<OverdueEntry[]>('app_overdue_overview', { p_token: token });
      setMap(new Map(list.map((x) => [x.student_id, x.weeks])));
    } catch { /* a tela funciona sem o painel de atrasos */ }
  }, [token, isTeacher]);
  useEffect(() => { void load(); }, [load]);
  return { overdue: map, reload: load };
}
