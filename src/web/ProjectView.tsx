import { useEffect, useState } from 'react';
import { api, Node, Dep, User, Project } from './api';
import { Model, STATE_LABEL, fdate, todayStr } from './model';
import { DocEditor, EntityDocs } from './DocsPage';

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

type Sel = { type: 'project' } | { type: 'node'; id: number };

export function ProjectView({ project, me, onBack }: { project: Project; me: User; onBack: () => void }) {
  const [model, setModel] = useState<Model | null>(null);
  const [sel, setSel] = useState<Sel>({ type: 'project' });
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const reload = async () => {
    const [tree, users] = await Promise.all([
      api.get<{ nodes: Node[]; deps: Dep[] }>(`/api/projects/${project.id}/tree`),
      api.get<User[]>('/api/users'),
    ]);
    setModel(new Model(tree.nodes, tree.deps, users));
  };
  useEffect(() => { reload(); api.get<any>('/api/docs/tree').then(t => setFolders(t.folders)).catch(() => {}); }, [project.id]);

  if (!model) return <div className="app"><p className="muted">載入中…</p></div>;

  const isTemplate = project.kind === 'template';
  const selNode = sel.type === 'node' ? model.byId(sel.id) : undefined;
  if (sel.type === 'node' && !selNode) { setSel({ type: 'project' }); return null; }
  const all = model.allTasks();
  const doneAll = all.filter(t => t.done).length;

  const patch = async (id: number, body: object) => { await api.patch(`/api/nodes/${id}`, body); await reload(); };
  const pick = (s: Sel) => { setSel(s); setOpenDoc(null); };

  return (
    <div className="app docs-app">
      <header className="pv-head">
        <button className="btn" onClick={onBack}>← 專案列表</button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div className="eyebrow">{isTemplate ? '專案模版（D+N 天、角色佔位、預設成員）' : '專案'}</div>
          <h1>{project.name}</h1>
        </div>
        {!isTemplate && (
          <div className="mini-progress"><div className="bar" style={{ width: 120 }}><i style={{ width: `${all.length ? doneAll / all.length * 100 : 0}%` }} /></div>
            <span className="mono">{doneAll}/{all.length}</span></div>
        )}
      </header>

      <div className="pv2-layout">
        {/* ═══ 左：大綱樹 ═══ */}
        <div className="pv2-tree">
          <button className={`proj-root ${sel.type === 'project' ? 'sel' : ''}`} onClick={() => pick({ type: 'project' })}>
            <Ring pct={all.length ? doneAll / all.length : 0} size={26} />
            <b>{project.name}</b>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>專案總覽</span>
          </button>
          {model.modules().map(mod => (
            <ModuleSection key={mod.id} model={model} mod={mod} isTemplate={isTemplate}
              collapsed={collapsed.has(mod.id)}
              onToggleCollapse={() => {
                const next = new Set(collapsed);
                next.has(mod.id) ? next.delete(mod.id) : next.add(mod.id);
                setCollapsed(next);
              }}
              selId={sel.type === 'node' ? sel.id : null}
              onSelect={id => pick({ type: 'node', id })}
              patch={patch} onChanged={reload} />
          ))}
          <AddRow onAdd={async t => {
            await api.post('/api/nodes', { project_id: project.id, kind: 'module', title: t, mode: 'free' });
            await reload();
          }} placeholder="＋ 新增模塊（Enter 加入）" />
        </div>

        {/* ═══ 右：詳情＋文件 ═══ */}
        <aside className="pv2-panel">
          {openDoc != null ? (
            <>
              <button className="btn" style={{ marginBottom: 10 }} onClick={() => setOpenDoc(null)}>← 返回節點</button>
              <DocEditor key={openDoc} docId={openDoc} me={me} folders={folders}
                onMetaChanged={() => {}} onDeleted={() => setOpenDoc(null)} />
            </>
          ) : sel.type === 'project' ? (
            <ProjectPanel project={project} model={model} me={me} onOpenDoc={setOpenDoc} />
          ) : (
            <NodePanel key={selNode!.id} model={model} n={selNode!} me={me} isTemplate={isTemplate}
              patch={patch} onChanged={reload} onOpenDoc={setOpenDoc}
              onDeleted={() => { pick({ type: 'project' }); }} />
          )}
        </aside>
      </div>
    </div>
  );
}

/* ═══ 模塊區塊 ═══ */
function ModuleSection({ model, mod, isTemplate, collapsed, onToggleCollapse, selId, onSelect, patch, onChanged }: {
  model: Model; mod: Node; isTemplate: boolean; collapsed: boolean; onToggleCollapse: () => void;
  selId: number | null; onSelect: (id: number) => void;
  patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
}) {
  const { done, total } = model.progress(mod);
  const addNode = async (kind: 'group' | 'task', title: string) => {
    await api.post('/api/nodes', {
      project_id: mod.project_id, parent_id: mod.id, kind, title,
      owner_id: null,
      due: kind === 'task' && !isTemplate ? todayStr() : null,
      due_offset: kind === 'task' && isTemplate ? 7 : null,
    });
    await onChanged();
  };
  return (
    <section className="mod-section">
      <div className={`mod-row ${selId === mod.id ? 'sel' : ''}`} onClick={e => {
        if ((e.target as HTMLElement).closest('button')) return;
        onSelect(mod.id);
      }}>
        <button className="chev" onClick={onToggleCollapse} aria-label={collapsed ? '展開' : '收合'}>{collapsed ? '▸' : '▾'}</button>
        <Ring pct={total ? done / total : 0} size={24} />
        <b className="mod-name">{mod.title}</b>
        <span className="muted" style={{ fontSize: 12 }}>{done}/{total}</span>
        <button className={`mode ${mod.mode === 'seq' ? 'seq' : ''}`} style={{ marginLeft: 'auto' }}
          onClick={() => patch(mod.id, { mode: mod.mode === 'seq' ? 'free' : 'seq' })}>
          {mod.mode === 'seq' ? '依序' : '並行'}
        </button>
      </div>
      {!collapsed && (
        <>
          <Branch model={model} container={mod} isTemplate={isTemplate} selId={selId} onSelect={onSelect} patch={patch} onChanged={onChanged} />
          <div className="add-pair">
            <AddRow onAdd={t => addNode('task', t)} placeholder="＋ 子任務" subtle />
            <AddRow onAdd={t => addNode('group', t)} placeholder="＋ 分組" subtle />
          </div>
        </>
      )}
    </section>
  );
}

function Branch({ model, container, isTemplate, selId, onSelect, patch, onChanged }: {
  model: Model; container: Node; isTemplate: boolean; selId: number | null; onSelect: (id: number) => void;
  patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
}) {
  const children = model.kids(container.id);
  return (
    <div className={`branch ${container.mode}`}>
      {children.map((n, i) => {
        const posCls = children.length === 1 ? 'only' : i === 0 ? 'first' : i === children.length - 1 ? 'last' : '';
        return n.kind === 'task'
          ? <TaskRow key={n.id} model={model} t={n} idx={i} mode={container.mode} isTemplate={isTemplate} posCls={posCls}
              selected={selId === n.id} onSelect={() => onSelect(n.id)} onChanged={onChanged} />
          : <GroupBlock key={n.id} model={model} g={n} posCls={posCls} isTemplate={isTemplate} isLast={i === children.length - 1}
              selId={selId} onSelect={onSelect} patch={patch} onChanged={onChanged} />;
      })}
    </div>
  );
}

function GroupBlock({ model, g, posCls, isTemplate, isLast, selId, onSelect, patch, onChanged }: {
  model: Model; g: Node; posCls: string; isTemplate: boolean; isLast: boolean;
  selId: number | null; onSelect: (id: number) => void;
  patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
}) {
  const { done, total } = model.progress(g);
  const unmet = model.effDeps(g).map(d => model.byId(d)!).filter(d => d && !model.doneOf(d));
  const addTask = async (title: string) => {
    await api.post('/api/nodes', {
      project_id: g.project_id, parent_id: g.id, kind: 'task', title,
      owner_id: null,
      due: isTemplate ? null : todayStr(),
      due_offset: isTemplate ? 7 : null,
    });
    await onChanged();
  };
  return (
    <>
      <div className={`row grow ${posCls === 'last' ? '' : posCls} ${selId === g.id ? 'sel' : ''}`}
        onClick={e => { if ((e.target as HTMLElement).closest('button,input,select')) return; onSelect(g.id); }}>
        <span className="gnode"><Ring pct={total ? done / total : 0} size={26} /></span>
        <div>
          <div className="ttl"><span className="name">{g.title}</span><span className="gcount">{done}/{total} 完成</span></div>
          {unmet.length > 0 && <div className="chips">{unmet.map(d => <span key={d.id} className="chip">待「{d.title}」</span>)}</div>}
        </div>
        <div className="acts">
          <button className={`mode ${g.mode === 'seq' ? 'seq' : ''}`} onClick={() => patch(g.id, { mode: g.mode === 'seq' ? 'free' : 'seq' })}>
            {g.mode === 'seq' ? '依序' : '並行'}
          </button>
        </div>
      </div>
      <div className={`nest ${isLast ? 'tail' : ''}`}>
        <Branch model={model} container={g} isTemplate={isTemplate} selId={selId} onSelect={onSelect} patch={patch} onChanged={onChanged} />
        <AddRow onAdd={addTask} placeholder="＋ 這組新增任務" subtle />
      </div>
    </>
  );
}

function TaskRow({ model, t, idx, mode, isTemplate, posCls, selected, onSelect, onChanged }: {
  model: Model; t: Node; idx: number; mode: 'seq' | 'free'; isTemplate: boolean; posCls: string;
  selected: boolean; onSelect: () => void; onChanged: () => void;
}) {
  const s = model.stateOf(t);
  const over = !isTemplate && !['done', 'signed', 'closed'].includes(s) && !!t.due && t.due < todayStr();
  const unmet = model.unmetChain(t);
  const circleAct = async () => {
    const action = s === 'done' ? 'undo' : 'finish';
    await api.post(`/api/nodes/${t.id}/stage`, { action });
    await onChanged();
  };
  const circleDisabled = s === 'locked' || s === 'signed' || s === 'closed';
  return (
    <div className={`row ${isTemplate ? '' : s} ${posCls} ${selected ? 'sel' : ''}`}
      onClick={e => { if ((e.target as HTMLElement).closest('button,input,select')) return; onSelect(); }}>
      {isTemplate
        ? <span className="node" style={{ fontSize: mode === 'seq' ? 12 : 8, cursor: 'default' }}>{mode === 'seq' ? idx + 1 : '●'}</span>
        : <button className="node" disabled={circleDisabled} style={{ fontSize: mode === 'seq' ? 12 : 8 }}
            aria-label={s === 'done' ? '標記未完成' : '標記完成'}
            onClick={circleAct}>
            {['done', 'signed', 'closed'].includes(s) ? '✓' : s === 'locked' ? '🔒' : mode === 'seq' ? idx + 1 : '●'}
          </button>}
      <div>
        <div className="ttl">
          <span className="name">{t.title}</span>
          {!!t.needs_sign && !['signed', 'closed'].includes(s) && <span className="chip">需簽核</span>}
          {t.role_hint && !t.owner_id && <span className="chip">角色：{t.role_hint}</span>}
        </div>
        {!isTemplate && unmet.length > 0 && s === 'locked' && (
          <div className="chips">
            {unmet.map((u, i) => <span key={i} className="chip">待「{u.dep.title}」{u.dep.kind !== 'task' ? '整組' : ''}</span>)}
          </div>
        )}
      </div>
      <div className="acts">
        {isTemplate ? (
          <span className="offset-wrap">D+{t.due_offset ?? '—'} 天</span>
        ) : (
          <>
            {over && <span className="due over">逾期</span>}
            <span className="due mono">{t.due ? fdate(t.due) : ''}</span>
            {t.owner_id && <Avatar u={model.user(t.owner_id)} size={20} />}
            <span className="state-lab">{model.stateLabel(t)}</span>
          </>
        )}
      </div>
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

/* ═══ 右欄：專案總覽 ═══ */
function ProjectPanel({ project, model, me, onOpenDoc }: {
  project: Project; model: Model; me: User; onOpenDoc: (id: number) => void;
}) {
  const all = model.allTasks();
  const today = todayStr();
  const overN = all.filter(t => !t.done && t.due && t.due < today).length;
  const readyN = all.filter(t => model.stateOf(t) === 'ready').length;
  return (
    <div className="panel-card">
      <div className="eyebrow">專案總覽</div>
      <h2 className="panel-title">{project.name}</h2>
      <div className="panel-stats">
        <span>共 {all.length} 項任務</span>
        <span>可開始 {readyN}</span>
        {overN > 0 && <span className="due over">逾期 {overN}</span>}
      </div>
      <div className="sect-label">專案文件</div>
      <EntityDocs entityType="project" entityId={project.id} me={me} onOpenDoc={onOpenDoc} />
      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>點左側任何節點（模塊／分組／任務），這裡會顯示它的詳情與掛載文件。</p>
    </div>
  );
}

/* ═══ 右欄：節點詳情＋文件 ═══ */
function NodePanel({ model, n, me, isTemplate, patch, onChanged, onOpenDoc, onDeleted }: {
  model: Model; n: Node; me: User; isTemplate: boolean;
  patch: (id: number, b: object) => Promise<void>; onChanged: () => void;
  onOpenDoc: (id: number) => void; onDeleted: () => void;
}) {
  const path: string[] = [];
  let p = n.parent_id != null ? model.byId(n.parent_id) : undefined;
  while (p) { path.unshift(p.title); p = p.parent_id != null ? model.byId(p.parent_id) : undefined; }
  const isTask = n.kind === 'task';
  const s = isTask ? model.stateOf(n) : null;
  const { done, total } = model.progress(n);
  const KIND_LABEL = { module: '模塊', group: '分組', task: '任務' } as const;

  return (
    <div className="panel-card">
      <div className="eyebrow">{path.length ? path.join('／') + '／' : ''}{KIND_LABEL[n.kind]}</div>
      <input className="panel-title-input" defaultValue={n.title} aria-label="名稱"
        onBlur={e => { if (e.target.value.trim() && e.target.value !== n.title) patch(n.id, { title: e.target.value.trim() }); }} />
      <textarea className="panel-desc" defaultValue={n.description ?? ''} placeholder="說明…（做什麼、驗收標準、注意事項）"
        aria-label="說明" rows={3}
        onBlur={e => { if ((e.target.value || null) !== (n.description ?? null)) patch(n.id, { description: e.target.value || null }); }} />

      {isTask ? (
        <div className="panel-fields">
          {!isTemplate && <Lifecycle model={model} t={n} me={me} onChanged={onChanged} />}
          <div className="pf"><span>需簽核</span>
            <label className="pcheck" style={{ padding: 0 }}>
              <input type="checkbox" checked={!!n.needs_sign} disabled={['signed', 'closed'].includes(n.stage)}
                onChange={e => patch(n.id, { needs_sign: e.target.checked ? 1 : 0 })} />
              完成後需第二人簽核{!isTemplate && n.needs_sign ? '（簽核後才放行後續任務）' : ''}
            </label>
          </div>
          {isTemplate ? (
            <>
              <div className="pf"><span>時程</span>
                <span className="offset-wrap">D+<input type="number" className="offset-input mono" defaultValue={n.due_offset ?? ''}
                  onBlur={e => patch(n.id, { due_offset: e.target.value === '' ? null : Number(e.target.value) })} aria-label="開案後天數" /> 天</span></div>
              <div className="pf"><span>角色</span>
                <input style={{ width: 150 }} defaultValue={n.role_hint ?? ''} placeholder="例如：實驗員"
                  onBlur={e => patch(n.id, { role_hint: e.target.value || null })} /></div>
              <div className="pf"><span>預設成員</span>
                <select value={n.owner_id ?? ''} onChange={e => patch(n.id, { owner_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">（開案再指派）</option>
                  {model.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select></div>
            </>
          ) : (
            <>
              <div className="pf"><span>負責人</span>
                <select value={n.owner_id ?? ''} onChange={e => patch(n.id, { owner_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">未指派</option>
                  {model.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                {n.role_hint && !n.owner_id && <span className="chip">角色：{n.role_hint}</span>}</div>
              <div className="pf"><span>deadline</span>
                <input type="date" className="mono" style={{ width: 150 }} value={n.due ?? ''}
                  onChange={e => patch(n.id, { due: e.target.value || null })} /></div>
            </>
          )}
          <div className="pf pf-top"><span>前置條件</span><div style={{ flex: 1 }}><DepsEditor model={model} n={n} onChanged={onChanged} /></div></div>
        </div>
      ) : (
        <div className="panel-fields">
          <div className="pf"><span>進度</span><span className="mono">{done}/{total}</span>
            <div className="bar" style={{ width: 100 }}><i style={{ width: `${total ? done / total * 100 : 0}%` }} /></div></div>
          <div className="pf"><span>執行模式</span>
            <button className={`mode ${n.mode === 'seq' ? 'seq' : ''}`} onClick={() => patch(n.id, { mode: n.mode === 'seq' ? 'free' : 'seq' })}>
              {n.mode === 'seq' ? '依序執行' : '可並行'}</button></div>
          {n.kind === 'group' && <div className="pf pf-top"><span>前置條件</span><div style={{ flex: 1 }}><DepsEditor model={model} n={n} onChanged={onChanged} /></div></div>}
        </div>
      )}

      <div className="sect-label">掛在這個{KIND_LABEL[n.kind]}上的文件</div>
      <EntityDocs entityType="node" entityId={n.id} me={me} onOpenDoc={onOpenDoc} />

      <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <button className="btn subtle" onClick={async () => {
          const warn = isTask ? `刪除任務「${n.title}」？` : `刪除${KIND_LABEL[n.kind]}「${n.title}」？底下 ${total} 項任務會一併刪除。`;
          if (confirm(warn)) { await api.del(`/api/nodes/${n.id}`); onDeleted(); await onChanged(); }
        }}>刪除{KIND_LABEL[n.kind]}</button>
      </div>
    </div>
  );
}

/** 前置條件編輯 */
function DepsEditor({ model, n, onChanged }: { model: Model; n: Node; onChanged: () => void }) {
  const explicit = model.explicitDeps(n);
  const forbidden = new Set<number>([n.id, ...model.leavesUnder(n).map(x => x.id)]);
  const candidates = model.nodes.filter(x => x.kind !== 'module' && x.project_id === n.project_id && !forbidden.has(x.id) && !explicit.includes(x.id));
  const save = async (ids: number[]) => { await api.put(`/api/nodes/${n.id}/deps`, { dependsOn: ids }); await onChanged(); };
  return (
    <div className="dep-editor" style={{ marginTop: 0 }}>
      {explicit.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{model.effDeps(n).length ? '（依序模式：自動以上一項為前置）' : '無'}</span>}
      {explicit.map(id => {
        const d = model.byId(id); if (!d) return null;
        return <span key={id} className="chip">{d.title}{d.kind !== 'task' ? '（整組）' : ''}<button onClick={() => save(explicit.filter(x => x !== id))} aria-label="移除條件">✕</button></span>;
      })}
      <select value="" onChange={e => e.target.value && save([...explicit, Number(e.target.value)])} aria-label="新增前置條件">
        <option value="">＋ 加前置…</option>
        {candidates.map(cnd => <option key={cnd.id} value={cnd.id}>{cnd.title}{cnd.kind !== 'task' ? '（整組）' : ''}</option>)}
      </select>
    </div>
  );
}

/* ═══ 任務生命週期操作（右欄）═══ */
function Lifecycle({ model, t, me, onChanged }: { model: Model; t: Node; me: User; onChanged: () => void }) {
  const [sigs, setSigs] = useState<any[]>([]);
  const [box, setBox] = useState<'none' | 'sign' | 'reject'>('none');
  const [err, setErr] = useState('');
  const s = model.stateOf(t);
  const canReview = (me.role === 'admin' || me.role === 'pm') && t.done_by !== me.id;
  useEffect(() => { api.get<any[]>(`/api/nodes/${t.id}/signatures`).then(setSigs).catch(() => {}); }, [t.id, t.stage]);

  const act = async (action: string, extra?: object) => {
    setErr('');
    try { await api.post(`/api/nodes/${t.id}/stage`, { action, ...extra }); setBox('none'); await onChanged(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const doneBy = model.user(t.done_by);
  const signedBy = model.user(t.signed_by);

  return (
    <>
      <div className="pf"><span>狀態</span>
        <span className={`stchip ${['done', 'signed'].includes(s) ? 'st-green' : s === 'closed' ? 'st-grey' : s === 'doing' ? 'st-amber' : s === 'ready' ? 'st-blue' : 'st-grey'}`}>{model.stateLabel(t)}</span>
        {s === 'ready' && <><button className="btn" onClick={() => act('start')}>開始執行</button>
          <button className="btn primary" onClick={() => act('finish')}>標記完成</button></>}
        {s === 'doing' && <button className="btn primary" onClick={() => act('finish')}>標記完成</button>}
        {s === 'done' && !t.needs_sign && <>
          <button className="btn subtle" onClick={() => act('undo')}>標記未完成</button>
          {(me.role === 'admin' || me.role === 'pm') && <button className="btn" onClick={() => { if (confirm('結案後記錄鎖定、不可再修改，確定？')) act('close'); }}>結案</button>}</>}
        {s === 'done' && !!t.needs_sign && (canReview
          ? <><button className="btn primary" onClick={() => setBox(box === 'sign' ? 'none' : 'sign')}>簽核…</button>
              <button className="btn" onClick={() => setBox(box === 'reject' ? 'none' : 'reject')}>退回…</button></>
          : <span className="muted" style={{ fontSize: 12 }}>{t.done_by === me.id ? '等待第二人簽核（不能簽自己完成的任務）' : '等待簽核'}</span>)}
        {s === 'signed' && (me.role === 'admin' || me.role === 'pm') &&
          <button className="btn" onClick={() => { if (confirm('結案後記錄鎖定、不可再修改，確定？')) act('close'); }}>結案</button>}
      </div>
      {doneBy && <div className="pf"><span>完成者</span><span style={{ fontSize: 13 }}>{doneBy.name}{t.done_at ? `・${t.done_at.slice(5, 16)}` : ''}</span></div>}
      {signedBy && <div className="pf"><span>簽核者</span><span style={{ fontSize: 13 }}>{signedBy.name}{t.signed_at ? `・${t.signed_at.slice(5, 16)}` : ''}</span></div>}
      {box !== 'none' && (
        <SignBox mode={box} onSubmit={(password, note) =>
          act(box, box === 'sign' ? { password, note } : { note })} onCancel={() => setBox('none')} />
      )}
      {err && <div className="err">{err}</div>}
      {sigs.length > 0 && (
        <div className="pf pf-top"><span>簽核記錄</span>
          <div style={{ flex: 1 }}>
            {sigs.map((g, i) => (
              <div key={i} className="sig-row">
                <b>{{ sign: '簽核', reject: '退回', close: '結案' }[g.action as string] ?? g.action}</b>
                <span>{g.signer}・{g.created_at.slice(5, 16)}</span>
                {g.note && <span className="muted">「{g.note}」</span>}
                <span className="mono sig-hash" title={`內容雜湊 ${g.content_hash}\n鏈雜湊 ${g.chain_hash}`}>#{g.chain_hash.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SignBox({ mode, onSubmit, onCancel }: {
  mode: 'sign' | 'reject'; onSubmit: (password: string, note: string) => void; onCancel: () => void;
}) {
  const [pw, setPw] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="sign-box">
      {mode === 'sign' ? (
        <>
          <p className="muted" style={{ margin: '0 0 6px', fontSize: 12.5 }}>簽核代表你以第二人身分核實此任務的完成內容，簽核後任務鎖定。請輸入你的密碼確認本人操作：</p>
          <input type="password" placeholder="你的登入密碼" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
          <input placeholder="簽核意見（選填）" value={note} onChange={e => setNote(e.target.value)} />
        </>
      ) : (
        <input placeholder="退回原因（必填）" value={note} onChange={e => setNote(e.target.value)} autoFocus />
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn primary" disabled={mode === 'sign' ? !pw : !note.trim()}
          onClick={() => onSubmit(pw, note)}>{mode === 'sign' ? '確認簽核' : '確認退回'}</button>
      </div>
    </div>
  );
}
