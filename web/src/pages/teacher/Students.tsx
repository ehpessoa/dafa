import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useData } from '../../lib/data';
import { fmtDate } from '../../lib/progress';
import { Avatar, Empty, Progress } from '../../components/ui';

export default function Students() {
  const { data, progress, reload } = useData();
  const { token, profile } = useAuth();
  const [err, setErr] = useState('');
  const tutors = data.profiles.filter((p) => p.role === 'teacher');
  const demote = async (id: string, name: string | null) => {
    if (!window.confirm(`Tornar ${name ?? 'este usuário'} aluno(a)? Ele(a) perde o acesso às áreas de tutor.`)) return;
    setErr('');
    try { await api('app_set_role', { p_token: token, p_user_id: id, p_role: 'student' }); await reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const nav = useNavigate();
  const students = data.profiles.filter((p) => p.role === 'student');
  return (
    <div className="stack">
      <h1>👥 Alunos</h1>
      {students.length === 0 ? <Empty>Nenhum aluno ainda. Alunos aparecem assim que criam a conta.</Empty> : (
        <div className="card scroll-x"><table><thead><tr><th>Aluno</th><th style={{ minWidth: 160 }}>Progresso</th><th>Sessões</th><th>Nota média</th><th>Pendentes</th><th>Ajustes</th><th>Última entrega</th></tr></thead><tbody>
          {students.map((s) => { const x = progress.summary(s.id); return (
            <tr key={s.id} className="click" onClick={() => nav(`/tutor/alunos/${s.id}`)}>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={s.full_name} url={s.avatar_url} size={30} /><div><b>{s.full_name}</b><div className="small muted">{s.email}</div></div></div></td>
              <td><Progress pct={x.pct} /><span className="small muted">{x.pct}%</span></td><td>{x.doneSessions}/{x.totalSessions}</td><td>{x.avgScore?.toFixed(1) ?? '—'}</td><td>{x.pending}</td><td>{x.revisions}</td><td>{x.last ? fmtDate(x.last) : '—'}</td>
            </tr>); })}
        </tbody></table></div>
      )}
      <h2>🎓 Tutores</h2>
      {err && <div className="alert err" role="alert">{err}</div>}
      <div className="card scroll-x"><table><thead><tr><th>Tutor</th><th></th></tr></thead><tbody>
        {tutors.map((t) => (
          <tr key={t.id}>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={t.full_name} url={t.avatar_url} size={30} /><div><b>{t.full_name}</b>{t.id === profile?.id && ' (você)'}<div className="small muted">{t.email}</div></div></div></td>
            <td style={{ textAlign: 'right' }}>{t.id !== profile?.id && <button className="btn sm" type="button" onClick={() => void demote(t.id, t.full_name)}>Tornar aluno</button>}</td>
          </tr>))}
      </tbody></table></div>
      <p className="small muted" style={{ margin: 0 }}>Para adicionar um tutor: convide-o em <Link to="/tutor/convites">Convites</Link> (perfil Tutor) ou abra um aluno e use "Promover a tutor".</p>
      <Link to="/tutor">← Visão da turma</Link>
    </div>
  );
}
