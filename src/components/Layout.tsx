import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderArchive, Hammer, Wrench, Server, LogOut, Globe, KeyRound, Send } from 'lucide-react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/web', label: 'Web → APK', icon: Globe },
  { to: '/projects', label: 'Projects', icon: FolderArchive },
  { to: '/builds', label: 'Builds', icon: Hammer },
  { to: '/toolchains', label: 'Toolchains', icon: Wrench },
  { to: '/agents', label: 'Servers', icon: Server },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/telegram', label: 'Telegram', icon: Send },
];

export default function Layout() {
  const { user } = useAuth();
  const nav = useNavigate();
  const signOut = async () => { await supabase.auth.signOut(); nav('/login'); };

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 z-30 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur lg:flex">
        <div className="px-6 py-6"><Logo /></div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${isActive ? 'bg-droid/10 text-droid' : 'text-mute hover:bg-panel2 hover:text-ink'}`}>
              <n.icon className="h-4 w-4" />
              <span className="font-medium">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-4">
          <div className="truncate font-mono text-xs text-mute">{user?.email}</div>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm text-mute hover:text-danger">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo small />
        <button onClick={signOut} className="text-mute hover:text-danger" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
      </header>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-6 sm:px-8 lg:pb-12 lg:pt-10">
        <div className="mx-auto max-w-6xl"><Outlet /></div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-panel/95 backdrop-blur lg:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `flex min-w-[68px] flex-1 shrink-0 flex-col items-center gap-1 px-1 py-2.5 text-[10px] ${isActive ? 'text-droid' : 'text-mute'}`}>
            <n.icon className="h-5 w-5" />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
