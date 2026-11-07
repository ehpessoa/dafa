import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Empty } from '../../components/ui';

export default function TeacherHome() {
  const { data, progress } = useData();
  const students = data.profiles.filter((p) => p.role === 'student');
  const sums = students.map((s) => ({ s, sum: progress.summary(s.id) }));
  const queue = data.submissions.filter((x) => x.status === 'submitted' || x.status === 'needs_review');
  const avg = sums.length ? Math.round(sums.reduce((a, b) => a + b.sum.pct, 0) / sums.length) : 0;
  const reviews = data.reviews;
  const approvalRate = reviews.length ? Math.round((reviews.filter((r) => r.verdict === 'approved').length / reviews.length) * 100) : 0;

  // distribuição de progresso
  const buckets = [['0–24%', 0, 24], ['25–49%', 25, 49], ['50–74%', 50, 74], ['75–100%', 75, 100]] as const;
  const dist = buckets.map(([name, lo, hi]) => ({ name, alunos: sums.filter((x) => x.sum.pct >= lo && x.sum.pct <= hi).length }));
  // sessões com mais pedidos de ajuste (retrabalho)
  const rework = data.sessions.map((sess) => {
    const ids = new Set(data.exercises.filter((e) => e.session_day === sess.day).map((e) => e.id));
    const rs = reviews.filter((r) => ids.has(data.submissions.find((x) => x.id === r.submission_id)?.exercise_id ?? ''));
    return { dia: `D${sess.day}`, ajustes: rs.filter((r) => r.verdict === 'revision_requested').length, aprovados: rs.filter((r) => r.verdict === 'approved').length };
  }).filter((x) => x.ajustes + x.aprovados > 0);
  const pie = [{ name: 'Aprovadas', v: reviews.filter((r) => r.verdict === 'approved').length, c: '#16a34a' }, { name: 'Ajustes', v: reviews.filter((r) => r.verdict === 'revision_requested').length, c: '#d97706' }, { name: 'Reprovadas', v: reviews.filter((r) => r.verdict === 'rejected').length, c: '#dc2626' }, { name: 'Pendentes', v: queue.length, c: '#2563eb' }];

  return (
    <div className="stack">
      <h1>📈 Visão da turma</h1>
      <div className="grid g4">
        <div className="card kpi"><div className="v">{students.length}</div><div className="l">Alunos</div></div>
        <div className="card kpi"><div className="v">{avg}%</div><div className="l">Progresso médio</div></div>
        <div className="card kpi"><div className="v">{queue.length}</div><div className="l">Entregas para avaliar</div>{queue.length > 0 && <Link to="/tutor/fila">Abrir fila →</Link>}</div>
        <div className="card kpi"><div className="v">{approvalRate}%</div><div className="l">Aprovação (1ª ou N-ésima tentativa)</div></div>
      </div>
      <div className="grid g2">
        <div className="card"><h2>Distribuição de progresso</h2><div style={{ height: 230 }}><ResponsiveContainer><BarChart data={dist}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="alunos" fill="#2563eb" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="card"><h2>Status das avaliações</h2>
          {pie.some((p) => p.v) ? <div style={{ height: 230 }}><ResponsiveContainer><PieChart><Pie data={pie} dataKey="v" nameKey="name" innerRadius={55} outerRadius={85} label>{pie.map((p) => <Cell key={p.name} fill={p.c} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div> : <p className="muted">Sem dados ainda.</p>}
        </div>
      </div>
      <div className="card"><h2>Retrabalho por sessão (onde os alunos mais travam)</h2>
        {rework.length ? <div style={{ height: 240 }}><ResponsiveContainer><BarChart data={rework}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="dia" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="aprovados" stackId="a" fill="#16a34a" /><Bar dataKey="ajustes" stackId="a" fill="#d97706" /></BarChart></ResponsiveContainer></div> : <p className="muted">Aparecerá após as primeiras avaliações.</p>}
      </div>
      <div className="card"><h2>Alunos que precisam de atenção</h2>
        {(() => {
          const att = sums.filter((x) => x.sum.revisions > 0 || x.sum.pending > 0).sort((a, b) => b.sum.pending - a.sum.pending).slice(0, 6);
          return att.length ? <table><thead><tr><th>Aluno</th><th>Progresso</th><th>Pendentes</th><th>Ajustes</th><th>Última entrega</th></tr></thead><tbody>
            {att.map(({ s, sum }) => <tr key={s.id} className="click"><td><Link to={`/tutor/alunos/${s.id}`}>{s.full_name}</Link></td><td>{sum.pct}%</td><td>{sum.pending}</td><td>{sum.revisions}</td><td>{sum.last ? fmtDate(sum.last) : '—'}</td></tr>)}
          </tbody></table> : <Empty>Nenhum aluno com pendências 🎉</Empty>;
        })()}
      </div>
    </div>
  );
}
