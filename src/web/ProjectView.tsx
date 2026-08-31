import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, Node, Dep, User, Project } from './api';
import { Model, NodeState, STATE_LABEL, fdate, todayStr } from './model';

const SLOTS: [number, number][] = [[18, 24], [82, 22], [16, 74], [83, 76], [50, 12], [50, 90]];

function Ring({ pct, size }: { pct: number; size: number }) {
  const r = (size - 6) / 2, C = 2 * Math.PI * r, on = C * pct;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`完成度 ${Math.round(pct * 100)}%`}>
      <circle className="bg" cx={size / 2} cy={size / 2} r={r} strokeWidth="4" />
      <circle className="fg" cx={size / 2} cy={size / 2} r={r} strokeWidth="4" strokeDasharray={`${on} ${C - on}`} />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle">{Math.round(pct * 100)}</text>
    </svg>
  );
}
const Avatar = ({ u, size = 20 }: { u?: User; size?: number }) => (
  <span className="av" style={{ background: u?.color ?? 'var(--locked)', width: size, height: size, fontSize: size * 0.52 }} title={u?.name}>
    {u?.name?.[0] ?? '?'}
  </span>
);

export function ProjectView({ project, me, onBack }: { project: Project; me: User; onBack: () => void }) {
  const [model, setModel] = useState<Model | null>(null);
  const [view, setView] = useState<'map' | 'tree' | 'river'>('map');
  const [curModule, setCurModule] = useState<number | null>(null);

  const reload = async () => {
    const [tree, users] = await Promise.all([
      api.get<{ nodes: Node[]; deps: Dep[] }>(`/api/projects/${project.id}/tree`),
      api.get<User[]>('/api/users'),
    ]);
    setModel(new Model(tree.nodes, tree.deps, users));
  };
  useEffect(() => { reload(); }, [project.id]);

  if (!model) return <div className="app"><p className="muted">載入中…</p></div>;

  const openModule = (id: number) => { setCurModule(id); setView('tree'); };

  return (
    <div className="app">
      <header className="pv-head">
        <div>
          <button className="btn" onClick={onBack}>← 專案列表</button>
        </div>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">專案</div>
          <h1>{project.name}</h1>
        </div>
        <nav className="tabs" aria-label="檢視切換">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>心智圖</button>
          <button className={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')}>任務樹</button>
          <button className={view === 'river' ? 'on' : ''} onClick={() => setView('river')}>成員河流</button>
        </nav>
      </header>
      {view === 'map' && <MindMap model={model} project={project} onOpen={openModule} onChanged={reload} />}
      {view === 'tree' && <TreeView model={model} project={project} moduleId={curModule} onPickModule={setCurModule} onBackToMap={() => setView('map')} onChanged={reload} />}
      {view === 'river' && <RiverView model={model} />}
    </div>
  );
}

/* ═══════════ 心智圖 ═══════════ */
function MindMap({ model, project, onOpen, onChanged }: {
  model: Model; project: Project; onOpen: (id: number) => void; onChanged: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const modules = model.modules();
  const all = model.allTasks();
  const doneAll = all.filter(t => t.done).length;

  useLayoutEffect(() => {
    const wrap = wrapRef.current, svg = svgRef.current;
    if (!wrap || !svg) return;
    const draw = () => {
      const wr = wrap.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${wr.width} ${wr.height}`);
      const c = wrap.querySelector('.center-node');
      if (!c) return;
      const cr = c.getBoundingClientRect();
      const cx = cr.left - wr.left + cr.width / 2, cy = cr.top - wr.top + cr.height / 2;
      let p = '';
      wrap.querySelectorAll('.mnode:not(.center-node)').forEach(n => {
        const r = (n as HTMLElement).getBoundingClientRect();
        const nx = r.left - wr.left + r.width / 2, ny = r.top - wr.top + r.height / 2;
        const mx = (cx + nx) / 2;
        p += `<path d="M ${cx} ${cy} C ${mx} ${cy}, ${mx} ${ny}, ${nx} ${ny}"${(n as HTMLElement).classList.contains('addnode') ? ' stroke-dasharray="4 5"' : ''}/>`;
      });
      svg.innerHTML = p;
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  });

  const addModule = async () => {
    if (!title.trim()) { setAdding(false); return; }
    const r = await api.post<{ id: number }>('/api/nodes', { project_id: project.id, kind: 'module', title: title.trim(), mode: 'free' });
    setTitle(''); setAdding(false);
    await onChanged();
    onOpen(r.id);
  };

  return (
    <section>
      <p className="hint">把專案拆成工作模塊，點模塊進入任務樹。完成度只統計最終子任務。</p>
      <div className="map-wrap" ref={wrapRef}>
        <svg className="wires" ref={svgRef} aria-hidden="true" />
        <div className="mnode center-node" style={{ left: '50%', top: '48%' }}>
          <div className="mtitle">{project.name}</div>
          <div className="msub"><Ring pct={all.length ? doneAll / all.length : 0} size={34} /><span className="cnt">{doneAll}/{all.length} 項完成</span></div>
        </div>
        {modules.map((mod, i) => {
          const { done, total } = model.progress(mod);
          const owners = [...new Set(model.leavesUnder(mod).map(t => t.owner_id))].map(id => model.user(id!)).filter(Boolean) as User[];
          const [x, y] = SLOTS[i % SLOTS.length];
          return (
            <div key={mod.id} className="mnode" style={{ left: `${x}%`, top: `${y}%` }} tabIndex={0} role="button"
              onClick={() => onOpen(mod.id)} onKeyDown={e => e.key === 'Enter' && onOpen(mod.id)}>
              <div className="mtitle"><Ring pct={total ? done / total : 0} size={30} /><span>{mod.title}</span></div>
              <div className="msub"><span className="cnt">{total} 項任務</span><span className="avs">{owners.map(u => <Avatar key={u.id} u={u} />)}</span></div>
            </div>
          );
        })}
        {modules.length < SLOTS.length && (
          <div className="mnode addnode" style={{ left: `${SLOTS[modules.length][0]}%`, top: `${SLOTS[modules.length][1]}%` }}
            tabIndex={0} onClick={() => setAdding(true)}>
            {adding
              ? <input autoFocus placeholder="模塊名稱…" value={title} onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addModule(); if (e.key === 'Escape') { setAdding(false); setTitle(''); } }}
                  onBlur={() => { if (!title.trim()) setAdding(false); }} />
              : '＋ 新增模塊'}
          </div>
        )}
      </div>
    </section>
  );
}

/* ═══════════ 任務樹 ═══════════ */
function TreeView({ model, project, moduleId, onPickModule, onBackToMap, onChanged }: {
  model: Model; project: Project; moduleId: number | null;
  onPickModule: (id: number) => void; onBackToMap: () => void; onChanged: () => void;
}) {
  const modules = model.modules();
  const mod = (moduleId != null ? model.byId(moduleId) : undefined) ?? modules[0];
  if (!mod) return <p className="hint">還沒有模塊——回心智圖新增一個。</p>;
  const { done, total } = model.progress(mod);

  const patch = async (id: number, body: object) => { await api.patch(`/api/nodes/${id}`, body); await onChanged(); };
  const addNode = async (kind: 'group' | 'task', parent: number, title: string) => {
    await api.post('/api/nodes', {
      project_id: project.id, parent_id: parent, kind, title,
      owner_id: kind === 'task' ? model.users[0]?.id ?? null : null,
      due: kind === 'task' ? todayStr() : null,
    });
    await onChanged();
  };

  return (
    <section>
      <div className="tree-head">
        <button className="btn" onClick={onBackToMap}>← 心智圖</button>
        <select className="mod-picker" value={mod.id} onChange={e => onPickModule(Number(e.target.value))} aria-label="切換模塊">
          {modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <button className={`mode ${mod.mode === 'seq' ? 'seq' : ''}`} title="切換執行模式"
          onClick={() => patch(mod.id, { mode: mod.mode === 'seq' ? 'free' : 'seq' })}>
          {mod.mode === 'seq' ? '依序執行' : '可並行'}
        </button>
        <div className="mini-progress"><div className="bar"><i style={{ width: `${total ? done / total * 100 : 0}%` }} /></div><span className="mono">{done}/{total}</span></div>
      </div>
      <div className="tree">
        <Branch model={model} container={mod} patch={patch} onChanged={onChanged} />
        <AddRow onAdd={t => addNode('task', mod.id, t)} placeholder="＋ 新增子任務（Enter 加入）" />
        <AddRow onAdd={t => addNode('group', mod.id, t)} placeholder="＋ 新增分組（父節點，用來分類與統計）" subtle />
      </div>
    </section>
  );
}

function Branch({ model, container, patch, onChanged }: {
  model: Model; container: Node; patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
}) {
  const children = model.kids(container.id);
  return (
    <div className={`branch ${container.mode}`}>
      {children.map((n, i) => {
        const posCls = children.length === 1 ? 'only' : i === 0 ? 'first' : i === children.length - 1 ? 'last' : '';
        return n.kind === 'task'
          ? <TaskRow key={n.id} model={model} t={n} idx={i} mode={container.mode} posCls={posCls} patch={patch} onChanged={onChanged} />
          : <GroupBlock key={n.id} model={model} g={n} posCls={posCls} isLast={i === children.length - 1} patch={patch} onChanged={onChanged} />;
      })}
    </div>
  );
}

function GroupBlock({ model, g, posCls, isLast, patch, onChanged }: {
  model: Model; g: Node; posCls: string; isLast: boolean;
  patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
}) {
  const { done, total } = model.progress(g);
  const unmet = model.effDeps(g).map(d => model.byId(d)!).filter(d => d && !model.doneOf(d));
  const addTask = async (title: string) => {
    await api.post('/api/nodes', {
      project_id: g.project_id, parent_id: g.id, kind: 'task', title,
      owner_id: model.users[0]?.id ?? null, due: todayStr(),
    });
    await onChanged();
  };
  return (
    <>
      <div className={`row grow ${posCls === 'last' ? '' : posCls}`}>
        <span className="gnode"><Ring pct={total ? done / total : 0} size={26} /></span>
        <div>
          <div className="ttl"><span className="name">{g.title}</span><span className="gcount">{done}/{total} 完成</span></div>
          {unmet.length > 0 && <div className="chips">{unmet.map(d => <span key={d.id} className="chip">待「{d.title}」</span>)}</div>}
          <DepsEditor model={model} n={g} onChanged={onChanged} />
        </div>
        <div className="acts">
          <button className={`mode ${g.mode === 'seq' ? 'seq' : ''}`} onClick={() => patch(g.id, { mode: g.mode === 'seq' ? 'free' : 'seq' })}>
            {g.mode === 'seq' ? '依序執行' : '可並行'}
          </button>
          <button className="btn subtle" title="刪除分組（底下任務會一併刪除）" onClick={async () => {
            if (confirm(`刪除分組「${g.title}」？底下 ${total} 項任務會一併刪除。`)) { await api.del(`/api/nodes/${g.id}`); await onChanged(); }
          }}>✕</button>
        </div>
      </div>
      <div className={`nest ${isLast ? 'tail' : ''}`}>
        <Branch model={model} container={g} patch={patch} onChanged={onChanged} />
        <AddRow onAdd={addTask} placeholder="＋ 這組新增任務" subtle />
      </div>
    </>
  );
}

function TaskRow({ model, t, idx, mode, posCls, patch, onChanged }: {
  model: Model; t: Node; idx: number; mode: 'seq' | 'free'; posCls: string;
  patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
}) {
  const s = model.stateOf(t);
  const over = !t.done && !!t.due && t.due < todayStr();
  const unmet = model.unmetChain(t);
  const metExplicit = model.explicitDeps(t).map(d => model.byId(d)!).filter(d => d && model.doneOf(d));
  return (
    <div className={`row ${s} ${posCls}`}>
      <button className="node" disabled={s === 'locked'} style={{ fontSize: mode === 'seq' ? 12 : 8 }}
        aria-label={s === 'done' ? '標記未完成' : '標記完成'}
        onClick={() => patch(t.id, { done: !t.done })}>
        {s === 'done' ? '✓' : s === 'locked' ? '🔒' : mode === 'seq' ? idx + 1 : '●'}
      </button>
      <div>
        <div className="ttl"><span className="name">{t.title}</span></div>
        {(unmet.length > 0 || metExplicit.length > 0) && s !== 'done' && (
          <div className="chips">
            {metExplicit.map(d => <span key={d.id} className="chip met">待「{d.title}」</span>)}
            {unmet.map((u, i) => <span key={i} className="chip">待「{u.dep.title}」{u.dep.kind !== 'task' ? '整組完成' : ''}{u.inherited ? '（上層條件）' : ''}</span>)}
          </div>
        )}
        <DepsEditor model={model} n={t} onChanged={onChanged} />
      </div>
      <div className="acts">
        <input type="date" className="due-input mono" value={t.due ?? ''} onChange={e => patch(t.id, { due: e.target.value || null })} aria-label="deadline" />
        {over && <span className="due over">逾期</span>}
        <select className="owner-select" value={t.owner_id ?? ''} onChange={e => patch(t.id, { owner_id: e.target.value ? Number(e.target.value) : null })} aria-label="負責人">
          <option value="">未指派</option>
          {model.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <span className="state-lab">{STATE_LABEL[s]}</span>
        <button className="btn subtle" title="刪除任務" onClick={async () => {
          if (confirm(`刪除任務「${t.title}」？`)) { await api.del(`/api/nodes/${t.id}`); await onChanged(); }
        }}>✕</button>
      </div>
    </div>
  );
}

/** 自訂前置條件編輯：顯示現有條件（可移除），下拉新增 */
function DepsEditor({ model, n, onChanged }: { model: Model; n: Node; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const explicit = model.explicitDeps(n);
  const forbidden = new Set<number>([n.id, ...model.leavesUnder(n).map(x => x.id)]);
  const candidates = model.nodes.filter(x => x.kind !== 'module' && !forbidden.has(x.id) && !explicit.includes(x.id));
  const save = async (ids: number[]) => { await api.put(`/api/nodes/${n.id}/deps`, { dependsOn: ids }); await onChanged(); };
  if (!open) {
    return <button className="dep-toggle" onClick={() => setOpen(true)}>{explicit.length ? `條件（${explicit.length}）` : '＋ 條件'}</button>;
  }
  return (
    <div className="dep-editor">
      {explicit.map(id => {
        const d = model.byId(id); if (!d) return null;
        return <span key={id} className="chip">{d.title}{d.kind !== 'task' ? '（整組）' : ''}<button onClick={() => save(explicit.filter(x => x !== id))} aria-label="移除條件">✕</button></span>;
      })}
      <select value="" onChange={e => e.target.value && save([...explicit, Number(e.target.value)])} aria-label="新增前置條件">
        <option value="">＋ 選擇前置任務或分組…</option>
        {candidates.map(cnd => {
          const modName = (() => { let p = cnd; while (p.parent_id != null) { const q = model.byId(p.parent_id); if (!q) break; p = q; } return p.title; })();
          return <option key={cnd.id} value={cnd.id}>{modName}／{cnd.title}{cnd.kind !== 'task' ? '（整組）' : ''}</option>;
        })}
      </select>
      <button className="btn subtle" onClick={() => setOpen(false)}>收合</button>
    </div>
  );
}

function AddRow({ onAdd, placeholder, subtle }: { onAdd: (t: string) => void; placeholder: string; subtle?: boolean }) {
  const [v, setV] = useState('');
  return (
    <div className={`addtask ${subtle ? 'subtle' : ''}`}>
      <input value={v} placeholder={placeholder} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } }} />
    </div>
  );
}

/* ═══════════ 成員河流 ═══════════ */
function RiverView({ model }: { model: Model }) {
  const today = todayStr();
  const members = model.users.filter(u => model.allTasks().some(t => t.owner_id === u.id));
  if (!members.length) return <p className="hint">還沒有任何已指派的任務。</p>;
  return (
    <section>
      <p className="hint">最終子任務依 <b>deadline</b> 排序流入每位成員的河流，逾期未完成標紅。</p>
      <div className="flow-arrow"><span>deadline 近</span><span className="ln" /><span>deadline 遠</span></div>
      {members.map(m => {
        const mine = model.allTasks().filter(t => t.owner_id === m.id)
          .sort((a, b) => (a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1);
        const readyN = mine.filter(t => model.stateOf(t) === 'ready').length;
        const overN = mine.filter(t => !t.done && t.due && t.due < today).length;
        return (
          <div key={m.id} className="river-lane">
            <div className="lane-head"><Avatar u={m} size={26} /><span className="nm">{m.name}</span>
              <span className="load">{overN ? <b>逾期 {overN} 項・</b> : null}{readyN ? `現在可做 ${readyN} 項` : '沒有可做的任務'}・共 {mine.length} 項</span></div>
            <div className="stream">
              {mine.map(t => {
                const s = model.stateOf(t);
                const over = !t.done && !!t.due && t.due < today;
                const g = t.parent_id != null ? model.byId(t.parent_id) : undefined;
                let root = t; while (root.parent_id != null) { const q = model.byId(root.parent_id); if (!q) break; root = q; }
                return (
                  <div key={t.id} className={`tcard ${s} ${over ? 'over' : ''}`}>
                    <div className="mod">{root.title}{g && g.kind === 'group' ? '・' + g.title : ''}</div>
                    <div className="tt">{t.title}</div>
                    <div className="meta"><span className="st">{s === 'locked' ? '等前置' : STATE_LABEL[s]}</span><span className="due mono">{over ? '逾期 ' : ''}{t.due ? fdate(t.due) : '—'}</span></div>
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
