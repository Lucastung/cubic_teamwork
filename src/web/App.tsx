import { useEffect, useState, FormEvent } from 'react';
import { api, User, Project } from './api';
import { ProjectView } from './ProjectView';

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
      await api.post('/api/auth/setup', { email: f.get('email'), name: f.get('name'), password: f.get('password') });
      onDone();
    } catch (ex: any) { setErr(ex.message); }
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div><div className="eyebrow">首次使用</div><h1>建立管理員帳號</h1></div>
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
        <div><div className="eyebrow">Cubic Teamwork</div><h1>登入</h1></div>
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="密碼" required />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" type="submit">登入</button>
      </form>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: '管理員', pm: '專案負責人', member: '成員' };

function Home({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState<Project | null>(null);
  const [showUsers, setShowUsers] = useState(false);
  const reload = () => api.get<Project[]>('/api/projects').then(setProjects);
  useEffect(() => { reload(); }, []);

  if (open) return <ProjectView project={open} me={user} onBack={() => { setOpen(null); reload(); }} />;

  const createProject = async () => {
    const name = prompt('專案名稱？');
    if (!name?.trim()) return;
    const r = await api.post<{ id: number }>('/api/projects', { name });
    await reload();
    const p = (await api.get<Project[]>('/api/projects')).find(x => x.id === r.id);
    if (p) setOpen(p);
  };

  return (
    <div className="app">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div><div className="eyebrow">Cubic Teamwork</div><h1>專案</h1></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">{user.name}（{ROLE_LABEL[user.role]}）</span>
          {user.role === 'admin' && <button className="btn" onClick={() => setShowUsers(s => !s)}>成員管理</button>}
          {(user.role === 'admin' || user.role === 'pm') && <button className="btn primary" onClick={createProject}>＋ 新專案</button>}
          <button className="btn" onClick={async () => { await api.post('/api/auth/logout'); onLogout(); }}>登出</button>
        </div>
      </header>
      {showUsers && <UsersPanel />}
      {projects.length === 0
        ? <p className="muted">還沒有專案。{user.role !== 'member' && '按「＋ 新專案」開始。'}</p>
        : projects.map(p => (
          <button key={p.id} className="card proj-card" onClick={() => setOpen(p)}>
            <b>{p.name}</b><span className="muted">開啟 →</span>
          </button>
        ))}
    </div>
  );
}

const COLORS = ['#C25E82', '#3E7CB8', '#4E9468', '#A5762F', '#7A5EA8', '#3B8B8F'];

function UsersPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [err, setErr] = useState('');
  const reload = () => api.get<User[]>('/api/users').then(setUsers);
  useEffect(() => { reload(); }, []);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    setErr('');
    try {
      await api.post('/api/users', {
        name: f.get('name'), email: f.get('email'), password: f.get('password'),
        role: f.get('role'), color: COLORS[users.length % COLORS.length],
      });
      form.reset();
      await reload();
    } catch (ex: any) { setErr(ex.message); }
  };

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>團隊成員</div>
      {users.map(u => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span className="av" style={{ background: u.color, width: 22, height: 22, fontSize: 11 }}>{u.name[0]}</span>
          <b>{u.name}</b><span className="muted">{u.email}・{ROLE_LABEL[u.role]}</span>
        </div>
      ))}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input name="name" placeholder="姓名" required style={{ width: 110 }} />
        <input name="email" type="email" placeholder="Email" required style={{ width: 200 }} />
        <input name="password" type="password" placeholder="初始密碼（8 碼以上）" minLength={8} required style={{ width: 180 }} />
        <select name="role" defaultValue="member" style={{ width: 130 }}>
          <option value="member">成員</option>
          <option value="pm">專案負責人</option>
          <option value="admin">管理員</option>
        </select>
        <button className="btn primary" type="submit">新增成員</button>
      </form>
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
