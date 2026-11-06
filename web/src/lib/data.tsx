import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './supabase';
import { makeProgress, type Progress } from './progress';
import type { Data } from './types';
import { useAuth } from './auth';

interface Ctx { data: Data; progress: Progress; loading: boolean; error: string | null; reload: () => Promise<void> }
const DataCtx = createContext<Ctx | null>(null);
const EMPTY: Data = { levels: [], sessions: [], deps: [], exercises: [], templates: [], resources: [], sessionTemplates: [], sessionResources: [], weekly: [], submissions: [], reviews: [], profiles: [] };

export function DataProvider({ children }: { children: ReactNode }) {
  const { token, signOut } = useAuth();
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api<Data>('app_bootstrap', { p_token: token });
      setData({ ...EMPTY, ...d });
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Sessão (inválida|expirada)/.test(msg)) { void signOut(); return; }   // volta para o login
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [token, signOut]);

  useEffect(() => { if (token) void reload(); }, [token, reload]);
  const progress = useMemo(() => makeProgress(data), [data]);
  return <DataCtx.Provider value={{ data, progress, loading, error, reload }}>{children}</DataCtx.Provider>;
}

export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error('DataProvider ausente');
  return c;
}
