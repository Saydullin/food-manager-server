import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium ${
    isActive
      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
  }`;

export function Layout() {
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 md:flex-row">
      <header className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800 md:hidden">
        <h1 className="text-lg font-semibold">Food Manager Admin</h1>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 rounded-md border border-neutral-300 dark:border-neutral-700"
        >
          <span
            className={`h-0.5 w-5 bg-current transition-transform duration-200 ${
              menuOpen ? 'translate-y-2 rotate-45' : ''
            }`}
          />
          <span
            className={`h-0.5 w-5 bg-current transition-opacity duration-200 ${
              menuOpen ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <span
            className={`h-0.5 w-5 bg-current transition-transform duration-200 ${
              menuOpen ? '-translate-y-2 -rotate-45' : ''
            }`}
          />
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={closeMenu} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 max-w-[80vw] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 p-4 transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-950 md:static md:w-56 md:max-w-none md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <h1 className="mb-6 hidden px-3 text-lg font-semibold md:block">Food Manager Admin</h1>
        <nav className="flex flex-col gap-1" onClick={closeMenu}>
          <NavLink to="/recipes" className={navLinkClass}>
            Recipes
          </NavLink>
          <NavLink to="/users" className={navLinkClass}>
            Users
          </NavLink>
          <NavLink to="/complaints" className={navLinkClass}>
            Complaints
          </NavLink>
        </nav>
        <button
          onClick={logout}
          className="mt-auto rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Log out
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
