import { useEffect, useState, type FormEvent } from 'react';
import { api, isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';

interface Info { name?: string; email?: string; phone_hint?: string; error?: string }

/** Tela aberta pelo link do convite (?convite=TOKEN): dados já definidos pelo tutor; o aluno só escolhe a senha. */
export default function AcceptInvite({ invite }: { invite: string }) {
  const { acceptInvite } = useAuth();
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!isConfigured) { setInfo({ error: 'Supabase não configurado.' }); return; }
    api<Info>('app_invite_info', { p_invite: invite }).then(setInfo).catch((e) => setInfo({ error: e instanceof Error ? e.message : String(e) }));
  }, [invite]);

  const leave = () => { window.location.href = window.location.pathname; };   // volta para o login (sem o parâmetro)

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (password !== confirm) { setErr('As senhas não coincidem.'); return; }
    setBusy(true);
    try {
      await acceptInvite(invite, password);
      window.history.replaceState(null, '', window.location.pathname);   // remove o token da URL
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  return (
    <div className="hero" style={{ gridTemplateColumns: '1fr' }}>
      <div className="right">
        <div className="card stack" style={{ maxWidth: 420, width: '100%' }}>
          <div className="brand" style={{ padding: 0 }}><div className="logo">📊</div> DAFA</div>
          {!info ? <Spinner /> : info.error ? (
            <>
              <h2 style={{ margin: 0 }}>Convite indisponível</h2>
              <div className="alert err" role="alert">{info.error}</div>
              <button className="btn" type="button" onClick={leave}>Ir para o login</button>
            </>
          ) : (
            <form className="stack" onSubmit={submit}>
              <h2 style={{ margin: 0 }}>🎉 Olá, {info.name?.split(' ')[0]}!</h2>
              <p className="muted" style={{ margin: 0 }}>Você foi convidado(a) para o treinamento de Análise de Dados. Confira seus dados e escolha uma senha para criar a conta.</p>
              <div><label htmlFor="n">Nome</label><input id="n" value={info.name ?? ''} readOnly /></div>
              <div><label htmlFor="e">E-mail</label><input id="e" value={info.email ?? ''} readOnly /></div>
              <div><label htmlFor="w">WhatsApp</label><input id="w" value={`(••) •••••-${info.phone_hint?.slice(-4) ?? '••••'}`} readOnly /></div>
              <div><label htmlFor="p">Senha <span className="muted small">(mínimo 8 caracteres)</span></label>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                  <input id="p" type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                  <button type="button" className="btn sm" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>{show ? '🙈' : '👁️'}</button>
                </div></div>
              <div><label htmlFor="c">Confirmar senha</label>
                <input id="c" type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
              {err && <div className="alert err" role="alert">{err}</div>}
              <button className="btn primary" style={{ justifyContent: 'center', width: '100%' }} disabled={busy} type="submit">{busy ? 'Aguarde…' : '🚀 Criar conta e começar'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
