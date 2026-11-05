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
      <div className="admin-app" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <a href="#" style={{ display: 'inline-block', marginBottom: '1rem', color: '#0066cc', textDecoration: 'none' }}>
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
      <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 100 }}>
        <a href="#admin" style={{ background: 'rgba(0,0,0,0.5)', color: 'white', textDecoration: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
          Admin
        </a>
      </div>
      <AppOriginal />
    </>
  );
}
