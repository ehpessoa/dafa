import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { DataProvider } from './lib/data';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Trail from './pages/Trail';
import SessionPage from './pages/Session';
import CalendarPage from './pages/Calendar';
import Library from './pages/Library';
import SqlEditor from './pages/SqlEditor';
import TeacherHome from './pages/teacher/TeacherHome';
import Queue from './pages/teacher/Queue';
import Review from './pages/teacher/Review';
import Students from './pages/teacher/Students';
import StudentDetail from './pages/teacher/StudentDetail';

function Gate() {
  const { profile, loading, isTeacher } = useAuth();
  if (loading) return <Spinner />;
  if (!profile) return <Login />;
  const teacherOnly = (el: JSX.Element) => (isTeacher ? el : <Navigate to="/" replace />);
  return (
    <DataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="trilha" element={<Trail />} />
          <Route path="sessao/:day" element={<SessionPage />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="biblioteca" element={<Library />} />
          <Route path="sql" element={<SqlEditor />} />
          <Route path="tutor" element={teacherOnly(<TeacherHome />)} />
          <Route path="tutor/fila" element={teacherOnly(<Queue />)} />
          <Route path="tutor/avaliar/:id" element={teacherOnly(<Review />)} />
          <Route path="tutor/alunos" element={teacherOnly(<Students />)} />
          <Route path="tutor/alunos/:id" element={teacherOnly(<StudentDetail />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}

export default function App() {
  return <BrowserRouter><AuthProvider><Gate /></AuthProvider></BrowserRouter>;
}
