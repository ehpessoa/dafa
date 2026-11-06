import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { fmtDate, weekday } from '../lib/progress';
import DepGraph from '../components/DepGraph';
import { Progress, SessBadge } from '../components/ui';

export default function Trail() {
  const { profile } = useAuth();
  const { data, progress } = useData();
  const me = profile!.id;
  return (
    <div className="stack">
      <div><h1>🗺️ Trilha e dependências</h1>
        <p className="muted">Uma sessão só é liberada quando <b>todas as suas dependências</b> forem <b>aprovadas pelo tutor</b>. Se precisar, refaça as entregas até ser aprovado.</p></div>
      <div className="card"><DepGraph stateOf={(d) => progress.sessState(me, d)} /></div>
      {data.levels.map((l) => {
        const ss = data.sessions.filter((s) => s.level_slug === l.slug);
        const done = ss.filter((s) => progress.sessState(me, s.day) === 'done').length;
        return (
          <section key={l.slug} className="card stack">
            <div className="row between">
              <div><h2 style={{ marginBottom: 2 }}>{l.emoji} {l.title}</h2><div className="muted small">{l.objective}</div></div>
              <div style={{ minWidth: 160 }}><div className="small muted">{done}/{ss.length} sessões</div><Progress pct={Math.round((done / ss.length) * 100)} color={l.color ?? undefined} /></div>
            </div>
            <div className="grid g2">
              {ss.map((s) => {
                const st = progress.sessState(me, s.day), miss = progress.missingDeps(me, s.day);
                return (
                  <Link key={s.day} to={`/sessao/${s.day}`} className={`sess ${st === 'locked' ? 'locked' : ''}`}>
                    <div className="dnum" style={{ background: l.color ?? '#2563eb' }}>{s.day}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{s.title}</div>
                      <div className="small muted">{weekday(s.scheduled_date)} {fmtDate(s.scheduled_date)} · {s.minutes} min{miss.length ? ` · precisa do(s) dia(s) ${miss.join(', ')}` : ''}</div>
                    </div>
                    <SessBadge s={st} />
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
