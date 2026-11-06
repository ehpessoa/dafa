import type { ReactNode } from 'react';
import { EX_LABEL, SESS_LABEL, type ExState, type SessState } from '../lib/progress';

export const sessBadge: Record<SessState, string> = { locked: '', available: 'blue', in_progress: 'amber', review: 'amber', done: 'green' };
export const sessIcon: Record<SessState, string> = { locked: '🔒', available: '▶️', in_progress: '✏️', review: '⏳', done: '✅' };
export const exBadge: Record<ExState, string> = { todo: '', submitted: 'blue', revision: 'amber', approved: 'green' };

export const SessBadge = ({ s }: { s: SessState }) => <span className={`badge ${sessBadge[s]}`}>{sessIcon[s]} {SESS_LABEL[s]}</span>;
export const ExBadge = ({ s }: { s: ExState }) => <span className={`badge ${exBadge[s]}`}>{EX_LABEL[s]}</span>;

export function Spinner() { return <div className="spinner" role="status" aria-label="Carregando" />; }
export function Avatar({ name, url, size = 36 }: { name?: string | null; url?: string | null; size?: number }) {
  const style = { width: size, height: size };
  return url ? <img className="avatar" style={style} src={url} alt="" referrerPolicy="no-referrer" />
    : <div className="avatar" style={style}>{(name ?? '?').trim().charAt(0).toUpperCase()}</div>;
}
export function Progress({ pct, color }: { pct: number; color?: string }) {
  return <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%`, background: color }} /></div>;
}
export function Ring({ pct, size = 120, label }: { pct: number; size?: number; label?: ReactNode }) {
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${pct}% concluído`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--slate-soft)" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><div style={{ fontSize: size / 4.2, fontWeight: 800 }}>{pct}%</div>{label && <div className="muted small">{label}</div>}</div>
      </div>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) { return <div className="card center muted">{children}</div>; }
export function ErrorBox({ msg }: { msg: string }) { return <div className="alert err">⚠️ {msg}</div>; }
