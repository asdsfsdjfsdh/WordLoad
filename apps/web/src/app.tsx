import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { LoginPage } from './pages/LoginPage';
import { LobbyPage } from './pages/LobbyPage';
import { StageMapPage } from './pages/StageMapPage';
import { LevelMapPage } from './pages/LevelMapPage';
import { BattlePage } from './pages/BattlePage';
import { ResultPage } from './pages/ResultPage';
import { CharacterPage } from './pages/CharacterPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { StatsPage } from './pages/StatsPage';
import { ReadingIndexPage } from './pages/ReadingIndexPage';
import { ReadingPassagePage } from './pages/ReadingPassagePage';
import { AdminPage } from './pages/admin/AdminPage';
import { AdminWordsPage } from './pages/admin/AdminWordsPage';
import { AdminReadingPage } from './pages/admin/AdminReadingPage';

// 登录守卫：未登录重定向到 /login
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initialized } = useAuth();
  const location = useLocation();
  if (!initialized) return null; // 恢复中
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

// 已登录访问 /login → 跳大厅
function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, initialized } = useAuth();
  if (!initialized) return null;
  if (user) return <Navigate to="/lobby" replace />;
  return <>{children}</>;
}

// 管理员守卫：需登录且 isAdmin，否则跳大厅
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, initialized } = useAuth();
  const location = useLocation();
  if (!initialized) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.isAdmin) return <Navigate to="/lobby" replace />;
  return <>{children}</>;
}

export function App() {
  useEffect(() => {
    useAuth.getState().restore();
  }, []);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/lobby"
        element={
          <RequireAuth>
            <LobbyPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bank/:code/stages"
        element={
          <RequireAuth>
            <StageMapPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bank/:code/regions/:regionId/levels"
        element={
          <RequireAuth>
            <LevelMapPage />
          </RequireAuth>
        }
      />
      <Route
        path="/battle/:bankCode/:stageId"
        element={
          <RequireAuth>
            <BattlePage />
          </RequireAuth>
        }
      />
      <Route
        path="/result"
        element={
          <RequireAuth>
            <ResultPage />
          </RequireAuth>
        }
      />
      <Route
        path="/character"
        element={
          <RequireAuth>
            <CharacterPage />
          </RequireAuth>
        }
      />
      <Route
        path="/collections"
        element={
          <RequireAuth>
            <CollectionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/stats"
        element={
          <RequireAuth>
            <StatsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reading"
        element={
          <RequireAuth>
            <ReadingIndexPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reading/passage/:passageId"
        element={
          <RequireAuth>
            <ReadingPassagePage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="/admin/words" replace />} />
        <Route path="words" element={<AdminWordsPage />} />
        <Route path="reading" element={<AdminReadingPage />} />
      </Route>
      <Route path="*" element={<RequireAuth><Navigate to="/lobby" replace /></RequireAuth>} />
    </Routes>
  );
}