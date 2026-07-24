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

  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 p-4 dark:border-neutral-800">
        <h1 className="mb-6 px-3 text-lg font-semibold">Food Manager Admin</h1>
        <nav className="flex flex-col gap-1">
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
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
