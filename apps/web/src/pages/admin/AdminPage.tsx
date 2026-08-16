// 后台管理布局
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../store/auth';

export function AdminPage() {
  const { user } = useAuth();
  if (!user?.isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        无管理员权限
      </div>
    );
  }
  const nav = [
    { to: '/admin/words', label: '单词库' },
    { to: '/admin/reading', label: '阅读库' },
  ];
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <h1 className="text-lg font-black tracking-wide text-cyan-300">后台管理</h1>
          <nav className="flex gap-2">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Link to="/lobby" className="ml-auto text-sm text-slate-400 transition hover:text-cyan-300">返回大厅</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
