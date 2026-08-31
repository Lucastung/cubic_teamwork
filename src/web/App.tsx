import { useEffect, useState, FormEvent } from 'react';
import { api, User, Project } from './api';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const st = await api.get<{ needsSetup: boolean }>('/api/auth/status');
        setNeedsSetup(st.needsSetup);
        if (!st.needsSetup) {
          try { setUser(await api.get<User>('/api/auth/me')); } catch { /* not logged in */ }
        }
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return null;
  if (needsSetup) return <Setup onDone={() => setNeedsSetup(false)} />;
  if (!user) return <Login onLogin={setUser} />;
  return <Home user={user} onLogout={() => setUser(null)} />;
}

function Setup({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.post('/api/auth/setup', {
        email: f.get('email'), name: f.get('name'), password: f.get('password'),
      });
      onDone();
    } catch (ex: any) { setErr(ex.message); }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div>
          <div className="eyebrow">首次使用</div>
          <h1>建立管理員帳號</h1>
        </div>
        <input name="name" placeholder="姓名" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="密碼（至少 8 碼）" minLength={8} required />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" type="submit">建立帳號</button>
      </form>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      onLogin(await api.post<User>('/api/auth/login', { email: f.get('email'), password: f.get('password') }));
    } catch (ex: any) { setErr(ex.message); }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div>
          <div className="eyebrow">Cubic Teamwork</div>
          <h1>登入</h1>
        </div>
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="密碼" required />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" type="submit">登入</button>
      </form>
    </div>
  );
}

function Home({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => { api.get<Project[]>('/api/projects').then(setProjects); }, []);

  const createProject = async () => {
    const name = prompt('專案名稱？');
    if (!name?.trim()) return;
    await api.post('/api/projects', { name });
    setProjects(await api.get<Project[]>('/api/projects'));
  };

  return (
    <div className="app">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Cubic Teamwork</div>
          <h1>專案</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted">{user.name}（{{ admin: '管理員', pm: '專案負責人', member: '成員' }[user.role]}）</span>
          {(user.role === 'admin' || user.role === 'pm') && (
            <button className="btn primary" onClick={createProject}>＋ 新專案</button>
          )}
          <button className="btn" onClick={async () => { await api.post('/api/auth/logout'); onLogout(); }}>登出</button>
        </div>
      </header>
      {projects.length === 0
        ? <p className="muted">還沒有專案。{user.role !== 'member' && '按「＋ 新專案」開始。'}</p>
        : projects.map(p => (
          <div key={p.id} className="card" style={{ marginBottom: 10, padding: '14px 18px' }}>
            <b>{p.name}</b>
            <span className="muted" style={{ marginLeft: 10 }}>心智圖／任務樹／河流 介面開發中</span>
          </div>
        ))}
    </div>
  );
}
