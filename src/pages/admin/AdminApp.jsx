import { useState, useEffect } from 'react';
import AdminLogin from './AdminLogin.jsx';
import AdminDashboard from './AdminDashboard.jsx';

const TOKEN_KEY = 'caliber_admin_token';

export default function AdminApp() {
  const [token, setToken]   = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [role, setRole]     = useState('');
  const [username, setUsername] = useState('');
  const [checking, setChecking] = useState(!!localStorage.getItem(TOKEN_KEY));

  useEffect(() => {
    if (!token) { setChecking(false); return; }

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (d.username) { setUsername(d.username); setRole(d.role); }
        else logout();
      })
      .catch(logout)
      .finally(() => setChecking(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onLogin(data) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setRole(data.role);
    setUsername(data.username);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setRole('');
    setUsername('');
  }

  if (checking) return <div style={{ padding: 40, color: '#6b7280' }}>Loading…</div>;

  if (!token) return <AdminLogin onLogin={onLogin} />;

  return <AdminDashboard token={token} role={role} username={username} onLogout={logout} />;
}
