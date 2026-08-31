import { useEffect, useMemo, useState } from 'react';
import { api, Node, Dep, User } from './api';
import { Model, STATE_LABEL, fdate, todayStr } from './model';

type Proj = { id: number; name: string };
const DAY = 86400000;
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');

export function ProgressPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [data, setData] = useState<{ projects: Proj[]; nodes: Node[]; deps: Dep[] } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<'river' | 'gantt'>('river');
  const [sel, setSel] = useState<Set<number> | null>(null); // null = 全選

  useEffect(() => {
    api.get<any>('/api/progress').then(setData);
    api.get<User[]>('/api/users').then(setUsers);
  }, []);

  const model = useMemo(() => data ? new Model(data.nodes, data.deps, users) : null, [data, users]);
  if (!data || !model) return <div className="app"><p className="muted">載入中…</p></div>;

  const selected = sel ?? new Set(data.projects.map(p => p.id));
  const toggle = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSel(next);
  };
  const pname = new Map(data.projects.map(p => [p.id, p.name]));
  const tasks = model.allTasks().filter(t => selected.has(t.project_id));

  return (
    <div className="app docs-app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>進度管理</h1></div>
        </div>
        <nav className="tabs">
          <button className={view === 'river' ? 'on' : ''} onClick={() => setView('river')}>成員河流</button>
          <button className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')}>甘特圖</button>
        </nav>
      </header>

      <div className="filter-bar card">
        <span className="side-label" style={{ margin: 0 }}>顯示專案</span>
        {data.projects.map(p => (
          <label key={p.id} className="pcheck">
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
        {data.projects.length > 1 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn subtle" onClick={() => setSel(new Set(data.projects.map(p => p.id)))}>全選</button>
            <button className="btn subtle" onClick={() => setSel(new Set())}>清除</button>
          </span>
        )}
        {!data.projects.length && <span className="muted">還沒有進行中的專案</span>}
      </div>

      {view === 'river'
        ? <CrossRiver model={model} tasks={tasks} pname={pname} />
        : <Gantt model={model} tasks={tasks} projects={data.projects.filter(p => selected.has(p.id))} />}
    </div>
  );
}

/* ═══ 跨專案河流 ═══ */
function CrossRiver({ model, tasks, pname }: { model: Model; tasks: Node[]; pname: Map<number, string> }) {
  const today = todayStr();
  const lanes: { key: string; user?: User; mine: Node[] }[] = [];
  for (const u of model.users) {
    const mine = tasks.filter(t => t.owner_id === u.id);
    if (mine.length) lanes.push({ key: `u${u.id}`, user: u, mine });
  }
  const unassigned = tasks.filter(t => t.owner_id == null);
  if (unassigned.length) lanes.push({ key: 'none', mine: unassigned });
  if (!lanes.length) return <p className="hint">選取的專案裡還沒有任務。</p>;

  return (
    <section>
      <div className="flow-arrow"><span>deadline 近</span><span className="ln" /><span>deadline 遠</span></div>
      {lanes.map(({ key, user, mine }) => {
        const sorted = mine.slice().sort((a, b) => (a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1);
        const readyN = mine.filter(t => model.stateOf(t) === 'ready').length;
        const overN = mine.filter(t => !t.done && t.due && t.due < today).length;
        return (
          <div key={key} className="river-lane">
            <div className="lane-head">
              {user
                ? <><span className="av" style={{ background: user.color, width: 26, height: 26, fontSize: 12 }}>{user.name[0]}</span><span className="nm">{user.name}</span></>
                : <span className="nm muted">未指派</span>}
              <span className="load">{overN ? <b>逾期 {overN} 項・</b> : null}{readyN ? `現在可做 ${readyN} 項` : '沒有可做的任務'}・共 {mine.length} 項</span>
            </div>
            <div className="stream">
              {sorted.map(t => {
                const s = model.stateOf(t);
                const over = !t.done && !!t.due && t.due < today;
                return (
                  <div key={t.id} className={`tcard ${s} ${over ? 'over' : ''}`}>
                    <div className="mod">{pname.get(t.project_id) ?? ''}</div>
                    <div className="tt">{t.title}</div>
                    <div className="meta"><span className="st">{s === 'locked' ? '等前置' : STATE_LABEL[s]}</span>
                      <span className="due mono">{over ? '逾期 ' : ''}{t.due ? fdate(t.due) : '—'}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ═══ 甘特圖 ═══ */
function Gantt({ model, tasks, projects }: { model: Model; tasks: Node[]; projects: Proj[] }) {
  const today = todayStr();
  const dated = tasks.filter(t => t.due);
  if (!dated.length) return <p className="hint">選取的專案裡沒有設 deadline 的任務。</p>;

  /** 任務的起點：所有前置條件（含整組）的最晚 deadline；沒有前置就是單日標記 */
  const depDue = (n: Node): string | null => {
    const L = model.leavesUnder(n).map(l => l.due).filter(Boolean) as string[];
    return L.length ? L.reduce((a, b) => a > b ? a : b) : null;
  };
  const startOf = (t: Node): string => {
    const ds = model.effDeps(t).map(id => model.byId(id)).filter(Boolean).map(d => depDue(d!)).filter(Boolean) as string[];
    const s = ds.length ? ds.reduce((a, b) => a > b ? a : b) : t.due!;
    return s <= t.due! ? s : t.due!;
  };

  const allDates = dated.flatMap(t => [startOf(t), t.due!]).concat([today]);
  const minD = allDates.reduce((a, b) => a < b ? a : b);
  const maxD = allDates.reduce((a, b) => a > b ? a : b);
  const min = toMs(minD) - 2 * DAY, max = toMs(maxD) + 3 * DAY;
  const days = Math.round((max - min) / DAY) + 1;
  const DW = 26, LABEL = 210;
  const x = (d: string) => (toMs(d) - min) / DAY * DW;

  const ticks: { ms: number; label: string; month?: string }[] = [];
  for (let i = 0; i < days; i++) {
    const ms = min + i * DAY, dt = new Date(ms);
    ticks.push({ ms, label: String(dt.getUTCDate()), month: dt.getUTCDate() === 1 || i === 0 ? `${dt.getUTCMonth() + 1}月` : undefined });
  }

  return (
    <section className="gantt-wrap card">
      <div className="gantt-scroll">
        <div style={{ width: LABEL + days * DW, position: 'relative' }}>
          {/* 時間軸 */}
          <div className="g-axis" style={{ paddingLeft: LABEL }}>
            {ticks.map((tk, i) => (
              <span key={i} className="g-tick mono" style={{ width: DW }}>
                {tk.month && <em>{tk.month}</em>}{tk.label}
              </span>
            ))}
          </div>
          {/* 今天線 */}
          <div className="g-today" style={{ left: LABEL + x(today) + DW / 2 }} title={`今天 ${fdate(today)}`} />
          {/* 各專案區塊 */}
          {projects.map(p => {
            const pts = dated.filter(t => t.project_id === p.id).sort((a, b) => (startOf(a) < startOf(b) ? -1 : 1));
            if (!pts.length) return null;
            return (
              <div key={p.id}>
                <div className="g-proj" style={{ paddingLeft: 12 }}>{p.name}</div>
                {pts.map(t => {
                  const s = model.stateOf(t);
                  const over = !t.done && t.due! < today;
                  const sx = x(startOf(t)), ex = x(t.due!) + DW;
                  const owner = model.user(t.owner_id);
                  return (
                    <div key={t.id} className="g-row">
                      <div className="g-label" style={{ width: LABEL }}>
                        {owner && <span className="av" style={{ background: owner.color, width: 16, height: 16, fontSize: 9, marginRight: 6 }}>{owner.name[0]}</span>}
                        <span className="g-name" title={t.title}>{t.title}</span>
                      </div>
                      <div className="g-track" style={{ width: days * DW }}>
                        <div className={`g-bar ${s} ${over ? 'over' : ''}`}
                          style={{ left: sx, width: Math.max(ex - sx, DW * 0.8) }}
                          title={`${t.title}｜${fdate(startOf(t))} → ${fdate(t.due!)}｜${STATE_LABEL[s]}`}>
                          <span className="g-due mono">{fdate(t.due!)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint" style={{ margin: '10px 4px 0' }}>
        橫條起點是前置條件的最晚 deadline（沒有前置的任務顯示為單日）；顏色：綠＝已完成、藍＝可開始、灰＝等待前置、紅框＝逾期。沒設 deadline 的任務不會出現在甘特圖，請在任務樹補上日期。
      </p>
    </section>
  );
}
