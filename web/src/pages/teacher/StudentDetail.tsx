import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { useOverdue } from '../../lib/overdue';
import DepGraph from '../../components/DepGraph';
import { Avatar, Empty, ExBadge, Ring, SessBadge } from '../../components/ui';

export default function StudentDetail() {
  const { id } = useParams();
  const { data, progress, reload } = useData();
  const { token } = useAuth();
  const [reset, setReset] = useState<{ code: string; expires_at: string } | null>(null);
  const [resetErr, setResetErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { overdue, reload: reloadOverdue } = useOverdue();
  const st = data.profiles.find((p) => p.id === id);
  if (!st) return <Empty>Aluno não encontrado.</Empty>;
  const late = overdue.get(st.id) ?? [];
  const paused = Boolean(st.alerts_paused);
  const toggleAlerts = async () => {
    setBusy(true); setResetErr('');
    try { await api('app_set_student_alerts', { p_token: token, p_student_id: st.id, p_paused: !paused }); await reload(); await reloadOverdue(); }
    catch (e) { setResetErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const promote = async () => {
    if (!window.confirm(`Promover ${st.full_name} a tutor? Ele(a) passará a ver a turma inteira e avaliar entregas.`)) return;
    setBusy(true); setResetErr('');
    try { await api('app_set_role', { p_token: token, p_user_id: st.id, p_role: 'teacher' }); await reload(); }
    catch (e) { setResetErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const sum = progress.summary(st.id);
  const genReset = async () => {
    setBusy(true); setResetErr(''); setReset(null);
    try { setReset(await api<{ code: string; expires_at: string }>('app_teacher_reset_code', { p_token: token, p_student_id: st.id })); }
    catch (e) { setResetErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  return (
    <div className="stack">
      <div className="small"><Link to="/tutor/alunos">← Alunos</Link></div>
      <div className="card row between">
        <div className="row"><Avatar name={st.full_name} url={st.avatar_url} size={56} /><div><h1 style={{ margin: 0 }}>{st.full_name}</h1><div className="muted">{st.email}</div></div></div>
        <div className="row" style={{ gap: 24 }}>
          <Ring pct={sum.pct} size={96} />
          <div className="small"><div>Sessões: <b>{sum.doneSessions}/{sum.totalSessions}</b></div><div>Nota média: <b>{sum.avgScore?.toFixed(1) ?? '—'}</b></div><div>Pendentes: <b>{sum.pending}</b> · Ajustes: <b>{sum.revisions}</b></div></div>
        </div>
      </div>
      {st.role === 'student' && (
        <div className="card stack">
          <div className="row between"><h2 style={{ margin: 0 }}>⏰ Alertas de atraso</h2>
            <span className={`badge ${paused ? '' : 'green'}`}>{paused ? '🔕 Pausados' : '🔔 Ativos'}</span></div>
          {late.length > 0
            ? <div className="alert" role="status"><b>Entrega semanal em atraso:</b>{late.map((w) => <div key={w.week}>• Semana {w.week} — {w.title} (venceu em {fmtDate(w.due_date)} · {w.days_late} {w.days_late === 1 ? 'dia' : 'dias'})</div>)}</div>
            : <p className="muted small" style={{ margin: 0 }}>Nenhuma entrega semanal em atraso.</p>}
          <p className="muted small" style={{ margin: 0 }}>
            {paused ? 'Este aluno não recebe lembretes (WhatsApp e app) e não entra no resumo dos tutores. Retome quando quiser.'
              : 'Quando uma entrega semanal vence, o aluno é lembrado por WhatsApp e no app (no máximo 1 vez a cada 3 dias, em dias úteis) e os tutores recebem um resumo. Pause se o aluno combinou outro prazo ou está afastado.'}
          </p>
          <div><button className="btn sm" disabled={busy} onClick={toggleAlerts}>{paused ? '🔔 Retomar alertas deste aluno' : '🔕 Pausar alertas deste aluno'}</button></div>
        </div>
      )}
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Perfil de acesso</h2>
        <p className="muted small" style={{ margin: 0 }}>{st.role === 'teacher' ? 'Esta pessoa é tutor(a). Para rebaixar, use a lista de tutores em Alunos.' : 'Promova este aluno a tutor para que ele veja a turma e avalie entregas.'}</p>
        {st.role !== 'teacher' && <div><button className="btn sm" disabled={busy} onClick={promote}>🎓 Promover a tutor</button></div>}
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Redefinição de senha</h2>
        <p className="muted small" style={{ margin: 0 }}>Se o aluno esqueceu a senha, gere um código de uso único (vale por 1 hora) e envie por um canal seguro. Ele usa "Esqueci minha senha" na tela de login. Um novo código invalida o anterior.</p>
        <div><button className="btn sm" disabled={busy} onClick={genReset}>{busy ? 'Gerando…' : '🔑 Gerar código de redefinição'}</button></div>
        {reset && <div className="alert" role="status">Código para {st.full_name}: <b style={{ fontSize: '1.2rem', letterSpacing: '.08em' }}>{reset.code}</b> · válido até {new Date(reset.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>}
        {resetErr && <div className="alert err" role="alert">{resetErr}</div>}
      </div>
      <div className="card"><h2>Mapa de progresso</h2><DepGraph stateOf={(d) => progress.sessState(st.id, d)} /></div>
      <div className="card scroll-x"><h2>Sessões</h2><table><thead><tr><th>Dia</th><th>Sessão</th><th>Status</th><th>Exercícios</th></tr></thead><tbody>
        {data.sessions.map((s) => (
          <tr key={s.day}><td>{s.day}</td><td><Link to={`/sessao/${s.day}?aluno=${st.id}&tab=exercicios`}>{s.title}</Link><div className="small muted">{fmtDate(s.scheduled_date)}</div></td>
            <td><SessBadge s={progress.sessState(st.id, s.day)} /></td>
            <td><div className="chips">{data.exercises.filter((e) => e.session_day === s.day).map((e) => {
              const last = progress.attempts(st.id, e.id).at(-1);
              return last && (last.status === 'submitted' || last.status === 'needs_review') ? <Link key={e.id} to={`/tutor/avaliar/${last.id}`} title={e.title}><ExBadge s="submitted" /></Link> : <span key={e.id} title={e.title}><ExBadge s={progress.exState(st.id, e.id)} /></span>;
            })}</div></td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}
