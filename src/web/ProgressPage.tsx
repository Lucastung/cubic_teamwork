import { useEffect, useMemo, useState } from 'react';
import { api, Node, Dep, User } from './api';
import { Model, STATE_LABEL, fdate, todayStr } from './model';
import { Comments } from './Comments';

type Proj = { id: number; name: string };
const DAY = 86400000;
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');

export function ProgressPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [data, setData] = useState<{ projects: Proj[]; nodes: Node[]; deps: Dep[] } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<'river' | 'gantt'>('river');
  const [sel, setSel] = useState<Set<number> | null>(null); // null = 全選

  const [openTask, setOpenTask] = useState<number | null>(null);
  const load = () => {
    api.get<any>('/api/progress').then(setData);
    api.get<User[]>('/api/users').then(setUsers);
  };
  useEffect(() => { load(); }, []);

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
        ? <CrossRiver model={model} tasks={tasks} pname={pname} onOpen={setOpenTask} />
        : <Gantt model={model} tasks={tasks} projects={data.projects.filter(p => selected.has(p.id))} />}

      {openTask != null && model.byId(openTask) && (
        <TaskDetailModal model={model} t={model.byId(openTask)!} pname={pname} me={me}
          onClose={() => setOpenTask(null)} onChanged={load} />
      )}
    </div>
  );
}

/* ═══ 任務詳情彈窗（河流／首頁共用）═══ */
export function TaskDetailModal({ model, t, pname, me, onClose, onChanged }: {
  model: Model; t: Node; pname: Map<number, string>; me: User; onClose: () => void; onChanged: () => void;
}) {
  const [box, setBox] = useState<'none' | 'sign' | 'reject'>('none');
  const [pw, setPw] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  useEffect(() => {
    api.get<any[]>(`/api/entity-docs?type=node&id=${t.id}`).then(setDocs).catch(() => {});
  }, [t.id]);
  const s = model.stateOf(t);
  const today = todayStr();
  const over = !['done', 'signed', 'closed'].includes(s) && !!t.due && t.due < today;
  const owner = model.user(t.owner_id);
  const doneBy = model.user(t.done_by);
  const signedBy = model.user(t.signed_by);
  const unmet = model.unmetChain(t);
  const canReview = (me.role === 'admin' || me.role === 'pm') && t.done_by !== me.id;
  const path: string[] = [];
  let p = t.parent_id != null ? model.byId(t.parent_id) : undefined;
  while (p) { path.unshift(p.title); p = p.parent_id != null ? model.byId(p.parent_id) : undefined; }

  const act = async (action: string, extra?: object) => {
    setErr('');
    try {
      await api.post(`/api/nodes/${t.id}/stage`, { action, ...extra });
      await onChanged();
      onClose();
    } catch (ex: any) { setErr(ex.message); }
  };

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      {preview ? (
        <div className="modal-card" role="dialog" aria-label={preview.title}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <button className="btn" onClick={() => setPreview(null)}>← 返回任務</button>
            <b>{preview.title}</b>
          </div>
          <div className="tiptap readonly doc-preview" dangerouslySetInnerHTML={{ __html: preview.content_html || '<p class="muted">（空白文件）</p>' }} />
        </div>
      ) : (
      <div className="modal-card" role="dialog" aria-label={t.title}>
        <div className="eyebrow">{pname.get(t.project_id) ?? ''}{path.length ? '／' + path.join('／') : ''}</div>
        <h3 style={{ margin: '4px 0 8px' }}>{t.title}</h3>
        <div className="panel-stats" style={{ marginBottom: 10 }}>
          <span className={`stchip ${['done', 'signed'].includes(s) ? 'st-green' : s === 'doing' ? 'st-amber' : s === 'ready' ? 'st-blue' : 'st-grey'}`}>{model.stateLabel(t)}</span>
          {!!t.needs_sign && <span className="stchip st-amber">需簽核</span>}
          {owner && <span>負責人：{owner.name}</span>}
          <span className={over ? 'due over' : ''}>{over ? '逾期 ' : 'deadline '}{t.due ? fdate(t.due) : '未設'}</span>
        </div>
        {t.description
          ? <p className="modal-desc">{t.description}</p>
          : <p className="modal-desc muted">（沒有說明——可在專案頁點選這個任務補上）</p>}
        {doneBy && <p className="muted" style={{ fontSize: 12.5, margin: '0 0 4px' }}>完成者：{doneBy.name}{t.done_at ? `・${t.done_at.slice(5, 16)}` : ''}</p>}
        {signedBy && <p className="muted" style={{ fontSize: 12.5, margin: '0 0 4px' }}>簽核者：{signedBy.name}{t.signed_at ? `・${t.signed_at.slice(5, 16)}` : ''}</p>}
        {unmet.length > 0 && (
          <div className="chips" style={{ marginBottom: 10 }}>
            {unmet.map((u, i) => <span key={i} className="chip">待「{u.dep.title}」{u.dep.kind !== 'task' ? '整組' : ''}</span>)}
          </div>
        )}
        {docs.length > 0 && (
          <div className="modal-docs">
            <div className="sect-label" style={{ marginTop: 8 }}>附件文件（{docs.length}）</div>
            {docs.map(d => (
              <button key={d.id} className="edoc-open" style={{ display: 'block', padding: '3px 0' }}
                onClick={async () => setPreview(await api.get(`/api/docs/${d.id}`))}>
                📄 {d.title || '未命名文件'}
              </button>
            ))}
          </div>
        )}
        <div className="sect-label" style={{ marginTop: 10 }}>討論與記錄</div>
        <Comments entityType="node" entityId={t.id} me={me} />
        {box === 'sign' && (
          <div className="sign-box">
            <p className="muted" style={{ margin: '0 0 6px', fontSize: 12.5 }}>簽核代表你以第二人身分核實此任務，簽核後鎖定。請輸入密碼確認本人：</p>
            <input type="password" placeholder="你的登入密碼" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
            <input placeholder="簽核意見（選填）" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        )}
        {box === 'reject' && (
          <div className="sign-box">
            <input placeholder="退回原因（必填）" value={note} onChange={e => setNote(e.target.value)} autoFocus />
          </div>
        )}
        {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          {s === 'ready' && <><button className="btn" onClick={() => act('start')}>開始執行</button>
            <button className="btn primary" onClick={() => act('finish')}>標記完成</button></>}
          {s === 'doing' && <button className="btn primary" onClick={() => act('finish')}>標記完成</button>}
          {s === 'done' && !t.needs_sign && <button className="btn" onClick={() => act('undo')}>標記未完成</button>}
          {s === 'done' && !!t.needs_sign && canReview && (box === 'none'
            ? <><button className="btn primary" onClick={() => setBox('sign')}>簽核…</button>
                <button className="btn" onClick={() => setBox('reject')}>退回…</button></>
            : <button className="btn primary" disabled={box === 'sign' ? !pw : !note.trim()}
                onClick={() => act(box, box === 'sign' ? { password: pw, note } : { note })}>
                {box === 'sign' ? '確認簽核' : '確認退回'}</button>)}
          {s === 'signed' && (me.role === 'admin' || me.role === 'pm') &&
            <button className="btn" onClick={() => { if (confirm('結案後記錄鎖定，確定？')) act('close'); }}>結案</button>}
          <button className="btn" onClick={onClose}>關閉</button>
        </div>
      </div>
      )}
    </>
  );
}

/* ═══ 跨專案河流 ═══ */
function CrossRiver({ model, tasks, pname, onOpen }: { model: Model; tasks: Node[]; pname: Map<number, string>; onOpen: (id: number) => void }) {
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
        const overN = mine.filter(t => model.pendingForOwner(t) && t.due && t.due < today).length;
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
                const over = model.pendingForOwner(t) && !!t.due && t.due < today;
                return (
                  <button key={t.id} className={`tcard ${s} ${over ? 'over' : ''}`} onClick={() => onOpen(t.id)}>
                    <div className="mod">{pname.get(t.project_id) ?? ''}</div>
                    <div className="tt">{t.title}</div>
                    <div className="meta"><span className="st">{s === 'locked' ? '等前置' : model.stateLabel(t)}</span>
                      <span className="due mono">{over ? '逾期 ' : ''}{t.due ? fdate(t.due) : '—'}</span></div>
                  </button>
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
                  const over = model.pendingForOwner(t) && t.due! < today;
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
