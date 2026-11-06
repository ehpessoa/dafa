import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

interface Ctx {
  session: AuthSession | null; profile: Profile | null; loading: boolean; error: string | null;
  isTeacher: boolean; signInWithGoogle: () => Promise<void>; signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: AuthSession | null) => {
    if (!s) { setProfile(null); return; }
    // O perfil é criado por trigger no primeiro login; tenta algumas vezes por segurança.
    for (let i = 0; i < 4; i++) {
      const { data, error: e } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
      if (e) { setError(e.message); return; }
      if (data) { setProfile(data as Profile); setError(null); return; }
      await new Promise((r) => setTimeout(r, 500));
    }
    setError('Perfil não encontrado. Tente sair e entrar novamente.');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); return loadProfile(data.session); }).finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      // fora do callback para evitar deadlock do cliente de auth
      setTimeout(() => { void loadProfile(s); }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signInWithGoogle = async () => {
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (e) setError(e.message);
  };
  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); };

  return (
    <AuthCtx.Provider value={{ session, profile, loading, error, isTeacher: profile?.role === 'teacher', signInWithGoogle, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}
export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
