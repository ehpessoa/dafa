import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { fmtDate, todayISO, weekday } from '../lib/progress';
import { Progress, Ring, SessBadge } from '../components/ui';

export default function Dashboard() {
  const { profile } = useAuth();
  const { data, progress } = useData();
  const me = profile!.id;
  const sum = progress.summary(me);
  const today = todayISO();
  const todays = data.sessions.find((s) => s.scheduled_date === today);
  const next = data.sessions.find((s) => ['available', 'in_progress', 'review'].includes(progress.sessState(me, s.day)) && progress.sessState(me, s.day) !== 'review')
    ?? data.sessions.find((s) => progress.sessState(me, s.day) === 'review');
  const first = data.sessions[0]?.scheduled_date, last = data.sessions.at(-1)?.scheduled_date;

  const byLevel = data.levels.map((l) => {
    const ss = data.sessions.filter((s) => s.level_slug === l.slug);
    const st = ss.map((s) => progress.sessState(me, s.day));
    return { nivel: l.title, Concluídas: st.filter((x) => x === 'done').length, 'Em andamento': st.filter((x) => ['in_progress', 'review'].includes(x)).length,
      Disponíveis: st.filter((x) => x === 'available').length, Bloqueadas: st.filter((x) => x === 'locked').length };
  });
  const myReviews = data.reviews.filter((r) => data.submissions.find((s) => s.id === r.submission_id)?.student_id === me)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const scoreSeries = myReviews.map((r, i) => ({ n: i + 1, nota: r.score }));
  const recent = [...myReviews].reverse().slice(0, 4);

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Olá, {profile!.full_name?.split(' ')[0]} 👋</h1>
          <div className="muted">Programa de {first ? fmtDate(first) : ''} a {last ? fmtDate(last) : ''} · 30 dias úteis · {data.exercises.length} exercícios</div>
        </div>
        {next && <Link className="btn primary" to={`/sessao/${next.day}`}>Continuar: Dia {next.day} →</Link>}
      </div>

      {todays && (
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="row between">
            <div><span className="badge blue">📍 Hoje · {weekday(today)} {fmtDate(today)}</span><h2 style={{ margin: '8px 0 2px' }}>Dia {todays.day} · {todays.title}</h2><div className="muted small">{todays.minutes} min · semana {todays.week}</div></div>
            <div className="row"><SessBadge s={progress.sessState(me, todays.day)} /><Link className="btn" to={`/sessao/${todays.day}`}>Abrir sessão</Link></div>
          </div>
        </div>
      )}

      <div className="grid g4">
        <div className="card row" style={{ gap: 18 }}><Ring pct={sum.pct} label="exercícios" /><div className="kpi"><div className="l">Progresso geral</div><div className="small muted">{sum.approvedEx}/{sum.totalEx} aprovados</div></div></div>
        <div className="card kpi"><div className="v">{sum.doneSessions}<span className="muted" style={{ fontSize: '1rem' }}>/{sum.totalSessions}</span></div><div className="l">Sessões concluídas</div><Progress pct={Math.round((sum.doneSessions / Math.max(1, sum.totalSessions)) * 100)} /></div>
        <div className="card kpi"><div className="v">{sum.avgScore != null ? sum.avgScore.toFixed(1) : '—'}</div><div className="l">Nota média dos tutores</div><div className="small muted">{sum.attempts} entregas enviadas</div></div>
        <div className="card kpi"><div className="v">{sum.pending}<span className="badge amber" style={{ marginLeft: 8 }}>⏳</span></div><div className="l">Aguardando avaliação</div><div className="small muted">{sum.revisions} com ajustes solicitados</div></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Sessões por nível</h2>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={byLevel} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nivel" width={100} />
                <Tooltip /><Legend />
                <Bar dataKey="Concluídas" stackId="a" fill="#16a34a" /><Bar dataKey="Em andamento" stackId="a" fill="#d97706" />
                <Bar dataKey="Disponíveis" stackId="a" fill="#2563eb" /><Bar dataKey="Bloqueadas" stackId="a" fill="#cbd5e1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h2>Evolução das notas</h2>
          {scoreSeries.length ? (
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={scoreSeries}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="n" label={{ value: 'avaliação nº', position: 'insideBottom', offset: -2 }} /><YAxis domain={[0, 10]} /><Tooltip />
                  <Line type="monotone" dataKey="nota" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} /></LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="muted">Suas notas aparecerão aqui após a primeira avaliação do tutor.</p>}
        </div>
      </div>

      <div className="card">
        <h2>📦 Entregáveis semanais</h2>
        <div className="grid g3">
          {data.weekly.map((w) => {
            const ids = progress.exBySession.get(w.session_day) ?? [];
            const approved = ids.filter((id) => progress.exState(me, id) === 'approved').length;
            const st = progress.sessState(me, w.session_day);
            return (
              <Link key={w.week} to={`/sessao/${w.session_day}`} className="day" style={{ padding: 14 }}>
                <div className="row between"><b>Semana {w.week}</b><span className="small muted">até {weekday(w.due_date)} {fmtDate(w.due_date)}</span></div>
                <div className="t">{w.title}</div><Progress pct={ids.length ? Math.round((approved / ids.length) * 100) : 0} /><SessBadge s={st} />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>💬 Últimos feedbacks do tutor</h2>
        {recent.length ? recent.map((r) => {
          const sub = data.submissions.find((s) => s.id === r.submission_id)!;
          const ex = data.exercises.find((e) => e.id === sub.exercise_id)!;
          return (
            <div key={r.id} className={`attempt ${r.verdict}`}>
              <div className="row between"><Link to={`/sessao/${ex.session_day}?tab=exercicios`}><b>Dia {ex.session_day} · {ex.title}</b></Link><span className="score">{r.score.toFixed(1)}</span></div>
              <div className="small">{r.feedback}</div>
            </div>
          );
        }) : <p className="muted">Nenhum feedback ainda. Envie sua primeira entrega no Dia 1!</p>}
      </div>
    </div>
  );
}
