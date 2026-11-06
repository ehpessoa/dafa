import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { isValidPhone, maskPhone } from '../lib/phone';

/** Tela exibida após o cadastro até o WhatsApp ser confirmado com o código de 6 dígitos. */
export default function VerifyPhone() {
  const { profile, sendVerificationCode, confirmVerification, changePhone, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState(`Enviamos um código de 6 dígitos para o seu WhatsApp (final ${profile?.phone_hint ?? '••••'}).`);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setErr(''); setBusy(true);
    try { await fn(); if (ok) setInfo(ok); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const confirm = (e: FormEvent) => { e.preventDefault(); void run(() => confirmVerification(code.trim())); };
  const resend = () => run(sendVerificationCode, 'Novo código enviado! Confira o WhatsApp.');
  const saveNumber = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!isValidPhone(phone)) throw new Error('Informe o WhatsApp no formato (99) 99999-9999.');
      await changePhone(phone);
      await sendVerificationCode();
      setEditing(false); setCode('');
      setInfo('Número atualizado. Enviamos um novo código para o WhatsApp informado.');
    });
  };

  return (
    <div className="hero" style={{ gridTemplateColumns: '1fr' }}>
      <div className="right">
        <form className="card stack" style={{ maxWidth: 400, width: '100%' }} onSubmit={editing ? saveNumber : confirm}>
          <h2 style={{ margin: 0 }}>📲 Confirme seu WhatsApp</h2>
          <p className="muted" style={{ margin: 0 }}>Olá, {profile?.full_name?.split(' ')[0]}! Para liberar sua conta, digite o código enviado ao seu WhatsApp.</p>
          {info && <div className="alert ok" role="status">{info}</div>}

          {editing ? (
            <div><label htmlFor="phone">Novo WhatsApp</label>
              <input id="phone" type="tel" inputMode="numeric" required maxLength={15} pattern="\(\d{2}\) 9\d{4}-\d{4}" title="Use o formato (99) 99999-9999"
                value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(99) 99999-9999" autoFocus /></div>
          ) : (
            <div><label htmlFor="code">Código de 6 dígitos</label>
              <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="\d{6}" title="6 dígitos"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" autoFocus /></div>
          )}

          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn primary" style={{ justifyContent: 'center', width: '100%' }} disabled={busy} type="submit">
            {busy ? 'Aguarde…' : editing ? 'Salvar e enviar novo código' : '✅ Confirmar'}
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            {!editing && <><a href="#" onClick={(e) => { e.preventDefault(); void resend(); }}>Reenviar código</a>{' · '}</>}
            <a href="#" onClick={(e) => { e.preventDefault(); setEditing(!editing); setErr(''); }}>{editing ? 'Cancelar' : 'Número errado?'}</a>
            {' · '}<a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sair</a>
          </p>
        </form>
      </div>
    </div>
  );
}
