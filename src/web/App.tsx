import { useEffect, useState, FormEvent } from 'react';
import { api, User, Project } from './api';
import { ProjectView } from './ProjectView';
import { DocsPage } from './DocsPage';
import { SalesPage } from './SalesPage';

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
  return <Shell user={user} onLogout={() => setUser(null)} />;
}

/* ── 登入 / 初始化 ── */
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

/* ── 主框架：首頁 → 各功能模組 ── */
type Page = 'home' | 'projects' | 'members' | 'docs' | 'sales';

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('home');
  const logout = async () => { await api.post('/api/auth/logout'); onLogout(); };

  if (page === 'projects') return <ProjectsPage user={user} onHome={() => setPage('home')} />;
  if (page === 'members') return <MembersPage onHome={() => setPage('home')} />;
  if (page === 'docs') return <DocsPage me={user} onHome={() => setPage('home')} />;
  if (page === 'sales') return <SalesPage me={user} onHome={() => setPage('home')} />;
  return <HomePage user={user} onOpen={setPage} onLogout={logout} />;
}

/* ── 首頁：功能模組 ── */
function HomePage({ user, onOpen, onLogout }: { user: User; onOpen: (p: Page) => void; onLogout: () => void }) {
  const [projCount, setProjCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  useEffect(() => {
    api.get<Project[]>('/api/projects').then(p => setProjCount(p.length)).catch(() => {});
    api.get<User[]>('/api/users').then(u => setUserCount(u.length)).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="home-head">
        <div>
          <div className="eyebrow">Cubic Teamwork</div>
          <h1>您好，{user.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted">{ROLE_LABEL[user.role]}</span>
          <button className="btn" onClick={onLogout}>登出</button>
        </div>
      </header>

      <div className="tile-grid">
        <button className="tile" onClick={() => onOpen('projects')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="5.5" cy="17" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="18.5" cy="17" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M10.8 8.2 6.8 14.8M13.2 8.2l4 6.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </span>
          <span className="tbody">
            <b>專案管理</b>
            <span className="tdesc">心智圖拆解模塊、任務樹排順序與條件、成員河流</span>
            <span className="tmeta">{projCount == null ? '…' : `${projCount} 個專案`}</span>
          </span>
          <span className="tarrow">→</span>
        </button>

        {user.role === 'admin' && (
          <button className="tile" onClick={() => onOpen('members')}>
            <span className="ticon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M3.2 19c.9-3 3.2-4.5 5.8-4.5s4.9 1.5 5.8 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="17" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16.2 14.6c2.3.1 4 1.4 4.7 3.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </span>
            <span className="tbody">
              <b>人員管理</b>
              <span className="tdesc">成員帳號、角色與權限</span>
              <span className="tmeta">{userCount == null ? '…' : `${userCount} 位成員`}</span>
            </span>
            <span className="tarrow">→</span>
          </button>
        )}

        <button className="tile" onClick={() => onOpen('docs')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 3.5h8L19 8v12.5H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M14 3.5V8h5M9 12h7M9 15.5h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </span>
          <span className="tbody">
            <b>文件中心</b>
            <span className="tdesc">線上編輯、全文搜尋、版本歷史與權限管理</span>
            <span className="tmeta">支援 PM 與 ERP 的文件庫</span>
          </span>
          <span className="tarrow">→</span>
        </button>

        <button className="tile" onClick={() => onOpen('sales')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M4 8.5l8 4.5 8-4.5M12 13v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>
          </span>
          <span className="tbody">
            <b>業務管理</b>
            <span className="tdesc">客戶、服務項目、報價單與訂單，成交直接開專案</span>
            <span className="tmeta">ERP 第一階段</span>
          </span>
          <span className="tarrow">→</span>
        </button>

        <div className="tile disabled" aria-disabled="true">
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M8 14.5l2.5-3 2.5 2 3-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span className="tbody">
            <b>財務報銷</b>
            <span className="tdesc">報價、請款與費用報銷</span>
            <span className="badge-soon">規劃中</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 專案管理模組 ── */
function ProjectsPage({ user, onHome }: { user: User; onHome: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState<Project | null>(null);
  const reload = () => api.get<Project[]>('/api/projects').then(setProjects);
  useEffect(() => { reload(); }, []);

  if (open) return <ProjectView project={open} me={user} onBack={() => { setOpen(null); reload(); }} />;

  const createProject = async () => {
    const name = prompt('專案名稱？');
    if (!name?.trim()) return;
    const r = await api.post<{ id: number }>('/api/projects', { name });
    const p = (await api.get<Project[]>('/api/projects')).find(x => x.id === r.id);
    await reload();
    if (p) setOpen(p);
  };

  return (
    <div className="app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>專案管理</h1></div>
        </div>
        {(user.role === 'admin' || user.role === 'pm') && <button className="btn primary" onClick={createProject}>＋ 新專案</button>}
      </header>
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

/* ── 人員管理模組 ── */
const COLORS = ['#C25E82', '#3E7CB8', '#4E9468', '#A5762F', '#7A5EA8', '#3B8B8F'];

function MembersPage({ onHome }: { onHome: () => void }) {
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

  const changeRole = async (u: User, role: string) => {
    await api.patch(`/api/users/${u.id}`, { role });
    await reload();
  };

  return (
    <div className="app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>人員管理</h1></div>
        </div>
      </header>
      <div className="card">
        {users.map(u => (
          <div key={u.id} className="member-row">
            <span className="av" style={{ background: u.color, width: 26, height: 26, fontSize: 12 }}>{u.name[0]}</span>
            <b>{u.name}</b>
            <span className="muted">{u.email}</span>
            <select value={u.role} onChange={e => changeRole(u, e.target.value)} style={{ width: 130, marginLeft: 'auto' }} aria-label={`${u.name} 的角色`}>
              <option value="member">成員</option>
              <option value="pm">專案負責人</option>
              <option value="admin">管理員</option>
            </select>
          </div>
        ))}
        <form onSubmit={add} className="member-add">
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
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          角色權限：管理員可管理成員與所有專案；專案負責人可建立專案；成員參與被加入的專案。
        </p>
      </div>
    </div>
  );
}
