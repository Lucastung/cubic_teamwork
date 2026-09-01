/** 首頁待辦中心：任務簽核／報銷核准付款／職代確認／請假核准，全部就地處理 */
import { useEffect, useState } from 'react';
import { api, User, Node } from './api';

const NT = (n: number) => `NT$ ${Number(n || 0).toLocaleString('zh-TW')}`;
const HALF = (h: string) => (h === 'am' ? '上午' : '下午');
const range = (l: any) =>
  l.start_date === l.end_date && l.start_half === 'am' && l.end_half === 'pm'
    ? l.start_date
    : `${l.start_date} ${HALF(l.start_half)} ～ ${l.end_date} ${HALF(l.end_half)}`;

const KindChip = ({ label, cls }: { label: string; cls: string }) => (
  <span className={`stchip ${cls}`} style={{ flex: 'none' }}>{label}</span>
);

export function HomeTodo({ me, toSign, pname, users, onOpenTask, onChanged }: {
  me: User; toSign: Node[]; pname: Map<number, string>; users: User[];
  onOpenTask: (id: number) => void; onChanged: () => void;
}) {
  const isMgr = me.role === 'admin' || me.role === 'pm';
  const [exp, setExp] = useState<{ to_approve: any[]; to_pay: any[] }>({ to_approve: [], to_pay: [] });
  const [dep, setDep] = useState<any[]>([]);
  const [pend, setPend] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);   // 展開中的處理列 key
  const [pw, setPw] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    api.get<any[]>('/api/leaves?scope=deputy').then(setDep).catch(() => {});
    if (isMgr) {
      api.get<any>('/api/expenses?box=todo').then(setExp).catch(() => {});
      api.get<any[]>('/api/leaves?scope=pending').then(setPend).catch(() => {});
    }
  };
  useEffect(() => { load(); }, []);

  const after = () => { setOpen(null); setPw(''); setNote(''); setErr(''); load(); onChanged(); };
  const expAct = async (id: number, action: string) => {
    setErr('');
    try { await api.post(`/api/expenses/${id}/action`, { action, password: pw, note }); after(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const leaveAct = async (id: number, action: string, needNote = false) => {
    setErr('');
    try { await api.post(`/api/leaves/${id}/action`, { action, note: needNote ? note : undefined }); after(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const toggle = (key: string) => { setOpen(open === key ? null : key); setPw(''); setNote(''); setErr(''); };

  const total = toSign.length + exp.to_approve.length + exp.to_pay.length + dep.length + pend.length;
  if (!total) return null;

  const ActionBox = ({ children }: { children: any }) => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '4px 6px 8px 26px' }}>
      {children}
      {err && <span className="err">{err}</span>}
    </div>
  );

  return (
    <div className="mytasks card" style={{ borderColor: 'var(--warn)' }}>
      <div className="side-label" style={{ margin: '0 0 6px' }}>待我處理（{total} 件）</div>

      {/* 任務簽核（點開小卡簽核） */}
      {toSign.map(t => (
        <button key={`t${t.id}`} className="mytask-row" onClick={() => onOpenTask(t.id)}>
          <KindChip label="簽核" cls="st-amber" />
          <span className="mytask-title">{t.title}</span>
          <span className="muted mytask-proj">{pname.get(t.project_id) ?? ''}</span>
          <span className="muted" style={{ fontSize: 12 }}>完成者：{users.find(u => u.id === t.done_by)?.name ?? '—'}</span>
          <span className="state-lab" style={{ width: 'auto' }}>點擊簽核 →</span>
        </button>
      ))}

      {/* 報銷待核准 */}
      {exp.to_approve.map(x => (
        <div key={`ea${x.id}`}>
          <button className="mytask-row" onClick={() => toggle(`ea${x.id}`)}>
            <KindChip label="報銷" cls="st-blue" />
            <span className="mytask-title">{x.exp_no}　{x.title || '（未命名）'}</span>
            <span className="muted mytask-proj">申請人：{x.claimant}</span>
            <span className="mono">{NT(x.total)}</span>
            <span className="state-lab" style={{ width: 'auto' }}>{open === `ea${x.id}` ? '收合 ▴' : '待核准 ▾'}</span>
          </button>
          {open === `ea${x.id}` && (
            <ActionBox>
              <input type="password" placeholder="你的登入密碼（核准用）" value={pw} onChange={e => setPw(e.target.value)} style={{ width: 180 }} />
              <input placeholder="附註／退回原因" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <button className="btn primary" onClick={() => expAct(x.id, 'approve')}>核准</button>
              <button className="btn" onClick={() => expAct(x.id, 'reject')}>退回</button>
            </ActionBox>
          )}
        </div>
      ))}

      {/* 報銷待付款（管理員） */}
      {me.role === 'admin' && exp.to_pay.map(x => (
        <div key={`ep${x.id}`}>
          <button className="mytask-row" onClick={() => toggle(`ep${x.id}`)}>
            <KindChip label="付款" cls="st-green" />
            <span className="mytask-title">{x.exp_no}　{x.title || '（未命名）'}</span>
            <span className="muted mytask-proj">申請人：{x.claimant}</span>
            <span className="mono">{NT(x.total)}</span>
            <span className="state-lab" style={{ width: 'auto' }}>{open === `ep${x.id}` ? '收合 ▴' : '待付款 ▾'}</span>
          </button>
          {open === `ep${x.id}` && (
            <ActionBox>
              <input type="password" placeholder="你的登入密碼（付款確認）" value={pw} onChange={e => setPw(e.target.value)} style={{ width: 190 }} />
              <input placeholder="附註（選填）" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
              <button className="btn primary" onClick={() => expAct(x.id, 'pay')}>確認付款</button>
            </ActionBox>
          )}
        </div>
      ))}

      {/* 職代確認 */}
      {dep.map(l => (
        <div key={`d${l.id}`}>
          <div className="mytask-row" style={{ cursor: 'default' }}>
            <KindChip label="職代" cls="st-amber" />
            <span className="mytask-title">{l.user_name}・{l.kind}</span>
            <span className="muted mytask-proj mono">{range(l)}（{l.days} 天）</span>
            <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button className="btn primary" onClick={() => leaveAct(l.id, 'deputy_approve')}>同意代理</button>
              <button className="btn" onClick={() => toggle(`d${l.id}`)}>退回…</button>
            </span>
          </div>
          {open === `d${l.id}` && (
            <ActionBox>
              <input placeholder="退回原因（必填）" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn" onClick={() => leaveAct(l.id, 'deputy_reject', true)}>確認退回</button>
            </ActionBox>
          )}
        </div>
      ))}

      {/* 請假待核准（主管） */}
      {pend.map(l => (
        <div key={`l${l.id}`}>
          <div className="mytask-row" style={{ cursor: 'default' }}>
            <KindChip label="請假" cls="st-blue" />
            <span className="mytask-title">{l.user_name}・{l.kind}</span>
            <span className="muted mytask-proj mono">{range(l)}（{l.days} 天）{l.deputy ? `・職代 ${l.deputy} 已同意` : ''}</span>
            <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button className="btn primary" onClick={() => leaveAct(l.id, 'approve')}>核准</button>
              <button className="btn" onClick={() => toggle(`l${l.id}`)}>退回…</button>
            </span>
          </div>
          {open === `l${l.id}` && (
            <ActionBox>
              <input placeholder="退回原因（必填）" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn" onClick={() => leaveAct(l.id, 'reject', true)}>確認退回</button>
            </ActionBox>
          )}
        </div>
      ))}
    </div>
  );
}
