import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import TemplateCard, { KIND } from '../components/TemplateCard';
import ResourceCard from '../components/ResourceCard';

export default function Library() {
  const { data } = useData();
  const [kind, setKind] = useState('todos');
  const [q, setQ] = useState('');
  const tpls = useMemo(() => data.templates.filter((t) => (kind === 'todos' || t.kind === kind) && (t.title + (t.description ?? '')).toLowerCase().includes(q.toLowerCase())), [data.templates, kind, q]);
  const cats = [...new Set(data.resources.map((r) => r.category))];
  return (
    <div className="stack">
      <div><h1>🧰 Biblioteca</h1><p className="muted">Downloads, acessos e templates reutilizáveis de todo o programa.</p></div>
      <section className="stack"><h2>📥 Recursos e downloads</h2>
        {cats.map((c) => <div key={c} className="stack"><h3 className="muted">{c}</h3><div className="grid g2">{data.resources.filter((r) => r.category === c).map((r) => <ResourceCard key={r.slug} r={r} />)}</div></div>)}
      </section>
      <section className="stack"><h2>📑 Templates</h2>
        <div className="row">
          <input type="text" placeholder="Buscar template…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} aria-label="Buscar template" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ maxWidth: 220 }} aria-label="Tipo de template">
            <option value="todos">Todos os tipos</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div className="grid g2">{tpls.map((t) => <TemplateCard key={t.slug} t={t} />)}</div>
      </section>
    </div>
  );
}
