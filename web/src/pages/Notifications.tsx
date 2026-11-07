import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { fmtDate } from '../lib/progress';
import { Empty } from '../components/ui';

export default function Notifications() {
  const { token } = useAuth();
  const { data, reload } = useData();
  const list = data.notifications;
  const unread = list.filter((n) => !n.read_at).length;
  const markAll = async () => { await api('app_notifications_read', { p_token: token, p_ids: null }); await reload(); };
  // ao abrir, as notificações continuam destacadas nesta visita e ficam lidas na próxima
  useEffect(() => { return () => { if (unread) void api('app_notifications_read', { p_token: token, p_ids: null }).then(reload).catch(() => {}); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const target = (subId: string | null) => {
    const s = data.submissions.find((x) => x.id === subId);
    const ex = s && data.exercises.find((e) => e.id === s.exercise_id);
    return ex ? `/sessao/${ex.session_day}?tab=exercicios` : null;
  };
  return (
    <div className="stack">
      <div className="row between"><div><h1>🔔 Notificações</h1><p className="muted">Resultados das suas entregas: aprovações, pedidos de ajuste e reprovações.</p></div>
        {unread > 0 && <button className="btn sm" onClick={markAll}>Marcar todas como lidas</button>}</div>
      {list.length === 0 ? <Empty>Nenhuma notificação ainda.</Empty> : list.map((n) => {
        const to = target(n.submission_id);
        return (
          <div key={n.id} className={`notif ${n.kind} ${n.read_at ? '' : 'unread'}`}>
            <div className="row between"><b>{n.title}</b><span className="small muted">{fmtDate(n.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div>{n.body}</div>
            {to && <div style={{ marginTop: 6 }}><Link className="btn sm" to={to}>Abrir exercício</Link></div>}
          </div>
        );
      })}
    </div>
  );
}
