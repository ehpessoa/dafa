import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './supabase';
import type { Profile } from './types';

const TOKEN_KEY = 'dafa.token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage indisponível */ } };

interface Ctx {
  token: string | null; profile: Profile | null; loading: boolean; isTeacher: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, phone: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, password: string) => Promise<void>;
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
  const signUp = async (name: string, email: string, phone: string, password: string) => {
    const r = await api<AuthResult>('app_register', { p_name: name, p_email: email, p_password: password, p_phone: phone });
    accept(r);
    // Confirmação do cadastro por WhatsApp (feita pelo backend; falha aqui não impede o uso do app).
    fetch('/api/welcome', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: r.token }) }).catch(() => undefined);
  };
  /** Pede o código de redefinição; o backend envia por WhatsApp (resposta igual exista a conta ou não). */
  const requestPasswordReset = async (email: string) => {
    const res = await fetch('/api/reset-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await res.json().catch(() => ({} as { error?: string }));
    if (!res.ok) throw new Error(data.error ?? 'Não foi possível enviar o código agora.');
  };
  const confirmPasswordReset = async (email: string, code: string, password: string) => {
    const r = await api<{ ok?: boolean; error?: string }>('app_reset_confirm', { p_email: email, p_code: code, p_password: password });
    if (!r.ok) throw new Error(r.error ?? 'Não foi possível redefinir a senha.');
  };
  const signOut = async () => {
    const t = token;
    clear();
    if (t) { try { await api('app_logout', { p_token: t }); } catch { /* sessão já removida localmente */ } }
  };

  return <AuthCtx.Provider value={{ token, profile, loading, isTeacher: profile?.role === 'teacher', signIn, signUp, requestPasswordReset, confirmPasswordReset, signOut }}>{children}</AuthCtx.Provider>;
}
export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
