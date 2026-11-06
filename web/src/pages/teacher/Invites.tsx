import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/supabase';
import { fmtDate } from '../../lib/progress';
import { isValidPhone, maskPhone } from '../../lib/phone';
import { Empty, Spinner } from '../../components/ui';

interface Invite { role: 'student' | 'teacher'; id: string; full_name: string; email: string; phone_hint: string; created_at: string; expires_at: string; used_at: string | null; status: 'pending' | 'used' | 'expired' }
const STATUS: Record<Invite['status'], { label: string; cls: string }> = {
  pending: { label: '⏳ Aguardando', cls: 'amber' }, used: { label: '✅ Conta criada', cls: 'green' }, expired: { label: '⌛ Expirado', cls: '' },
};

export default function Invites() {
  const { token } = useAuth();
  const [list, setList] = useState<Invite[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    try { setList(await api<Invite[]>('app_invite_list', { p_token: token })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setList([]); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const send = async (n: string, e: string, p: string, r: 'student' | 'teacher') => {
    const res = await fetch('/api/invite-send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: n, email: e, phone: p, role: r }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? 'Não foi possível enviar o convite.');
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setErr(''); setOk('');
    if (!isValidPhone(phone)) { setErr('Informe o WhatsApp no formato (99) 99999-9999.'); return; }
    setBusy(true);
    try {
      await send(name.trim(), email.trim(), phone, role);
      setOk(`Convite ${role === 'teacher' ? 'de tutor ' : ''}enviado por WhatsApp para ${name.trim()}.`);
      setName(''); setEmail(''); setPhone('');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const revoke = async (i: Invite) => {
    if (!window.confirm(`Cancelar o convite de ${i.full_name}?`)) return;
    setErr(''); setOk('');
    try { await api('app_invite_revoke', { p_token: token, p_id: i.id }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="stack">
      <h1>✉️ Convites</h1>
      <p className="muted" style={{ margin: 0 }}>Informe nome, e-mail e WhatsApp da pessoa e escolha o perfil (aluno ou tutor). Ela recebe por WhatsApp um link pessoal (vale 7 dias); ao abrir, só precisa escolher a senha e confirmar para criar a conta.</p>

      <form className="card stack" onSubmit={submit}>
        <div className="grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
          <div><label htmlFor="in">Nome completo</label><input id="in" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da pessoa" /></div>
          <div><label htmlFor="ie">E-mail</label><input id="ie" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@email.com" /></div>
          <div><label htmlFor="ip">WhatsApp</label>
            <input id="ip" type="tel" inputMode="numeric" required maxLength={15} pattern="\(\d{2}\) 9\d{4}-\d{4}" title="Use o formato (99) 99999-9999"
              value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(99) 99999-9999" /></div>
          <div><label htmlFor="ir">Perfil</label>
            <select id="ir" value={role} onChange={(e) => setRole(e.target.value as 'student' | 'teacher')}><option value="student">🧑‍🎓 Aluno</option><option value="teacher">🎓 Tutor</option></select></div>
        </div>
        {err && <div className="alert err" role="alert">{err}</div>}
        {ok && <div className="alert ok" role="status">{ok}</div>}
        <div><button className="btn primary" disabled={busy} type="submit">{busy ? 'Enviando…' : '📲 Enviar convite por WhatsApp'}</button></div>
      </form>

      <h2>Convites enviados</h2>
      {list === null ? <Spinner /> : list.length === 0 ? <Empty>Nenhum convite enviado ainda.</Empty> : (
        <div className="card scroll-x"><table><thead><tr><th>Pessoa</th><th>Perfil</th><th>WhatsApp</th><th>Enviado em</th><th>Situação</th><th></th></tr></thead><tbody>
          {list.map((i) => (
            <tr key={i.id}>
              <td><b>{i.full_name}</b><div className="small muted">{i.email}</div></td>
              <td>{i.role === 'teacher' ? '🎓 Tutor' : '🧑‍🎓 Aluno'}</td>
              <td>final {i.phone_hint}</td>
              <td>{fmtDate(i.created_at)}</td>
              <td><span className={`badge ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {i.status !== 'used' && <>
                  <button className="btn sm" type="button" title="Cria um novo link (o anterior deixa de valer)"
                    onClick={() => { setErr(''); setOk(''); setName(i.full_name); setEmail(i.email); setRole(i.role); setPhone(''); window.scrollTo({ top: 0, behavior: 'smooth' }); document.getElementById('ip')?.focus(); }}>Reenviar</button>{' '}
                  {i.status === 'pending' && <button className="btn sm" type="button" onClick={() => void revoke(i)}>Cancelar</button>}
                </>}
              </td>
            </tr>))}
        </tbody></table></div>
      )}
      <Link to="/tutor">← Visão da turma</Link>
    </div>
  );
}
