import { isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { signInWithGoogle, error, loading } = useAuth();
  return (
    <div className="hero">
      <div className="left">
        <div className="brand" style={{ color: '#fff', padding: 0 }}><div className="logo" style={{ background: 'rgb(255 255 255 / .2)' }}>📊</div> DAFA</div>
        <h1>Análise de dados para quem decide.</h1>
        <p style={{ fontSize: '1.1rem', opacity: .9 }}>Programa de 30 dias úteis em 3 níveis — Excel, SQL, Power BI, Python e IA — com exercícios reais de comercial, finanças, logística, e-commerce, esporte e marketing.</p>
        <div className="steps">
          <div>🌱 <b>Iniciante</b> · Excel, SQL e primeiro relatório</div>
          <div>🚀 <b>Intermediário</b> · Modelagem, DAX e Python com IA</div>
          <div>🏆 <b>Avançado</b> · Segmentação, previsão e projeto final</div>
        </div>
        <p className="small" style={{ opacity: .8 }}>Cada entrega é avaliada por um tutor. Refaça quantas vezes precisar até dominar.</p>
      </div>
      <div className="right">
        <div className="card stack" style={{ maxWidth: 400, width: '100%' }}>
          <h2>Entrar na plataforma</h2>
          <p className="muted">Use sua conta Google (Gmail). Seu perfil de <b>aluno</b> é criado automaticamente; tutores são cadastrados pela coordenação.</p>
          {!isConfigured && <div className="alert">⚠️ Supabase não configurado. Copie <code>web/.env.example</code> para <code>.env.local</code> e preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.</div>}
          {error && <div className="alert err">{error}</div>}
          <button className="gbtn" disabled={!isConfigured || loading} onClick={signInWithGoogle}>
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.8-9.9 6.8-17.4z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continuar com Google
          </button>
        </div>
      </div>
    </div>
  );
}
