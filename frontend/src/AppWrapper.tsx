import { useState, useEffect } from 'react';
import AdminLogin from './pages/AdminLogin';
import type { AdminSession } from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import AppOriginal from './App';

/** Entrada da aplicação: catálogo público por padrão; área administrativa em #admin. */
export default function AppWrapper() {
  const [showAdmin, setShowAdmin] = useState(() => window.location.hash === '#admin');
  const [adminData, setAdminData] = useState<AdminSession | null>(null);

  useEffect(() => {
    const handleHashChange = () => {
      setShowAdmin(window.location.hash === '#admin');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (showAdmin) {
    return (
      <div className="admin-app admin-shell">
        <a href="#" className="admin-back-link">
          &larr; Voltar para o Cardápio
        </a>
        {adminData ? (
          <AdminDashboard admin={adminData} onLogout={() => setAdminData(null)} />
        ) : (
          <AdminLogin onLogin={setAdminData} />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="admin-shortcut-wrap">
        <a href="#admin" className="admin-shortcut">
          Admin
        </a>
      </div>
      <AppOriginal />
    </>
  );
}
