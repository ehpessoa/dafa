import { useState, type FormEvent } from 'react';
import { isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { isValidPhone, maskPhone } from '../lib/phone';

export default function Login() {
  const { signIn, signUp, requestPasswordReset, confirmPasswordReset } = useAuth();
  const [mode, setMode] = useState<'entrar' | 'cadastrar' | 'recuperar'>('cadastrar');
  const [step, setStep] = useState<'email' | 'codigo'>('email');   // recuperação de senha
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [info, setInfo] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const signup = mode === 'cadastrar';

  const recover = mode === 'recuperar';
  const go = (m: typeof mode) => { setMode(m); setStep('email'); setErr(''); setInfo(''); setCode(''); setPassword(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setInfo(''); setBusy(true);
    try {
      if (recover && step === 'email') {
        await requestPasswordReset(email.trim());
        setStep('codigo'); setBusy(false);
        setInfo('Se o e-mail estiver cadastrado, enviamos um código de 6 dígitos para o WhatsApp da conta. Ele vale por 15 minutos.');
        return;
      }
      if (recover) {
        await confirmPasswordReset(email.trim(), code.trim(), password);
        go('entrar'); setBusy(false);
        setInfo('Senha redefinida! Entre com a nova senha.');
        return;
      }
      if (signup) {
        if (!isValidPhone(phone)) throw new Error('Informe o WhatsApp no formato (99) 99999-9999.');
        await signUp(name.trim(), email.trim(), phone, password);
      } else await signIn(email.trim(), password);
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
          {!recover && (
            <div className="tabs" style={{ margin: 0 }} role="tablist">
              <button type="button" role="tab" aria-selected={signup} className={signup ? 'on' : ''} onClick={() => go('cadastrar')}>Criar conta</button>
              <button type="button" role="tab" aria-selected={!signup} className={!signup ? 'on' : ''} onClick={() => go('entrar')}>Entrar</button>
            </div>
          )}
          {recover && <h2 style={{ margin: 0 }}>🔐 Redefinir senha</h2>}
          <p className="muted" style={{ margin: 0 }}>
            {recover ? (step === 'email' ? 'Informe o e-mail da conta. Enviaremos um código de confirmação para o WhatsApp cadastrado.' : 'Digite o código recebido no WhatsApp e escolha a nova senha.')
              : signup ? 'Cadastre-se e já comece o treinamento agora mesmo — é grátis e leva 30 segundos.' : 'Entre com seu e-mail e senha para continuar de onde parou.'}
          </p>
          {!isConfigured && <div className="alert">⚠️ Supabase não configurado. Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.</div>}

          {signup && (<div><label htmlFor="name">Nome completo</label>
            <input id="name" type="text" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" /></div>)}
          <div><label htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" readOnly={recover && step === 'codigo'} /></div>
          {signup && (<div><label htmlFor="phone">WhatsApp <span className="muted small">(confirmação e recuperação de senha)</span></label>
            <input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" required maxLength={15} pattern="\(\d{2}\) 9\d{4}-\d{4}" title="Use o formato (99) 99999-9999"
              value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(99) 99999-9999" /></div>)}
          {recover && step === 'codigo' && (<div><label htmlFor="code">Código de 6 dígitos</label>
            <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="\d{6}" title="6 dígitos"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" /></div>)}
          {(!recover || step === 'codigo') && (<div><label htmlFor="password">{recover ? 'Nova senha' : 'Senha'} {(signup || recover) && <span className="muted small">(mínimo 8 caracteres)</span>}</label>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <input id="password" type={show ? 'text' : 'password'} autoComplete={signup || recover ? 'new-password' : 'current-password'} required minLength={signup || recover ? 8 : 1} maxLength={72}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="btn sm" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>{show ? '🙈' : '👁️'}</button>
            </div></div>)}

          {info && <div className="alert ok" role="status">{info}</div>}
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn primary" style={{ justifyContent: 'center', width: '100%' }} disabled={!isConfigured || busy} type="submit">
            {busy ? 'Aguarde…' : recover ? (step === 'email' ? '📲 Enviar código por WhatsApp' : 'Redefinir senha') : signup ? '🚀 Criar conta e começar' : 'Entrar'}
          </button>
          {recover && step === 'codigo' && (
            <p className="small muted" style={{ margin: 0 }}>Não chegou? <a href="#" onClick={(e) => { e.preventDefault(); setStep('email'); setInfo(''); setErr(''); }}>Enviar um novo código</a> (aguarde 1 minuto entre pedidos).</p>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            {recover ? (<><a href="#" onClick={(e) => { e.preventDefault(); go('entrar'); }}>Voltar para Entrar</a></>) : (<>
              {signup ? 'Já tem conta? ' : 'Ainda não tem conta? '}
              <a href="#" onClick={(e) => { e.preventDefault(); go(signup ? 'entrar' : 'cadastrar'); }}>{signup ? 'Entrar' : 'Criar conta'}</a>
              {!signup && <>{' · '}<a href="#" onClick={(e) => { e.preventDefault(); go('recuperar'); }}>Esqueci minha senha</a></>}
              {' · '}Tutores: cadastre-se com o e-mail autorizado pela coordenação.</>)}
          </p>
        </form>
      </div>
    </div>
  );
}
