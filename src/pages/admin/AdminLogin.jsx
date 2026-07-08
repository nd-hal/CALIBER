import { useState } from 'react';
import './admin.css';

export default function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Login failed'); return; }
      onLogin(data);
    } catch {
      setError('Cannot reach server. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adm-center">
      <form className="adm-card" onSubmit={handleSubmit}>
        <h1 className="adm-title">Admin Login</h1>
        <label className="adm-label">Username
          <input className="adm-input" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="adm-label">Password
          <input className="adm-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <p className="adm-error">{error}</p>}
        <button className="adm-btn" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
