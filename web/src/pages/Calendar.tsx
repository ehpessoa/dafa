import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { fmtDate, todayISO, weekday } from '../lib/progress';
import { sessIcon } from '../components/ui';

export default function CalendarPage() {
  const { profile } = useAuth();
  const { data, progress } = useData();
  const me = profile!.id, today = todayISO();
  const weeks = [1, 2, 3, 4, 5, 6];
  return (
    <div className="stack">
      <div><h1>📅 Calendário dos 30 dias úteis</h1><p className="muted">Segunda a sexta · sem sábados e domingos. Cada semana termina com um entregável (📦).</p></div>
      {weeks.map((w) => {
        const ss = data.sessions.filter((s) => s.week === w);
        const l = data.levels.find((x) => x.slug === ss[0]?.level_slug);
        const wk = data.weekly.find((x) => x.week === w);
        if (!ss.length) return null;
        return (
          <section key={w} className="week card stack">
            <div className="row between"><h2 style={{ margin: 0 }}>{l?.emoji} Semana {w} · {l?.title}</h2><span className="muted small">{fmtDate(ss[0].scheduled_date)} – {fmtDate(ss.at(-1)!.scheduled_date)}</span></div>
            <div className="weekgrid scroll-x">
              {ss.map((s) => {
                const st = progress.sessState(me, s.day);
                return (
                  <Link key={s.day} to={`/sessao/${s.day}`} className={`day ${s.scheduled_date === today ? 'today' : ''}`} style={{ opacity: st === 'locked' ? .65 : 1 }}>
                    <div className="row between small muted"><span>{weekday(s.scheduled_date)} {fmtDate(s.scheduled_date)}</span><span>{sessIcon[st]}</span></div>
                    <div className="t">D{s.day} · {s.title}</div>
                    {wk && wk.session_day === s.day && <span className="badge amber">📦 Entrega</span>}
                  </Link>
                );
              })}
            </div>
            {wk && <div className="alert">📦 <b>{wk.title}</b> — {wk.description}</div>}
          </section>
        );
      })}
    </div>
  );
}
