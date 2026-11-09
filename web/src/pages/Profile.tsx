import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { isValidPhone, maskPhone } from '../lib/phone';
import { Avatar } from '../components/ui';

/** Executa uma ação de formulário mostrando erro/sucesso na própria seção. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const run = async (fn: () => Promise<string | void>) => {
    setErr(''); setOk(''); setBusy(true);
    try { const m = await fn(); if (m) setOk(m); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  return { busy, err, ok, run, setErr, setOk };
}
const Msg = ({ err, ok }: { err: string; ok: string }) => (<>
  {err && <div className="alert err" role="alert">{err}</div>}
  {ok && <div className="alert ok" role="status">{ok}</div>}
</>);
const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <div className="card stack"><h2 style={{ margin: 0 }}>{title}</h2>{hint && <p className="muted small" style={{ margin: 0 }}>{hint}</p>}{children}</div>
);

export default function Profile() {
  const { profile, isTeacher, updateProfile, changePassword, requestPhoneChange, confirmPhoneChange } = useAuth();
  const { reload } = useData();

  // Dados pessoais
  const [name, setName] = useState(profile?.full_name ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [pwEmail, setPwEmail] = useState('');
  const dados = useAction();
  const emailChanged = email.trim().toLowerCase() !== profile?.email;
  const saveDados = (e: FormEvent) => { e.preventDefault(); void dados.run(async () => {
    await updateProfile(name.trim(), email.trim(), emailChanged ? pwEmail : undefined);
    setPwEmail(''); void reload();
    return 'Dados atualizados.';
  }); };

  // WhatsApp
  const [phone, setPhone] = useState('');
  const [pwPhone, setPwPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const wpp = useAction();
  const sendCode = (e: FormEvent) => { e.preventDefault(); void wpp.run(async () => {
    if (!isValidPhone(phone)) throw new Error('Informe o WhatsApp no formato (99) 99999-9999.');
    await requestPhoneChange(pwPhone, phone);
    setSent(true); setPwPhone('');
    return 'Enviamos um código de 6 dígitos para o novo número. Digite-o abaixo para confirmar.';
  }); };
  const confirmCode = (e: FormEvent) => { e.preventDefault(); void wpp.run(async () => {
    await confirmPhoneChange(code.trim());
    setSent(false); setCode(''); setPhone('');
    return 'WhatsApp atualizado!';
  }); };

  // Senha
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const senha = useAction();
  const savePw = (e: FormEvent) => { e.preventDefault(); void senha.run(async () => {
    if (next !== again) throw new Error('As senhas novas não coincidem.');
    await changePassword(cur, next);
    setCur(''); setNext(''); setAgain('');
    return 'Senha alterada. Os outros dispositivos foram desconectados.';
  }); };
  const pwType = show ? 'text' : 'password';

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="row"><Avatar name={profile?.full_name} url={profile?.avatar_url} size={56} />
        <div><h1 style={{ margin: 0 }}>Meu perfil</h1><div className="muted">{isTeacher ? '🎓 Tutor' : '🧑‍🎓 Aluno'} · WhatsApp final {profile?.phone_hint ?? '—'}</div></div></div>

      <Section title="Dados pessoais">
        <form className="stack" onSubmit={saveDados}>
          <div><label htmlFor="pn">Nome completo</label><input id="pn" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label htmlFor="pe">E-mail (usado para entrar)</label><input id="pe" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {emailChanged && <div><label htmlFor="pw1">Senha atual <span className="muted small">(necessária para trocar o e-mail)</span></label>
            <input id="pw1" type="password" autoComplete="current-password" required value={pwEmail} onChange={(e) => setPwEmail(e.target.value)} /></div>}
          <Msg err={dados.err} ok={dados.ok} />
          <div><button className="btn primary" disabled={dados.busy} type="submit">{dados.busy ? 'Salvando…' : 'Salvar dados'}</button></div>
        </form>
      </Section>

      <Section title="WhatsApp" hint="Usado para a recuperação de senha. Para trocar, confirme sua senha e o código enviado ao novo número.">
        {!sent ? (
          <form className="stack" onSubmit={sendCode}>
            <div><label htmlFor="pp">Novo WhatsApp</label>
              <input id="pp" type="tel" inputMode="numeric" required maxLength={15} pattern="\(\d{2}\) 9\d{4}-\d{4}" title="Use o formato (99) 99999-9999"
                value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(99) 99999-9999" /></div>
            <div><label htmlFor="pw2">Senha atual</label><input id="pw2" type="password" autoComplete="current-password" required value={pwPhone} onChange={(e) => setPwPhone(e.target.value)} /></div>
            <Msg err={wpp.err} ok={wpp.ok} />
            <div><button className="btn" disabled={wpp.busy} type="submit">{wpp.busy ? 'Enviando…' : '📲 Enviar código ao novo número'}</button></div>
          </form>
        ) : (
          <form className="stack" onSubmit={confirmCode}>
            <div><label htmlFor="pc">Código de 6 dígitos</label>
              <input id="pc" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" autoFocus /></div>
            <Msg err={wpp.err} ok={wpp.ok} />
            <div className="row"><button className="btn primary" disabled={wpp.busy} type="submit">{wpp.busy ? 'Aguarde…' : '✅ Confirmar novo número'}</button>
              <button className="btn" type="button" onClick={() => { setSent(false); wpp.setErr(''); wpp.setOk(''); }}>Cancelar</button></div>
          </form>
        )}
      </Section>

      <Section title="Senha">
        <form className="stack" onSubmit={savePw}>
          <div><label htmlFor="ps0">Senha atual</label><input id="ps0" type={pwType} autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div><label htmlFor="ps1">Nova senha <span className="muted small">(mínimo 8 caracteres)</span></label><input id="ps1" type={pwType} autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div><label htmlFor="ps2">Confirmar nova senha</label><input id="ps2" type={pwType} autoComplete="new-password" required minLength={8} maxLength={72} value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: 'auto' }} /> Mostrar senhas</label>
          <Msg err={senha.err} ok={senha.ok} />
          <div><button className="btn primary" disabled={senha.busy} type="submit">{senha.busy ? 'Salvando…' : 'Alterar senha'}</button></div>
        </form>
      </Section>
    </div>
  );
}
