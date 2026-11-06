import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './supabase';
import type { Profile } from './types';

const TOKEN_KEY = 'dafa.token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage indisponível */ } };

interface Ctx {
  token: string | null; profile: Profile | null; loading: boolean; isTeacher: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, invite?: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

interface AuthResult { token?: string; user?: Profile; error?: string }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readToken);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(readToken()));

  const clear = useCallback(() => { writeToken(null); setToken(null); setProfile(null); }, []);

  // Restaura a sessão salva no navegador.
  useEffect(() => {
    const t = readToken();
    if (!t) { setLoading(false); return; }
    api<Profile | null>('app_me', { p_token: t })
      .then((me) => { if (me) { setToken(t); setProfile(me); } else clear(); })
      .catch(() => clear())
      .finally(() => setLoading(false));
  }, [clear]);

  const accept = (r: AuthResult) => {
    if (r.error || !r.token || !r.user) throw new Error(r.error ?? 'Não foi possível entrar.');
    writeToken(r.token); setToken(r.token); setProfile(r.user);
  };
  const signIn = async (email: string, password: string) => accept(await api<AuthResult>('app_login', { p_email: email, p_password: password }));
  const signUp = async (name: string, email: string, password: string, invite?: string) =>
    accept(await api<AuthResult>('app_register', { p_name: name, p_email: email, p_password: password, p_invite: invite || null }));
  const signOut = async () => {
    const t = token;
    clear();
    if (t) { try { await api('app_logout', { p_token: t }); } catch { /* sessão já removida localmente */ } }
  };

  return <AuthCtx.Provider value={{ token, profile, loading, isTeacher: profile?.role === 'teacher', signIn, signUp, signOut }}>{children}</AuthCtx.Provider>;
}
export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
