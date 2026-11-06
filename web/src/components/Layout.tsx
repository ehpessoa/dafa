import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { Avatar, ErrorBox, Spinner } from './ui';

const link = (to: string, icon: string, label: string, end = false) => (
  <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{icon} {label}</NavLink>
);

export default function Layout() {
  const { profile, isTeacher, signOut } = useAuth();
  const { loading, error } = useData();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const onTeacherArea = loc.pathname.startsWith('/tutor');
  return (
    <div className="app">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><div className="logo">📊</div> DAFA</div>
        <nav className="nav">
          <div className="group">Aluno</div>
          {link('/', '🏠', 'Meu painel', true)}
          {link('/trilha', '🗺️', 'Trilha & dependências')}
          {link('/calendario', '📅', 'Calendário 30 dias')}
          {link('/biblioteca', '🧰', 'Biblioteca de recursos')}
          {link('/sql', '🧮', 'Editor SQL')}
          {isTeacher && (<>
            <div className="group">Tutor</div>
            {link('/tutor', '📈', 'Visão da turma', true)}
            {link('/tutor/fila', '📝', 'Fila de avaliação')}
            {link('/tutor/alunos', '👥', 'Alunos')}
          </>)}
        </nav>
        <div className="userbox">
          <Avatar name={profile?.full_name ?? profile?.email} url={profile?.avatar_url} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.full_name}</div>
            <div className="small muted">{isTeacher ? '🎓 Tutor' : '🧑‍🎓 Aluno'}{onTeacherArea ? ' · modo tutor' : ''}</div>
          </div>
          <button className="btn sm" onClick={signOut} title="Sair">Sair</button>
        </div>
      </aside>
      <div>
        <div className="topbar"><button className="btn sm" onClick={() => setOpen(true)} aria-label="Abrir menu">☰</button><b>DAFA</b><button className="btn sm" style={{ marginLeft: 'auto' }} onClick={signOut}>Sair</button></div>
        <main className="main">
          {error && <ErrorBox msg={`Erro ao carregar dados: ${error}. Verifique se as migrations do Supabase foram aplicadas.`} />}
          {loading ? <Spinner /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
