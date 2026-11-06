import { useState } from 'react';
import { SUPABASE_URL } from '../lib/supabase';
import type { Resource } from '../lib/types';

export default function ResourceCard({ r }: { r: Resource }) {
  const [copied, setCopied] = useState(false);
  const isEnv = r.url.startsWith('{{');
  const url = isEnv ? SUPABASE_URL || '(configure VITE_SUPABASE_URL)' : r.url;
  const internal = r.url.startsWith('/');
  return (
    <div className="card flat">
      <div className="row between">
        <div style={{ flex: 1, minWidth: 220 }}>
          <span className="badge">{r.category}</span>
          <h3 style={{ margin: '8px 0 2px' }}>{r.title}</h3>
          <div className="muted small">{r.description}</div>
          {isEnv && <div className="row small" style={{ marginTop: 8 }}><code>{url}</code>
            <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>{copied ? '✔' : '📋 Copiar'}</button></div>}
        </div>
        {!isEnv && <a className="btn primary sm" href={r.url} {...(internal ? { download: true } : { target: '_blank', rel: 'noreferrer noopener' })}>{internal ? '⬇ Baixar' : 'Abrir ↗'}</a>}
      </div>
    </div>
  );
}
