import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { LoginPage } from './pages/LoginPage';
import { LobbyPage } from './pages/LobbyPage';
import { StageMapPage } from './pages/StageMapPage';
import { BattlePage } from './pages/BattlePage';
import { ResultPage } from './pages/ResultPage';
import { CharacterPage } from './pages/CharacterPage';

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

export function App() {
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

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
      <Route path="*" element={<Navigate to="/lobby" replace />} />
    </Routes>
  );
}