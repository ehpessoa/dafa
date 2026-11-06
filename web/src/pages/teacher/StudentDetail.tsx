import { Link, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import DepGraph from '../../components/DepGraph';
import { Avatar, Empty, ExBadge, Ring, SessBadge } from '../../components/ui';

export default function StudentDetail() {
  const { id } = useParams();
  const { data, progress } = useData();
  const st = data.profiles.find((p) => p.id === id);
  if (!st) return <Empty>Aluno não encontrado.</Empty>;
  const sum = progress.summary(st.id);
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
      <div className="card"><h2>Mapa de progresso</h2><DepGraph stateOf={(d) => progress.sessState(st.id, d)} /></div>
      <div className="card scroll-x"><h2>Sessões</h2><table><thead><tr><th>Dia</th><th>Sessão</th><th>Status</th><th>Exercícios</th></tr></thead><tbody>
        {data.sessions.map((s) => (
          <tr key={s.day}><td>{s.day}</td><td><Link to={`/sessao/${s.day}?aluno=${st.id}&tab=exercicios`}>{s.title}</Link><div className="small muted">{fmtDate(s.scheduled_date)}</div></td>
            <td><SessBadge s={progress.sessState(st.id, s.day)} /></td>
            <td><div className="chips">{data.exercises.filter((e) => e.session_day === s.day).map((e) => {
              const last = progress.attempts(st.id, e.id).at(-1);
              return last && last.status === 'submitted' ? <Link key={e.id} to={`/tutor/avaliar/${last.id}`} title={e.title}><ExBadge s="submitted" /></Link> : <span key={e.id} title={e.title}><ExBadge s={progress.exState(st.id, e.id)} /></span>;
            })}</div></td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}
