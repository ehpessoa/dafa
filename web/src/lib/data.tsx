import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { makeProgress, type Progress } from './progress';
import type { Data } from './types';
import { useAuth } from './auth';

interface Ctx { data: Data; progress: Progress; loading: boolean; error: string | null; reload: () => Promise<void> }
const DataCtx = createContext<Ctx | null>(null);
const EMPTY: Data = { levels: [], sessions: [], deps: [], exercises: [], templates: [], resources: [], sessionTemplates: [], sessionResources: [], weekly: [], submissions: [], reviews: [], profiles: [] };

const TABLES: [keyof Data, string, string?][] = [
  ['levels', 'levels', 'position'], ['sessions', 'sessions', 'day'], ['deps', 'session_dependencies'], ['exercises', 'exercises', 'position'],
  ['templates', 'templates', 'slug'], ['resources', 'resources', 'category'], ['sessionTemplates', 'session_templates', 'position'],
  ['sessionResources', 'session_resources', 'position'], ['weekly', 'weekly_deliverables', 'week'],
  ['submissions', 'submissions', 'created_at'], ['reviews', 'reviews', 'created_at'], ['profiles', 'profiles', 'created_at'],
];

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await Promise.all(TABLES.map(([, t, order]) => {
        const q = supabase.from(t).select('*');
        return order ? q.order(order) : q;
      }));
      const bad = res.find((r) => r.error);
      if (bad?.error) throw new Error(bad.error.message);
      const next = { ...EMPTY } as Record<string, unknown>;
      TABLES.forEach(([k], i) => { next[k] = res[i].data ?? []; });
      const d = next as unknown as Data;
      d.sessions.sort((a, b) => a.day - b.day);
      d.exercises.sort((a, b) => a.session_day - b.session_day || a.position - b.position);
      d.levels.sort((a, b) => a.position - b.position);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile) void reload(); }, [profile, reload]);
  const progress = useMemo(() => makeProgress(data), [data]);
  return <DataCtx.Provider value={{ data, progress, loading, error, reload }}>{children}</DataCtx.Provider>;
}

export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error('DataProvider ausente');
  return c;
}
