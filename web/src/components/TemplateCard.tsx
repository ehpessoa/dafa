import { useEffect, useRef, useState } from 'react';
import type { Template } from '../lib/types';

export const KIND: Record<string, { icon: string; label: string }> = {
  sql: { icon: '🗄️', label: 'Query SQL' }, prompt: { icon: '🤖', label: 'Prompt de IA' }, diagram: { icon: '🧩', label: 'Diagrama' },
  excel: { icon: '📗', label: 'Planilha Excel' }, pbix: { icon: '📊', label: 'Power BI' }, checklist: { icon: '✅', label: 'Checklist' }, entrega: { icon: '📦', label: 'Modelo de entrega' },
};

function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
      try {
        const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), code);
        if (alive && ref.current) ref.current.innerHTML = svg;
      } catch (e) { if (alive) setErr(String(e)); }
    });
    return () => { alive = false; };
  }, [code]);
  return err ? <pre className="code">{code}</pre> : <div className="diagram" ref={ref}>Renderizando diagrama…</div>;
}

export default function TemplateCard({ t }: { t: Template }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const k = KIND[t.kind];
  const copy = async () => { try { await navigator.clipboard.writeText(t.content ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem permissão */ } };
  const download = () => {
    const blob = new Blob([t.content ?? ''], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = t.filename ?? `${t.slug}.txt`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="card flat">
      <div className="row between">
        <div><span className="badge blue">{k.icon} {k.label}</span><h3 style={{ margin: '8px 0 2px' }}>{t.title}</h3><div className="muted small">{t.description}</div></div>
        <div className="row">
          {t.url && <a className="btn primary sm" href={t.url} download>⬇ Baixar .xlsx</a>}
          {t.kind !== 'excel' && <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Ocultar' : t.kind === 'diagram' ? 'Ver diagrama' : 'Ver conteúdo'}</button>}
        </div>
      </div>
      {t.kind === 'excel' && <p className="small muted" style={{ marginTop: 10 }}>{t.content}</p>}
      {open && t.content && (
        <div style={{ marginTop: 12 }}>
          {t.kind === 'diagram' ? <Mermaid code={t.content} /> : <pre className="code">{t.content}</pre>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={copy}>{copied ? '✔ Copiado' : '📋 Copiar'}</button>
            <button className="btn sm" onClick={download}>⬇ Baixar arquivo</button>
            {t.kind === 'diagram' && <span className="small muted">Copie o código e cole em mermaid.live para editar.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
