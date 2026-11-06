import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Avatar, Empty, Progress } from '../../components/ui';

export default function Students() {
  const { data, progress } = useData();
  const nav = useNavigate();
  const students = data.profiles.filter((p) => p.role === 'student');
  return (
    <div className="stack">
      <h1>👥 Alunos</h1>
      {students.length === 0 ? <Empty>Nenhum aluno ainda. Alunos aparecem após o primeiro login com Google.</Empty> : (
        <div className="card scroll-x"><table><thead><tr><th>Aluno</th><th style={{ minWidth: 160 }}>Progresso</th><th>Sessões</th><th>Nota média</th><th>Pendentes</th><th>Ajustes</th><th>Última entrega</th></tr></thead><tbody>
          {students.map((s) => { const x = progress.summary(s.id); return (
            <tr key={s.id} className="click" onClick={() => nav(`/tutor/alunos/${s.id}`)}>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={s.full_name} url={s.avatar_url} size={30} /><div><b>{s.full_name}</b><div className="small muted">{s.email}</div></div></div></td>
              <td><Progress pct={x.pct} /><span className="small muted">{x.pct}%</span></td><td>{x.doneSessions}/{x.totalSessions}</td><td>{x.avgScore?.toFixed(1) ?? '—'}</td><td>{x.pending}</td><td>{x.revisions}</td><td>{x.last ? fmtDate(x.last) : '—'}</td>
            </tr>); })}
        </tbody></table></div>
      )}
      <Link to="/tutor">← Visão da turma</Link>
    </div>
  );
}
