import type { Node, Dep, User } from './api';

export type NodeState = 'locked' | 'ready' | 'doing' | 'done' | 'signed' | 'closed';
/** 任務已執行完（進度統計用） */
const executed = (t: Node) => ['done', 'signed', 'closed'].includes(t.stage ?? (t.done ? 'done' : 'todo'));
/** 任務對「前置條件」而言算完成：需簽核者要簽核後才放行 */
const releasable = (t: Node) => {
  const st = t.stage ?? (t.done ? 'done' : 'todo');
  return t.needs_sign ? ['signed', 'closed'].includes(st) : ['done', 'signed', 'closed'].includes(st);
};

export class Model {
  nodes: Node[];
  deps: Dep[];
  users: User[];
  private map = new Map<number, Node>();
  private childMap = new Map<number | null, Node[]>();
  private depMap = new Map<number, number[]>();

  constructor(nodes: Node[], deps: Dep[], users: User[]) {
    this.nodes = nodes; this.deps = deps; this.users = users;
    for (const n of nodes) this.map.set(n.id, n);
    for (const n of nodes) {
      const arr = this.childMap.get(n.parent_id) ?? [];
      arr.push(n); this.childMap.set(n.parent_id, arr);
    }
    for (const arr of this.childMap.values()) arr.sort((a, b) => a.sort - b.sort || a.id - b.id);
    for (const d of deps) {
      const arr = this.depMap.get(d.node_id) ?? [];
      arr.push(d.depends_on); this.depMap.set(d.node_id, arr);
    }
  }

  byId(id: number) { return this.map.get(id); }
  user(id: number | null) { return this.users.find(u => u.id === id); }
  kids(id: number | null) { return this.childMap.get(id) ?? []; }
  modules() { return this.kids(null).filter(n => n.kind === 'module'); }

  leavesUnder(n: Node): Node[] {
    return n.kind === 'task' ? [n] : this.kids(n.id).flatMap(c => this.leavesUnder(c));
  }
  allTasks() { return this.nodes.filter(n => n.kind === 'task'); }

  doneOf(n: Node): boolean {
    if (n.kind === 'task') return releasable(n);
    const L = this.leavesUnder(n);
    return L.length > 0 && L.every(l => releasable(l));
  }
  progress(n: Node): { done: number; total: number } {
    const L = this.leavesUnder(n);
    return { done: L.filter(executed).length, total: L.length };
  }

  /** 明確設定的前置 + 依序容器的「上一項」隱含前置 */
  effDeps(n: Node): number[] {
    const d = [...(this.depMap.get(n.id) ?? [])];
    if (n.parent_id != null) {
      const parent = this.byId(n.parent_id);
      if (parent && parent.mode === 'seq') {
        const sib = this.kids(parent.id);
        const i = sib.findIndex(s => s.id === n.id);
        if (i > 0) d.unshift(sib[i - 1].id);
      }
    }
    return [...new Set(d)];
  }
  explicitDeps(n: Node): number[] { return this.depMap.get(n.id) ?? []; }

  availOf(n: Node): boolean {
    if (!this.effDeps(n).every(dp => { const t = this.byId(dp); return t ? this.doneOf(t) : true; })) return false;
    if (n.parent_id == null) return true;
    const p = this.byId(n.parent_id);
    return p ? this.availOf(p) : true;
  }

  stateOf(t: Node): NodeState {
    const st = t.stage ?? (t.done ? 'done' : 'todo');
    if (st === 'closed' || st === 'signed' || st === 'done' || st === 'doing') return st as NodeState;
    return this.availOf(t) ? 'ready' : 'locked';
  }
  /** 顯示標籤：需簽核的已完成任務顯示「待簽核」 */
  stateLabel(t: Node): string {
    const s = this.stateOf(t);
    if (s === 'done' && t.needs_sign) return '待簽核';
    return STATE_LABEL[s];
  }
  /** 任務對執行者而言還沒了結 */
  pendingForOwner(t: Node): boolean {
    return ['locked', 'ready', 'doing'].includes(this.stateOf(t));
  }

  /** 未達成的條件（含上層容器的），供鎖定標籤顯示 */
  unmetChain(n: Node): { dep: Node; inherited: boolean }[] {
    const out: { dep: Node; inherited: boolean }[] = [];
    const collect = (x: Node, inherited: boolean) => {
      for (const dp of this.effDeps(x)) {
        const t = this.byId(dp);
        if (t && !this.doneOf(t)) out.push({ dep: t, inherited });
      }
    };
    collect(n, false);
    let p = n.parent_id != null ? this.byId(n.parent_id) : undefined;
    while (p) {
      collect(p, true);
      p = p.parent_id != null ? this.byId(p.parent_id) : undefined;
    }
    return out;
  }
}

export const STATE_LABEL: Record<NodeState, string> = {
  locked: '鎖定中', ready: '可開始', doing: '執行中', done: '已完成', signed: '已簽核', closed: '已結案',
};
export const fdate = (d: string) => d.slice(5).replace('-', '/');
export const todayStr = () => new Date().toISOString().slice(0, 10);
