/** 人事管理：個人資料（頭像/聯絡方式/密碼）＋ 專長區 ＋ 差勤（請假） */
import { useEffect, useState } from 'react';
import { api, User } from './api';

const LEAVE_KINDS = ['事假', '病假', '特休', '公假', '婚假', '喪假', '其他'];
const LSTAT: Record<string, { label: string; cls: string }> = {
  pending_deputy: { label: '待職代確認', cls: 'st-amber' },
  pending: { label: '待主管核准', cls: 'st-blue' }, approved: { label: '已核准', cls: 'st-green' },
  rejected: { label: '已退回', cls: 'st-red' }, cancelled: { label: '已取消', cls: 'st-grey' },
};
const HALF = (h: string) => (h === 'am' ? '上午' : '下午');

export function HRPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [p, setP] = useState<any>(null);
  const [saveTick, setSaveTick] = useState('');
  const [pwBox, setPwBox] = useState(false);
  const [oldPw, setOldPw] = useState(''); const [newPw, setNewPw] = useState(''); const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => api.get<any>('/api/me/profile').then(setP);
  useEffect(() => { reload(); }, []);
  if (!p) return <div className="app"><p className="muted">載入中…</p></div>;

  const patch = async (k: string, v: string) => {
    await api.patch('/api/me/profile', { [k]: v });
    setSaveTick(k); setTimeout(() => setSaveTick(''), 1200);
    reload();
  };
  const uploadAvatar = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) { alert(data.error || '上傳失敗'); return; }
      await patch('avatar_key', data.url.split('/').pop()!);
    };
    input.click();
  };
  const changePw = async () => {
    setPwMsg(null);
    if (newPw !== newPw2) { setPwMsg({ ok: false, text: '兩次輸入的新密碼不一致' }); return; }
    try {
      await api.post('/api/me/password', { old_password: oldPw, new_password: newPw });
      setPwMsg({ ok: true, text: '密碼已更新' });
      setOldPw(''); setNewPw(''); setNewPw2('');
      setTimeout(() => { setPwBox(false); setPwMsg(null); }, 1500);
    } catch (ex: any) { setPwMsg({ ok: false, text: ex.message }); }
  };

  const F = ({ k, label, placeholder, wide }: { k: string; label: string; placeholder?: string; wide?: boolean }) => (
    <label className={`fld ${wide ? 'wide' : ''}`}>
      <span>{label}{saveTick === k && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>已儲存 ✓</span>}</span>
      <input defaultValue={p[k] ?? ''} placeholder={placeholder}
        onBlur={e => { if (e.target.value !== (p[k] ?? '')) patch(k, e.target.value); }} />
    </label>
  );

  return (
    <div className="app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>人事管理</h1></div>
        </div>
      </header>

      {/* ── 個人資料 ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">個人資料</div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            {p.avatar_key
              ? <img src={`/api/files/${p.avatar_key}`} alt="頭像" style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)' }} />
              : <span className="av" style={{ background: p.color, width: 84, height: 84, fontSize: 32, display: 'inline-flex' }}>{p.name?.[0]}</span>}
            <div style={{ marginTop: 8 }}><button className="btn" onClick={uploadAvatar}>更換頭像</button></div>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="fld-grid">
              <F k="name" label="姓名" />
              <label className="fld"><span>Email（登入帳號）</span><input value={p.email} readOnly style={{ opacity: 0.6 }} /></label>
              <F k="phone" label="電話" placeholder="0912-345-678" />
              <F k="address" label="地址" wide />
              <F k="emergency" label="緊急聯絡人" placeholder="姓名／關係／電話" wide />
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => { setPwBox(!pwBox); setPwMsg(null); }}>更換密碼…</button>
              {pwBox && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                  <input type="password" placeholder="目前密碼" value={oldPw} onChange={e => setOldPw(e.target.value)} style={{ width: 150 }} />
                  <input type="password" placeholder="新密碼（8 碼以上）" value={newPw} onChange={e => setNewPw(e.target.value)} style={{ width: 170 }} />
                  <input type="password" placeholder="再輸入一次新密碼" value={newPw2} onChange={e => setNewPw2(e.target.value)} style={{ width: 170 }} />
                  <button className="btn primary" onClick={changePw}>確認更換</button>
                  {pwMsg && <span className={pwMsg.ok ? '' : 'err'} style={pwMsg.ok ? { color: 'var(--accent)' } : {}}>{pwMsg.text}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 專長區 ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">我的專長（由管理者設定，作為任務配發參考）</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0' }}>
          {p.skills.map((s: any) => <span key={s.id} className="stchip st-blue">{s.name}</span>)}
          {!p.skills.length && <span className="muted">還沒有專長標籤。請管理者到「系統管理」為你指派。</span>}
        </div>
      </div>

      {/* ── 差勤區 ── */}
      <LeaveSection me={me} />
    </div>
  );
}

function LeaveSection({ me }: { me: User }) {
  const [mine, setMine] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [deputyList, setDeputyList] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<any>(null);
  const [err, setErr] = useState('');
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const isMgr = me.role === 'admin' || me.role === 'pm';

  const reload = () => {
    api.get<any[]>('/api/leaves').then(setMine);
    api.get<any[]>('/api/leaves?scope=deputy').then(setDeputyList).catch(() => {});
    api.get<User[]>('/api/users').then(setUsers).catch(() => {});
    if (isMgr) api.get<any[]>('/api/leaves?scope=pending').then(setPending).catch(() => {});
  };
  useEffect(() => { reload(); }, []);

  const calcDays = (f: any) => {
    const d1 = new Date(f.start_date + 'T00:00:00'), d2 = new Date(f.end_date + 'T00:00:00');
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    let days = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
    if (f.start_half === 'pm') days -= 0.5;
    if (f.end_half === 'am') days -= 0.5;
    return days;
  };
  const submit = async () => {
    setErr('');
    try { await api.post('/api/leaves', form); setForm(null); reload(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const act = async (id: number, action: string, note?: string) => {
    setErr('');
    try { await api.post(`/api/leaves/${id}/action`, { action, note }); setRejectId(null); setRejectNote(''); reload(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const range = (l: any) =>
    l.start_date === l.end_date && l.start_half === 'am' && l.end_half === 'pm'
      ? l.start_date
      : `${l.start_date} ${HALF(l.start_half)} ～ ${l.end_date} ${HALF(l.end_half)}`;

  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>差勤・我的請假</span>
          <button className="btn primary" onClick={() => setForm(form ? null : { kind: '事假', start_date: today, start_half: 'am', end_date: today, end_half: 'pm', reason: '', deputy_id: '' })}>＋ 請假</button>
        </div>
        {err && <div className="err" style={{ margin: '4px 0' }}>{err}</div>}
        {form && (
          <div className="sign-box" style={{ margin: '8px 0', padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                {LEAVE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value, end_date: form.end_date < e.target.value ? e.target.value : form.end_date })} />
              <select value={form.start_half} onChange={e => setForm({ ...form, start_half: e.target.value })}>
                <option value="am">上午起</option><option value="pm">下午起</option>
              </select>
              <span className="muted">～</span>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
              <select value={form.end_half} onChange={e => setForm({ ...form, end_half: e.target.value })}>
                <option value="am">上午止</option><option value="pm">下午止</option>
              </select>
              <b className="mono">{calcDays(form)} 天</b>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <select value={form.deputy_id} onChange={e => setForm({ ...form, deputy_id: e.target.value })} aria-label="職務代理人">
                <option value="">選擇職代（必填）…</option>
                {users.filter(u => u.id !== me.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <input placeholder="事由（選填）" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
              <button className="btn primary" onClick={submit} disabled={calcDays(form) <= 0 || !form.deputy_id}>送出</button>
            </div>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>流程：送出 → 職代確認 → 主管核准。職代或主管退回後可修改重送。</p>
          </div>
        )}
        {mine.map(l => (
          <div key={l.id} className="member-row">
            <span className={`stchip ${LSTAT[l.status]?.cls}`}>{LSTAT[l.status]?.label}</span>
            <b>{l.kind}</b>
            <span className="mono" style={{ fontSize: 13 }}>{range(l)}</span>
            <span className="muted mono">{l.days} 天</span>
            {l.deputy && <span className="muted" style={{ fontSize: 12 }}>職代：{l.deputy}</span>}
            {l.reason && <span className="muted">{l.reason}</span>}
            {l.status === 'rejected' && l.note && <span className="err" style={{ fontSize: 12 }}>退回：{l.note}</span>}
            {l.status === 'approved' && l.approver && <span className="muted" style={{ fontSize: 12 }}>核准：{l.approver}</span>}
            {['pending_deputy', 'pending'].includes(l.status) && <button className="btn subtle" style={{ marginLeft: 'auto' }}
              onClick={() => { if (confirm('取消這張請假單？')) act(l.id, 'cancel'); }}>取消</button>}
          </div>
        ))}
        {!mine.length && <p className="muted" style={{ margin: '6px 0' }}>還沒有請假紀錄。</p>}
      </div>

      {deputyList.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 14 }}>
          <div className="side-label">待我確認的職代（同意後才會送到主管）</div>
          {deputyList.map(l => (
            <div key={l.id} style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
              <div className="member-row" style={{ border: 'none' }}>
                <b>{l.user_name}</b>
                <span>{l.kind}</span>
                <span className="mono" style={{ fontSize: 13 }}>{range(l)}</span>
                <span className="muted mono">{l.days} 天</span>
                {l.reason && <span className="muted">{l.reason}</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn primary" onClick={() => act(l.id, 'deputy_approve')}>同意代理</button>
                  <button className="btn" onClick={() => setRejectId(rejectId === -l.id ? null : -l.id)}>退回…</button>
                </span>
              </div>
              {rejectId === -l.id && (
                <div style={{ display: 'flex', gap: 8, padding: '4px 0 6px' }}>
                  <input placeholder="退回原因（必填，例如：當天我也請假）" value={rejectNote} onChange={e => setRejectNote(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn" onClick={() => act(l.id, 'deputy_reject', rejectNote)}>確認退回</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isMgr && pending.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <div className="side-label">待我核准的請假</div>
          {pending.map(l => (
            <div key={l.id} style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
              <div className="member-row" style={{ border: 'none' }}>
                <b>{l.user_name}</b>
                <span>{l.kind}</span>
                <span className="mono" style={{ fontSize: 13 }}>{range(l)}</span>
                <span className="muted mono">{l.days} 天</span>
                {l.deputy && <span className="muted" style={{ fontSize: 12 }}>職代 {l.deputy} 已同意</span>}
                {l.reason && <span className="muted">{l.reason}</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn primary" onClick={() => act(l.id, 'approve')}>核准</button>
                  <button className="btn" onClick={() => setRejectId(rejectId === l.id ? null : l.id)}>退回…</button>
                </span>
              </div>
              {rejectId === l.id && (
                <div style={{ display: 'flex', gap: 8, padding: '4px 0 6px' }}>
                  <input placeholder="退回原因（必填）" value={rejectNote} onChange={e => setRejectNote(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn" onClick={() => act(l.id, 'reject', rejectNote)}>確認退回</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
