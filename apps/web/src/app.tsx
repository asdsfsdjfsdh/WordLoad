import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { LoginPage } from './pages/LoginPage';
import { LobbyPage } from './pages/LobbyPage';
import { StageMapPage } from './pages/StageMapPage';
import { LevelMapPage } from './pages/LevelMapPage';
import { BattlePage } from './pages/BattlePage';
import { ExamPage } from './pages/ExamPage';
import { ResultPage } from './pages/ResultPage';
import { CharacterPage } from './pages/CharacterPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { StatsPage } from './pages/StatsPage';

// 阅读/后台按需加载（减小首屏 chunk）
const ReadingIndexPage = lazy(() => import('./pages/ReadingIndexPage').then((m) => ({ default: m.ReadingIndexPage })));
const ReadingPassagePage = lazy(() => import('./pages/ReadingPassagePage').then((m) => ({ default: m.ReadingPassagePage })));
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const AdminWordsPage = lazy(() => import('./pages/admin/AdminWordsPage').then((m) => ({ default: m.AdminWordsPage })));
const AdminReadingPage = lazy(() => import('./pages/admin/AdminReadingPage').then((m) => ({ default: m.AdminReadingPage })));
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AdminAuditPage = lazy(() => import('./pages/admin/AdminAuditPage').then((m) => ({ default: m.AdminAuditPage })));
const AdminFeedbackPage = lazy(() => import('./pages/admin/AdminFeedbackPage').then((m) => ({ default: m.AdminFeedbackPage })));

function PageFallback() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-500">加载中…</div>;
}

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
        path="/exam/:bankCode/:stageId"
        element={
          <RequireAuth>
            <ExamPage />
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
            <Suspense fallback={<PageFallback />}>
              <ReadingIndexPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/reading/passage/:passageId"
        element={
          <RequireAuth>
            <Suspense fallback={<PageFallback />}>
              <ReadingPassagePage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <Suspense fallback={<PageFallback />}>
              <AdminPage />
            </Suspense>
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="/admin/overview" replace />} />
        <Route path="overview" element={<Suspense fallback={<PageFallback />}><AdminOverviewPage /></Suspense>} />
        <Route path="words" element={<Suspense fallback={<PageFallback />}><AdminWordsPage /></Suspense>} />
        <Route path="reading" element={<Suspense fallback={<PageFallback />}><AdminReadingPage /></Suspense>} />
        <Route path="users" element={<Suspense fallback={<PageFallback />}><AdminUsersPage /></Suspense>} />
        <Route path="audit" element={<Suspense fallback={<PageFallback />}><AdminAuditPage /></Suspense>} />
        <Route path="feedback" element={<Suspense fallback={<PageFallback />}><AdminFeedbackPage /></Suspense>} />
      </Route>
      <Route path="*" element={<RequireAuth><Navigate to="/lobby" replace /></RequireAuth>} />
    </Routes>
  );
}