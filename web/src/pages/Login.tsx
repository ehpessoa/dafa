import { useState, type FormEvent } from 'react';
import { isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'entrar' | 'cadastrar'>('cadastrar');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signup = mode === 'cadastrar';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (signup) await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

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
        <form className="card stack" style={{ maxWidth: 400, width: '100%' }} onSubmit={submit}>
          <div className="tabs" style={{ margin: 0 }} role="tablist">
            <button type="button" role="tab" aria-selected={signup} className={signup ? 'on' : ''} onClick={() => { setMode('cadastrar'); setErr(''); }}>Criar conta</button>
            <button type="button" role="tab" aria-selected={!signup} className={!signup ? 'on' : ''} onClick={() => { setMode('entrar'); setErr(''); }}>Entrar</button>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {signup ? 'Cadastre-se e já comece o treinamento agora mesmo — é grátis e leva 30 segundos.' : 'Entre com seu e-mail e senha para continuar de onde parou.'}
          </p>
          {!isConfigured && <div className="alert">⚠️ Supabase não configurado. Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.</div>}

          {signup && (<div><label htmlFor="name">Nome completo</label>
            <input id="name" type="text" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" /></div>)}
          <div><label htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" /></div>
          <div><label htmlFor="password">Senha {signup && <span className="muted small">(mínimo 8 caracteres)</span>}</label>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <input id="password" type={show ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : 1} maxLength={72}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="btn sm" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>{show ? '🙈' : '👁️'}</button>
            </div></div>

          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn primary" style={{ justifyContent: 'center', width: '100%' }} disabled={!isConfigured || busy} type="submit">
            {busy ? 'Aguarde…' : signup ? '🚀 Criar conta e começar' : 'Entrar'}
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            {signup ? 'Já tem conta? ' : 'Ainda não tem conta? '}
            <a href="#" onClick={(e) => { e.preventDefault(); setMode(signup ? 'entrar' : 'cadastrar'); setErr(''); }}>{signup ? 'Entrar' : 'Criar conta'}</a>
            {' · '}Tutores: cadastre-se com o e-mail autorizado pela coordenação.
          </p>
        </form>
      </div>
    </div>
  );
}
