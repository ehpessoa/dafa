import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import type { SessState } from '../lib/progress';

const FILL: Record<SessState, string> = { locked: '#94a3b8', available: '#2563eb', in_progress: '#d97706', review: '#d97706', done: '#16a34a' };

/** Mapa estilo "metrô": 3 faixas (níveis), cada nó = 1 sessão, setas = dependências. */
export default function DepGraph({ stateOf, highlight }: { stateOf: (day: number) => SessState; highlight?: number }) {
  const { data } = useData();
  const nav = useNavigate();
  const lane = (slug: string) => data.levels.findIndex((l) => l.slug === slug);
  const pos = new Map(data.sessions.map((s) => {
    const idxInLevel = data.sessions.filter((x) => x.level_slug === s.level_slug && x.day < s.day).length;
    return [s.day, { x: 60 + idxInLevel * 92, y: 70 + lane(s.level_slug) * 120 }];
  }));
  const W = 60 * 2 + 9 * 92, H = 70 * 2 + 2 * 120 - 20;
  return (
    <div className="scroll-x">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 760, width: '100%' }} role="img" aria-label="Mapa de dependências entre sessões">
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#94a3b8" /></marker></defs>
        {data.levels.map((l, i) => (
          <g key={l.slug}>
            <rect x="4" y={70 + i * 120 - 46} width={W - 8} height="92" rx="14" fill={l.color ?? '#2563eb'} opacity=".07" />
            <text x="14" y={70 + i * 120 - 30} fontSize="12" fontWeight="700" fill={l.color ?? '#2563eb'}>{l.emoji} {l.title.toUpperCase()}</text>
          </g>
        ))}
        {data.deps.map((d) => {
          const a = pos.get(d.requires_day), b = pos.get(d.day);
          if (!a || !b) return null;
          const same = a.y === b.y;
          const path = same ? `M${a.x + 18},${a.y} L${b.x - 20},${b.y}` : `M${a.x},${a.y + 18} C${a.x},${(a.y + b.y) / 2 + 20} ${b.x},${(a.y + b.y) / 2 - 20} ${b.x},${b.y - 20}`;
          return <path key={`${d.requires_day}-${d.day}`} d={path} fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arr)" opacity=".75" />;
        })}
        {data.sessions.map((s) => {
          const p = pos.get(s.day)!, st = stateOf(s.day);
          return (
            <g key={s.day} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} onClick={() => nav(`/sessao/${s.day}`)} tabIndex={0}
               onKeyDown={(e) => e.key === 'Enter' && nav(`/sessao/${s.day}`)} role="link" aria-label={`Dia ${s.day}: ${s.title} (${st})`}>
              <title>{`Dia ${s.day} – ${s.title}`}</title>
              <circle r="19" fill={FILL[st]} stroke={highlight === s.day ? '#0f172a' : 'none'} strokeWidth="3" />
              <text textAnchor="middle" dy=".35em" fill="#fff" fontWeight="800" fontSize="13">{st === 'done' ? '✓' : s.day}</text>
              <text textAnchor="middle" y="34" fontSize="9.5" fill="var(--muted)">{s.title.length > 15 ? s.title.slice(0, 14) + '…' : s.title}</text>
            </g>
          );
        })}
      </svg>
      <div className="chips small" style={{ marginTop: 8 }}>
        {(['locked', 'available', 'in_progress', 'done'] as SessState[]).map((k) => (
          <span key={k} className="chip"><span style={{ color: FILL[k] }}>●</span> {({ locked: 'Bloqueada', available: 'Disponível', in_progress: 'Em andamento / aguardando tutor', review: '', done: 'Concluída' } as Record<SessState, string>)[k]}</span>
        ))}
        <span className="chip">➜ "precisa estar aprovada antes"</span>
      </div>
    </div>
  );
}
