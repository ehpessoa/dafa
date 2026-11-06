import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './supabase';
import type { Profile } from './types';

const TOKEN_KEY = 'dafa.token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage indisponível */ } };

interface Ctx {
  token: string | null; profile: Profile | null; loading: boolean; isTeacher: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, invite: string | undefined, phone: string) => Promise<void>;
  sendVerificationCode: () => Promise<void>;
  confirmVerification: (code: string) => Promise<void>;
  changePhone: (phone: string) => Promise<void>;
  acceptInvite: (invite: string, password: string) => Promise<void>;
  requestWhatsAppReset: (email: string) => Promise<void>;
  confirmWhatsAppReset: (email: string, code: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

/** POST JSON para as funções do servidor (/api/*); lança Error com a mensagem devolvida. */
async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Não foi possível concluir agora. Tente novamente.');
}

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
  const signUp = async (name: string, email: string, password: string, invite: string | undefined, phone: string) => {
    const r = await api<AuthResult>('app_register', { p_name: name, p_email: email, p_password: password, p_invite: invite || null, p_phone: phone });
    accept(r);
    // Envia o código de verificação do WhatsApp; se falhar, a tela de verificação oferece "Reenviar código".
    post('/api/verify-send', { token: r.token }).catch(() => undefined);
  };
  /** Aluno abre o link do convite, define a senha e a conta é criada já verificada. */
  const acceptInvite = async (invite: string, password: string) => {
    const r = await api<AuthResult>('app_invite_accept', { p_invite: invite, p_password: password });
    accept(r);
    post('/api/welcome', { token: r.token }).catch(() => undefined);
  };
  const sendVerificationCode = async () => { await post('/api/verify-send', { token }); };
  const confirmVerification = async (code: string) => {
    const r = await api<{ ok?: boolean; error?: string; user?: Profile }>('app_verify_confirm', { p_token: token, p_code: code });
    if (!r.ok || !r.user) throw new Error(r.error ?? 'Não foi possível verificar o código.');
    setProfile(r.user);
    // Confirmação do cadastro por WhatsApp (uma única vez; falha aqui não impede o uso do app).
    post('/api/welcome', { token }).catch(() => undefined);
  };
  const changePhone = async (phone: string) => { setProfile(await api<Profile>('app_change_phone', { p_token: token, p_phone: phone })); };
  /** Pede o código de redefinição; o backend envia por WhatsApp (resposta igual exista a conta ou não). */
  const requestWhatsAppReset = async (email: string) => { await post('/api/reset-request', { email }); };
  const confirmWhatsAppReset = async (email: string, code: string, password: string) => {
    const r = await api<{ ok?: boolean; error?: string }>('app_wa_reset_confirm', { p_email: email, p_code: code, p_password: password });
    if (!r.ok) throw new Error(r.error ?? 'Não foi possível redefinir a senha.');
  };
  const signOut = async () => {
    const t = token;
    clear();
    if (t) { try { await api('app_logout', { p_token: t }); } catch { /* sessão já removida localmente */ } }
  };

  return <AuthCtx.Provider value={{ token, profile, loading, isTeacher: profile?.role === 'teacher', signIn, signUp, acceptInvite, sendVerificationCode, confirmVerification, changePhone, requestWhatsAppReset, confirmWhatsAppReset, signOut }}>{children}</AuthCtx.Provider>;
}
export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
