import { useEffect, useState, type FormEvent } from 'react';
import { api, isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { TRAILS, HIGHLIGHTS } from './landingContent';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'entrar' | 'cadastrar' | 'recuperar'>('cadastrar');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [info, setInfo] = useState('');
  const [signupMode, setSignupMode] = useState<'open' | 'invite' | 'closed'>('open');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signup = mode === 'cadastrar';
  const recover = mode === 'recuperar';

  // Pergunta ao banco se o cadastro é aberto, por convite ou fechado (em caso de falha, o servidor valida de qualquer forma).
  useEffect(() => {
    if (!isConfigured) return;
    api<{ mode?: 'open' | 'invite' | 'closed' }>('app_signup_status').then((r) => { if (r?.mode) setSignupMode(r.mode); }).catch(() => { /* mantém o padrão */ });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      if (recover) {
        const r = await api<{ ok?: boolean; error?: string }>('app_reset_password', { p_email: email.trim(), p_code: resetCode.trim(), p_new_password: password });
        if (!r?.ok) throw new Error(r?.error ?? 'Não foi possível redefinir a senha.');
        setInfo('Senha redefinida! Entre com a nova senha.'); setMode('entrar'); setPassword(''); setResetCode(''); setBusy(false);
        return;
      }
      if (signup) await signUp(name.trim(), email.trim(), password, invite.trim());
      else await signIn(email.trim(), password);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  return (
    <>
    <div className="hero">
      <div className="left">
        <div className="brand" style={{ color: '#fff', padding: 0 }}><div className="logo" style={{ background: 'rgb(255 255 255 / .2)' }}>📊</div> DAFA</div>
        <h1>Análise de dados para quem decide.</h1>
        <p style={{ fontSize: '1.1rem', opacity: .9 }}>Programa de 30 dias úteis em 3 níveis — Excel, SQL, Power BI, Python e IA — com exercícios reais de comercial, finanças, logística, e-commerce, esporte e marketing.</p>
        <div className="steps">
          {TRAILS.map((t) => (
            <a key={t.id} href={`#trilha-${t.id}`} className="step-link">{t.emoji} <b>{t.name}</b> · {t.subtitle}</a>
          ))}
        </div>
        <a href="#trilhas" className="small" style={{ color: '#fff', opacity: .9 }}>↓ Veja o que você aprende em cada dia</a>
        <p className="small" style={{ opacity: .8 }}>Cada entrega é avaliada por um tutor. Refaça quantas vezes precisar até dominar.</p>
      </div>
      <div className="right">
        <form className="card stack" style={{ maxWidth: 400, width: '100%' }} onSubmit={submit}>
          <div className="tabs" style={{ margin: 0 }} role="tablist">
            <button type="button" role="tab" aria-selected={signup} className={signup ? 'on' : ''} onClick={() => { setMode('cadastrar'); setErr(''); }}>Criar conta</button>
            <button type="button" role="tab" aria-selected={mode === 'entrar'} className={mode === 'entrar' ? 'on' : ''} onClick={() => { setMode('entrar'); setErr(''); }}>Entrar</button>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {recover ? 'Peça ao seu tutor um código de redefinição (vale por 1 hora) e informe-o abaixo com a nova senha.' : signup ? (signupMode === 'invite' ? 'Use o código de convite que a coordenação enviou para criar sua conta e começar o treinamento.' : 'Cadastre-se e já comece o treinamento agora mesmo — é grátis e leva 30 segundos.') : 'Entre com seu e-mail e senha para continuar de onde parou.'}
          </p>
          {!isConfigured && <div className="alert">⚠️ Supabase não configurado. Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.</div>}

          {signup && (<div><label htmlFor="name">Nome completo</label>
            <input id="name" type="text" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" /></div>)}
          <div><label htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" /></div>
          {recover && (<div><label htmlFor="rcode">Código de redefinição</label>
            <input id="rcode" type="text" autoComplete="off" required maxLength={20} value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder="Ex.: ABCD-2345" /></div>)}
          <div><label htmlFor="password">{recover ? 'Nova senha' : 'Senha'} {(signup || recover) && <span className="muted small">(mínimo 8 caracteres)</span>}</label>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <input id="password" type={show ? 'text' : 'password'} autoComplete={signup || recover ? 'new-password' : 'current-password'} required minLength={signup || recover ? 8 : 1} maxLength={72}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="btn sm" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>{show ? '🙈' : '👁️'}</button>
            </div></div>

          {signup && signupMode === 'invite' && (<div><label htmlFor="invite">Código de convite</label>
            <input id="invite" type="text" autoComplete="off" required maxLength={64} value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Informado pela coordenação" /></div>)}
          {signup && signupMode === 'closed' && <div className="alert">O cadastro de alunos está fechado. Se você é tutor, use o e-mail autorizado pela coordenação.</div>}

          {info && <div className="alert" role="status">{info}</div>}
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn primary" style={{ justifyContent: 'center', width: '100%' }} disabled={!isConfigured || busy} type="submit">
            {busy ? 'Aguarde…' : recover ? 'Redefinir senha' : signup ? '🚀 Criar conta e começar' : 'Entrar'}
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            {recover ? '' : signup ? 'Já tem conta? ' : 'Ainda não tem conta? '}
            {!recover && <a href="#" onClick={(e) => { e.preventDefault(); setMode(signup ? 'entrar' : 'cadastrar'); setErr(''); }}>{signup ? 'Entrar' : 'Criar conta'}</a>}
            {' · '}<a href="#" onClick={(e) => { e.preventDefault(); setMode(recover ? 'entrar' : 'recuperar'); setErr(''); setInfo(''); }}>{recover ? 'Voltar' : 'Esqueci minha senha'}</a>
            {' · '}Tutores: cadastre-se com o e-mail autorizado pela coordenação.
          </p>
        </form>
      </div>
    </div>
    <section id="trilhas" className="landing">
      <div className="landing-in">
        <h2>O que você aprende, trilha por trilha</h2>
        <p className="muted">30 dias úteis, cerca de 2h30 por dia, sem exigir conhecimento prévio de programação. Todo dia segue o mesmo caminho: entender o porquê, ver a ferramenta, praticar e enviar uma entrega para o tutor.</p>
        {TRAILS.map((t) => (
          <article key={t.id} id={`trilha-${t.id}`} className="trail">
            <header>
              <h3>{t.emoji} {t.name} · {t.subtitle}</h3>
              <div className="small muted">{t.period}</div>
              <p><b>Promessa:</b> {t.promise}</p>
            </header>
            {t.weeks.map((w) => (
              <div key={w.title} className="tweek">
                <h4>{w.title}</h4>
                {w.days.map((d) => (
                  <details key={d.day} className="tday">
                    <summary><span className="dn">Dia {d.day}</span> {d.title}{d.delivery && ' 📦'}</summary>
                    <ul>{d.learn.map((l) => <li key={l}>{l}</li>)}</ul>
                    <p><b>Na prática:</b> {d.practice}</p>
                    {d.delivery && <p className="deliv"><b>📦 Entrega da semana:</b> {d.delivery}</p>}
                  </details>
                ))}
              </div>
            ))}
            <p className="takeaway"><b>O que você leva:</b> {t.takeaway}</p>
          </article>
        ))}
        <div className="hl-grid">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="card"><div style={{ fontSize: '1.6rem' }}>{h.icon}</div><b>{h.title}</b><p className="small muted" style={{ margin: '6px 0 0' }}>{h.text}</p></div>
          ))}
        </div>
      </div>
    </section>
    </>
  );
}
