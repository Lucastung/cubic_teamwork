import { useEffect, useState, FormEvent } from 'react';
import { api, User, Project } from './api';
import { ProjectView } from './ProjectView';
import { DocsPage } from './DocsPage';
import { SalesPage } from './SalesPage';
import { FinPage } from './FinPage';
import { HomeTodo } from './HomeTodo';
import { InvPage } from './InvPage';
import { HRPage } from './HRPage';
import { ProgressPage, TaskDetailModal } from './ProgressPage';
import { TaskPage } from './TaskPage';
import { Model, STATE_LABEL, fdate, todayStr } from './model';
import type { Node, Dep } from './api';

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

  const taskRoute = (() => {
    const m = window.location.pathname.match(/^\/task\/(\d+)$/);
    return m ? Number(m[1]) : null;
  })();

  if (loading) return null;
  if (needsSetup) return <Setup onDone={() => setNeedsSetup(false)} />;
  if (!user) return <Login onLogin={setUser} />;
  if (taskRoute != null) return <TaskPage id={taskRoute} me={user} />;
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
        <img src="/logo.png" alt="Cubic Teamwork" className="brand-logo" />
        <div style={{ textAlign: 'center' }}><div className="eyebrow">Cubic Teamwork</div><h1>登入</h1></div>
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
type Page = 'home' | 'projects' | 'members' | 'docs' | 'sales' | 'progress' | 'finance' | 'hr' | 'inventory';

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('home');
  const [can, setCan] = useState<Record<string, boolean> | null>(null);
  useEffect(() => { api.get<Record<string, boolean>>('/api/my-perms').then(setCan).catch(() => {}); }, []);
  const logout = async () => { await api.post('/api/auth/logout'); onLogout(); };

  if (page === 'projects') return <ProjectsPage user={user} onHome={() => setPage('home')} />;
  if (page === 'members') return <MembersPage onHome={() => setPage('home')} />;
  if (page === 'docs') return <DocsPage me={user} onHome={() => setPage('home')} />;
  if (page === 'sales') return <SalesPage me={user} onHome={() => setPage('home')} can={can ?? undefined} />;
  if (page === 'progress') return <ProgressPage me={user} onHome={() => setPage('home')} />;
  if (page === 'finance') return <FinPage me={user} onHome={() => setPage('home')} can={can ?? undefined} />;
  if (page === 'hr') return <HRPage me={user} onHome={() => setPage('home')} />;
  if (page === 'inventory') return <InvPage me={user} onHome={() => setPage('home')} can={can ?? undefined} />;
  return <HomePage user={user} onOpen={setPage} onLogout={logout} can={can} />;
}

/* ── 首頁：功能模組 ── */
function HomePage({ user, onOpen, onLogout, can }: { user: User; onOpen: (p: Page) => void; onLogout: () => void; can: Record<string, boolean> | null }) {
  const show = (m: string) => can == null || can[m] !== false;
  const [projCount, setProjCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [prog, setProg] = useState<{ projects: { id: number; name: string }[]; nodes: Node[]; deps: Dep[] } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const load = () => {
    api.get<any>('/api/progress').then(d => { setProg(d); setProjCount(d.projects.length); }).catch(() => {});
    api.get<User[]>('/api/users').then(u => { setUsers(u); setUserCount(u.length); }).catch(() => {});
    api.get<any>('/api/me/profile').then(setProfile).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const model = prog ? new Model(prog.nodes, prog.deps, users) : null;
  const pname = new Map((prog?.projects ?? []).map(p => [p.id, p.name]));
  const today = todayStr();
  const myTasks = model
    ? model.allTasks().filter(t => t.owner_id === user.id && model.pendingForOwner(t))
        .sort((a, b) => ((a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1))
    : [];
  const readyN = model ? myTasks.filter(t => model.stateOf(t) === 'ready').length : 0;
  const overN = myTasks.filter(t => t.due && t.due < today).length;
  const shown = myTasks.slice(0, 8);
  const toSign = model && (user.role === 'admin' || user.role === 'pm')
    ? model.allTasks().filter(t => t.stage === 'done' && t.needs_sign && t.done_by !== user.id)
        .sort((a, b) => ((a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1))
    : [];

  return (
    <div className="app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <img src="/logo.png" alt="" style={{ width: 44, height: 44 }} />
          <div>
            <div className="eyebrow">Cubic Teamwork</div>
            <h1>您好，{user.name}</h1>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(() => {
            const meRow: any = users.find(x => x.id === user.id);
            return meRow?.avatar_key
              ? <img src={`/api/files/${meRow.avatar_key}`} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }} onClick={() => onOpen('hr')} title="人事管理" />
              : <span className="av" style={{ background: user.color, width: 30, height: 30, fontSize: 13, cursor: 'pointer' }} onClick={() => onOpen('hr')} title="人事管理">{user.name[0]}</span>;
          })()}
          <span className="muted">{ROLE_LABEL[user.role]}</span>
          <button className="btn" onClick={onLogout}>登出</button>
        </div>
      </header>

      {(() => {
        // 近 30 天個人績效（以進行中專案的任務計）
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const myDone30 = model
          ? model.allTasks().filter(t => t.owner_id === user.id && t.done_at && t.done_at.slice(0, 10) >= cutoff)
          : [];
        const withDue = myDone30.filter(t => t.due);
        const onTime = withDue.filter(t => t.done_at!.slice(0, 10) <= t.due!);
        const onTimeRate = withDue.length ? Math.round((onTime.length / withDue.length) * 100) : null;
        return (
          <div className="banner dash">
            <div className="dash-id">
              {profile?.avatar_key
                ? <img className="dash-av" src={`/api/files/${profile.avatar_key}`} alt="" />
                : <span className="av dash-av" style={{ background: user.color, fontSize: 26 }}>{user.name[0]}</span>}
              <div style={{ minWidth: 0 }}>
                <div className="banner-date mono">{new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })}</div>
                <div className="dash-name">{user.name}<span className="stchip st-blue" style={{ marginLeft: 8 }}>{ROLE_LABEL[user.role]}</span></div>
                <div className="dash-skills">
                  {(profile?.skills ?? []).map((s: any) => <span key={s.id} className="skill-badge">{s.name}</span>)}
                  {profile && !profile.skills?.length && <span className="muted" style={{ fontSize: 12 }}>尚未設定專長</span>}
                </div>
              </div>
            </div>
            <div className="dash-stats">
              <div className="dstat"><b className="mono">{myTasks.length}</b><span>待完成</span></div>
              <div className="dstat"><b className="mono" style={{ color: 'var(--accent)' }}>{readyN}</b><span>可開始</span></div>
              <div className="dstat"><b className="mono" style={overN > 0 ? { color: 'var(--danger)' } : {}}>{overN}</b><span>已逾期</span></div>
              <div className="dstat"><b className="mono" style={{ color: 'var(--ok)' }}>{myDone30.length}</b><span>30 天完成</span></div>
              <div className="dstat" title="近 30 天有交期的任務中，在期限內完成的比例">
                <b className="mono" style={{ color: 'var(--ok)' }}>{onTimeRate == null ? '—' : `${onTimeRate}%`}</b><span>準時率</span></div>
              {toSign.length > 0 && <div className="dstat"><b className="mono" style={{ color: 'var(--warn)' }}>{toSign.length}</b><span>待簽核</span></div>}
            </div>
          </div>
        );
      })()}

      {shown.length > 0 && (
        <div className="mytasks card">
          <div className="side-label" style={{ margin: '0 0 6px', display: 'flex', justifyContent: 'space-between' }}>
            <span>我的待辦（依 deadline）</span>
            <button className="btn subtle" onClick={() => onOpen('progress')}>進度管理 →</button>
          </div>
          {shown.map(t => {
            const s = model!.stateOf(t);
            const over = !!t.due && t.due < today;
            return (
              <button key={t.id} className="mytask-row" onClick={() => setOpenTask(t.id)}>
                <span className={`tdot ${s}`} aria-hidden="true" />
                <span className="mytask-title">{t.title}</span>
                <span className="muted mytask-proj">{pname.get(t.project_id) ?? ''}</span>
                <span className={`due mono ${over ? 'over' : ''}`}>{over ? '逾期 ' : ''}{t.due ? fdate(t.due) : '—'}</span>
                <span className="state-lab" style={{ width: 'auto' }}>{s === 'locked' ? '等前置' : STATE_LABEL[s]}</span>
              </button>
            );
          })}
          {myTasks.length > shown.length && (
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>還有 {myTasks.length - shown.length} 項，到「進度管理」看完整河流。</p>
          )}
        </div>
      )}

      <HomeTodo me={user} toSign={toSign} pname={pname} users={users}
        onOpenTask={setOpenTask} onChanged={load} />

      {openTask != null && model?.byId(openTask) && (
        <TaskDetailModal model={model} t={model.byId(openTask)!} pname={pname} me={user}
          onClose={() => setOpenTask(null)} onChanged={load} />
      )}

      <div className="tile-grid">
        {show('module.projects') && (<button className="tile t-proj" onClick={() => onOpen('projects')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="5.5" cy="17" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="18.5" cy="17" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M10.8 8.2 6.8 14.8M13.2 8.2l4 6.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </span>
          <span className="tbody">
            <b>專案管理</b>
            <span className="tdesc">心智圖拆解模塊、任務樹排順序與條件、成員河流</span>
            <span className="tmeta">{projCount == null ? '…' : `${projCount} 個專案`}</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}

        {user.role === 'admin' && (
          <button className="tile t-sys" onClick={() => onOpen('members')}>
            <span className="ticon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M3.2 19c.9-3 3.2-4.5 5.8-4.5s4.9 1.5 5.8 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="17" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M16.2 14.6c2.3.1 4 1.4 4.7 3.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </span>
            <span className="tbody">
              <b>系統管理</b>
              <span className="tdesc">成員帳號與角色、專長標籤池、系統備份還原</span>
              <span className="tmeta">{userCount == null ? '…' : `${userCount} 位成員`}</span>
            </span>
            <span className="tarrow">→</span>
          </button>
        )}

        {show('module.hr') && (<button className="tile t-hr" onClick={() => onOpen('hr')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M5 20c1-3.6 3.8-5.4 7-5.4s6 1.8 7 5.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </span>
          <span className="tbody">
            <b>人事管理</b>
            <span className="tdesc">個人資料與頭像、更換密碼、專長、差勤請假</span>
            <span className="tmeta">請假送出後由主管核准</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}

        {show('module.progress') && (<button className="tile t-prog" onClick={() => onOpen('progress')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 5.5h9M4 10h13M4 14.5h7M4 19h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span className="tbody">
            <b>進度管理</b>
            <span className="tdesc">跨專案的成員河流與甘特圖，可勾選要顯示的專案</span>
            <span className="tmeta">全公司進度一眼看完</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}

        {show('module.docs') && (<button className="tile t-docs" onClick={() => onOpen('docs')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 3.5h8L19 8v12.5H6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M14 3.5V8h5M9 12h7M9 15.5h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </span>
          <span className="tbody">
            <b>文件中心</b>
            <span className="tdesc">線上編輯、全文搜尋、版本歷史與權限管理</span>
            <span className="tmeta">支援 PM 與 ERP 的文件庫</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}

        {show('module.sales') && (<button className="tile t-sales" onClick={() => onOpen('sales')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M4 8.5l8 4.5 8-4.5M12 13v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>
          </span>
          <span className="tbody">
            <b>業務管理</b>
            <span className="tdesc">客戶、服務項目、報價單與訂單，成交直接開專案</span>
            <span className="tmeta">成交自動套用交付模版</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}

        {show('module.inventory') && (<button className="tile t-inv" onClick={() => onOpen('inventory')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M4 8.5l8 4.5 8-4.5M12 13v8M8 6.3l8 4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>
          </span>
          <span className="tbody">
            <b>庫存與生產</b>
            <span className="tdesc">料號主檔、批號效期庫存、BOM 與生產單</span>
            <span className="tmeta">低庫存與到期自動警示</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}

        {show('module.finance') && (<button className="tile t-fin" onClick={() => onOpen('finance')}>
          <span className="ticon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M8 14.5l2.5-3 2.5 2 3-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span className="tbody">
            <b>財務管理</b>
            <span className="tdesc">費用報銷（兩層簽核）、請款收款與應收帳款</span>
            <span className="tmeta">報銷沿用電子簽章鏈</span>
          </span>
          <span className="tarrow">→</span>
        </button>)}
      </div>
    </div>
  );
}

/* ── 專案管理模組 ── */
function ProjectsPage({ user, onHome }: { user: User; onHome: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [open, setOpen] = useState<Project | null>(null);
  const canWrite = user.role === 'admin' || user.role === 'pm';
  const reload = () => {
    api.get<Project[]>('/api/projects').then(setProjects);
    if (canWrite) api.get<any[]>('/api/templates').then(setTemplates).catch(() => {});
  };
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
      {canWrite && (
        <>
          <div className="side-label" style={{ margin: '26px 4px 10px', display: 'flex', justifyContent: 'space-between' }}>
            <span>專案模版（服務項目可掛模版，訂單開專案時自動套用）</span>
            <button className="btn" onClick={async () => {
              const name = prompt('模版名稱？（例如：全基因體定序交付流程）');
              if (!name?.trim()) return;
              const r = await api.post<{ id: number }>('/api/templates', { name });
              reload();
              setOpen({ id: r.id, name: name.trim(), status: 'active', kind: 'template', my_role: null });
            }}>＋ 新模版</button>
          </div>
          {templates.map(t => (
            <button key={t.id} className="card proj-card" onClick={() => setOpen({ ...t, kind: 'template' })}>
              <span><b>{t.name}</b><span className="muted" style={{ marginLeft: 8 }}>{t.task_count} 項任務</span></span>
              <span className="muted">編輯模版 →</span>
            </button>
          ))}
          {!templates.length && <p className="muted">還沒有模版——建一個，把你們服務的標準交付流程存起來。</p>}
        </>
      )}
    </div>
  );
}

/* ── 系統管理模組（僅管理員）── */
const COLORS = ['#C25E82', '#3E7CB8', '#4E9468', '#A5762F', '#7A5EA8', '#3B8B8F'];

function MembersPage({ onHome }: { onHome: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [err, setErr] = useState('');
  const [tags, setTags] = useState<any[]>([]);
  const [userSkills, setUserSkills] = useState<{ user_id: number; tag_id: number; name: string }[]>([]);
  const [newTag, setNewTag] = useState('');
  const reload = () => {
    api.get<User[]>('/api/users').then(setUsers);
    api.get<any[]>('/api/skill-tags').then(setTags).catch(() => {});
    api.get<any[]>('/api/user-skills').then(setUserSkills).catch(() => {});
  };
  useEffect(() => { reload(); }, []);

  const skillsOf = (uid: number) => userSkills.filter(s => s.user_id === uid).map(s => s.tag_id);
  const toggleSkill = async (uid: number, tagId: number) => {
    const cur = skillsOf(uid);
    const next = cur.includes(tagId) ? cur.filter(t => t !== tagId) : [...cur, tagId];
    await api.put(`/api/users/${uid}/skills`, { tag_ids: next });
    reload();
  };
  const addTag = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    try { await api.post('/api/skill-tags', { name: newTag }); setNewTag(''); reload(); }
    catch (ex: any) { setErr(ex.message); }
  };

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
          <div><div className="eyebrow">功能模組</div><h1>系統管理</h1></div>
        </div>
      </header>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">成員與角色（點專長標籤可指派／移除）</div>
        {users.map(u => (
          <div key={u.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
            <div className="member-row" style={{ border: 'none', padding: '2px 0' }}>
              {(u as any).avatar_key
                ? <img src={`/api/files/${(u as any).avatar_key}`} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
                : <span className="av" style={{ background: u.color, width: 26, height: 26, fontSize: 12 }}>{u.name[0]}</span>}
              <b>{u.name}</b>
              <span className="muted">{u.email}</span>
              <select value={u.role} onChange={e => changeRole(u, e.target.value)} style={{ width: 130, marginLeft: 'auto' }} aria-label={`${u.name} 的角色`}>
                <option value="member">成員</option>
                <option value="pm">專案負責人</option>
                <option value="admin">管理員</option>
              </select>
            </div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0 4px 34px' }}>
                {tags.map(t => {
                  const on = skillsOf(u.id).includes(t.id);
                  return (
                    <button key={t.id} className={`stchip ${on ? 'st-blue' : 'st-grey'}`}
                      style={{ cursor: 'pointer', border: 'none', opacity: on ? 1 : 0.55 }}
                      title={on ? '點擊移除這個專長' : '點擊指派這個專長'}
                      onClick={() => toggleSkill(u.id, t.id)}>{t.name}</button>
                  );
                })}
              </div>
            )}
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
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">專長標籤池（供上方指派，也是未來任務配發的參考）</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0' }}>
          {tags.map(t => (
            <span key={t.id} className="stchip st-blue" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {t.name}<span className="muted" style={{ fontSize: 11 }}>{t.user_count}</span>
              <button className="btn subtle" style={{ padding: '0 4px', minWidth: 0, height: 18, lineHeight: 1 }}
                onClick={async () => {
                  if (confirm(`刪除標籤「${t.name}」？（會從所有成員身上移除）`)) { await api.del(`/api/skill-tags/${t.id}`); reload(); }
                }}>✕</button>
            </span>
          ))}
          {!tags.length && <span className="muted">還沒有專長標籤，例如：定序分析、報告撰寫、專案管理、客戶溝通…</span>}
        </div>
        <form onSubmit={addTag} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={newTag} placeholder="新標籤名稱" onChange={e => setNewTag(e.target.value)} style={{ width: 200 }} />
          <button className="btn" type="submit">＋ 新增標籤</button>
        </form>
      </div>
      <PermMatrix />
      <BackupPanel />
    </div>
  );
}

/* ── 角色權限表（管理員）── */
const PERM_ROWS: { group: string; key: string; label: string }[] = [
  { group: '模組可見性', key: 'module.projects', label: '專案管理' },
  { group: '模組可見性', key: 'module.progress', label: '進度管理' },
  { group: '模組可見性', key: 'module.docs', label: '文件中心' },
  { group: '模組可見性', key: 'module.sales', label: '業務管理' },
  { group: '模組可見性', key: 'module.finance', label: '財務管理' },
  { group: '模組可見性', key: 'module.hr', label: '人事管理' },
  { group: '模組可見性', key: 'module.inventory', label: '庫存與生產' },
  { group: '功能權限', key: 'act.project.create', label: '建立專案與專案模版' },
  { group: '功能權限', key: 'act.sales.write', label: '業務單據建立與編輯（客戶／報價／訂單）' },
  { group: '功能權限', key: 'act.invoice.write', label: '請款與收款操作' },
  { group: '功能權限', key: 'act.expense.approve', label: '報銷核准／退回' },
  { group: '功能權限', key: 'act.expense.pay', label: '報銷付款確認' },
  { group: '功能權限', key: 'act.leave.approve', label: '請假核准／退回' },
  { group: '功能權限', key: 'act.inv.master', label: '料號／BOM／生產單管理' },
  { group: '功能權限', key: 'act.inv.moves', label: '庫存出入庫登記' },
  { group: '功能權限', key: 'act.doc.template', label: '表單模版與引索維護' },
];

function PermMatrix() {
  const [roles, setRoles] = useState<{ member: Record<string, boolean>; pm: Record<string, boolean> } | null>(null);
  const [saved, setSaved] = useState(false);
  const reload = () => api.get<any>('/api/role-perms').then(d => setRoles(d.roles)).catch(() => {});
  useEffect(() => { reload(); }, []);
  if (!roles) return null;

  const toggle = async (role: 'member' | 'pm', perm: string) => {
    const next = !roles[role][perm];
    setRoles({ ...roles, [role]: { ...roles[role], [perm]: next } });
    await api.put('/api/role-perms', { changes: [{ role, perm, allowed: next }] });
    setSaved(true); setTimeout(() => setSaved(false), 1200);
  };

  let lastGroup = '';
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="side-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>角色權限表（勾選即生效）</span>
        {saved && <span style={{ color: 'var(--accent)', fontSize: 12 }}>已儲存 ✓</span>}
      </div>
      <div className="erp-thead">
        <span style={{ flex: 1 }}>權限項目</span>
        <span style={{ width: 70, textAlign: 'center' }}>成員</span>
        <span style={{ width: 90, textAlign: 'center' }}>專案負責人</span>
        <span style={{ width: 70, textAlign: 'center' }}>管理員</span>
      </div>
      {PERM_ROWS.map(row => {
        const groupHead = row.group !== lastGroup;
        lastGroup = row.group;
        return (
          <div key={row.key}>
            {groupHead && <div className="side-label" style={{ margin: '8px 0 2px' }}>{row.group}</div>}
            <div className="erp-trow" style={{ alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 13.5 }}>{row.label}</span>
              <span style={{ width: 70, textAlign: 'center' }}>
                <input type="checkbox" checked={!!roles.member[row.key]} onChange={() => toggle('member', row.key)} aria-label={`成員：${row.label}`} />
              </span>
              <span style={{ width: 90, textAlign: 'center' }}>
                <input type="checkbox" checked={!!roles.pm[row.key]} onChange={() => toggle('pm', row.key)} aria-label={`專案負責人：${row.label}`} />
              </span>
              <span style={{ width: 70, textAlign: 'center' }} title="管理員固定全開">
                <input type="checkbox" checked disabled />
              </span>
            </div>
          </div>
        );
      })}
      <p className="muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
        「不能核准自己的單據」「簽核需重輸密碼」等第二人原則為固定規則，不受此表影響。成員重新整理頁面後生效。
      </p>
    </div>
  );
}

/* ── 系統備份與還原（管理員）── */
function BackupPanel() {
  const [backups, setBackups] = useState<{ key: string; size: number; uploaded: string }[]>([]);
  const [target, setTarget] = useState<
    { kind: 'key'; key: string } | { kind: 'file'; backup: any; name: string } | { kind: 'files'; file: File; name: string } | null>(null);
  const [pw, setPw] = useState('');
  const [confirmTxt, setConfirmTxt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const reload = () => api.get<any[]>('/api/backups').then(setBackups).catch(() => {});
  useEffect(() => { reload(); }, []);

  const downloadBackup = async () => {
    const res = await fetch('/api/backup');
    if (!res.ok) { alert('備份失敗'); return; }
    const blob = await res.blob();
    const date = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cubic-backup-${date}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const doRestore = async () => {
    setErr(''); setBusy(true);
    try {
      if (target!.kind === 'files') {
        const fd = new FormData();
        fd.append('file', (target as any).file);
        fd.append('password', pw);
        fd.append('confirm', confirmTxt);
        const res = await fetch('/api/restore-files', { method: 'POST', body: fd });
        const data = await res.json() as any;
        if (!res.ok) throw new Error(data.error || '還原失敗');
        alert(`附件還原完成（${data.restored_files} 個檔案）`);
        setTarget(null); setBusy(false);
        return;
      }
      const body = target!.kind === 'key'
        ? { key: target!.key, password: pw, confirm: confirmTxt }
        : { backup: (target as any).backup, password: pw, confirm: confirmTxt };
      const url = target!.kind === 'key' ? '/api/restore-from' : '/api/restore';
      const r = await api.post<{ restored_rows: number; note: string }>(url, body);
      alert(`還原完成（${r.restored_rows} 筆資料）。${r.note}`);
      window.location.href = '/';
    } catch (ex: any) { setErr(ex.message); setBusy(false); }
  };

  const downloadFilesBackup = async () => {
    const res = await fetch('/api/backup-files');
    if (!res.ok) { alert('附件備份失敗'); return; }
    const blob = await res.blob();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cubic-files-${date}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="side-label" style={{ margin: '0 0 8px' }}>系統備份與還原</div>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
        「資料備份」包含全部資料庫資料（成員、專案、任務、文件、單據、簽核記錄…）；「附件備份」把所有圖片附件打包成 ZIP。兩者搭配即為完整異地備份。系統每天凌晨兩點自動做資料備份、保留最近 30 份；資料還原不會動到附件。
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn primary" onClick={downloadBackup}>下載資料備份</button>
        <button className="btn" onClick={downloadFilesBackup}>下載附件備份（ZIP）</button>
        <label className="btn" style={{ cursor: 'pointer' }}>
          從資料備份還原…
          <input type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => {
                try { setTarget({ kind: 'file', backup: JSON.parse(String(reader.result)), name: f.name }); setPw(''); setConfirmTxt(''); }
                catch { alert('不是有效的 JSON 備份檔'); }
              };
              reader.readAsText(f);
              e.target.value = '';
            }} />
        </label>
        <label className="btn" style={{ cursor: 'pointer' }}>
          從 ZIP 還原附件…
          <input type="file" accept=".zip,application/zip" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setTarget({ kind: 'files', file: f, name: f.name });
              setPw(''); setConfirmTxt('');
              e.target.value = '';
            }} />
        </label>
      </div>
      {backups.length > 0 && (
        <>
          <div className="side-label" style={{ margin: '4px 0 4px' }}>自動備份</div>
          {backups.map(b => (
            <div key={b.key} className="member-row">
              <span className="mono" style={{ fontSize: 13 }}>{b.key.replace('backups/', '')}</span>
              <span className="muted">{(b.size / 1024).toFixed(0)} KB</span>
              <button className="btn subtle" style={{ marginLeft: 'auto' }}
                onClick={() => { setTarget({ kind: 'key', key: b.key }); setPw(''); setConfirmTxt(''); }}>還原到這個時間點</button>
            </div>
          ))}
        </>
      )}
      {target && (
        <>
          <div className="scrim show" onClick={() => !busy && setTarget(null)} />
          <div className="modal-card" role="dialog" aria-label="還原確認">
            <h3 style={{ margin: '0 0 6px', color: 'var(--danger)' }}>⚠ 還原系統資料</h3>
            <p style={{ fontSize: 13.5, margin: '0 0 10px' }}>
              {target.kind === 'files'
                ? <>即將把「{(target as any).name}」內的附件檔案<b>寫回雲端儲存</b>（同名檔案會被覆蓋，資料庫不受影響）。</>
                : <>即將以{target.kind === 'key' ? `自動備份「${target.key.replace('backups/', '')}」` : `檔案「${(target as any).name}」`}
                  <b>覆蓋目前系統的全部資料</b>。這個動作不可復原，還原後所有人（包括你）需要重新登入。</>}
            </p>
            <div className="sign-box">
              <input type="password" placeholder="你的登入密碼" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
              <input placeholder="輸入 RESTORE 以確認" value={confirmTxt} onChange={e => setConfirmTxt(e.target.value)} />
            </div>
            {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn" disabled={busy} onClick={() => setTarget(null)}>取消</button>
              <button className="btn primary" disabled={busy || !pw || confirmTxt !== 'RESTORE'} onClick={doRestore}>
                {busy ? '還原中…' : '確認還原'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
