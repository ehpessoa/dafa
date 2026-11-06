import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
export const isConfigured = Boolean(SUPABASE_URL && KEY);

// Fluxo PKCE: o retorno do Google chega como ?code=... (compatível com BrowserRouter).
export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', KEY || 'public-anon-key', {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
