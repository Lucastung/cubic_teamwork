/** 財務模組：費用報銷（兩層簽核）＋ 請款與收款（含 5% 稅、應收帳款） */
import { useEffect, useState, FormEvent } from 'react';
import { api, User } from './api';

const NT = (n: number) => `NT$ ${Number(n || 0).toLocaleString('zh-TW')}`;
const Chip = ({ s, map }: { s: string; map: Record<string, { label: string; cls: string }> }) => (
  <span className={`stchip ${map[s]?.cls ?? 'st-grey'}`}>{map[s]?.label ?? s}</span>
);
export const ES: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'st-grey' }, submitted: { label: '送審中', cls: 'st-blue' },
  approved: { label: '已核准', cls: 'st-amber' }, paid: { label: '已付款', cls: 'st-green' },
  void: { label: '作廢', cls: 'st-red' },
};
const IS: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'st-grey' }, issued: { label: '已送出', cls: 'st-blue' },
  partial: { label: '部分收款', cls: 'st-amber' }, paid: { label: '已收款', cls: 'st-green' },
  void: { label: '作廢', cls: 'st-red' },
};
const CATEGORIES = ['交通', '差旅', '餐費', '文具', '設備', '軟體/訂閱', '雜項'];

type Tab = 'expenses' | 'invoices' | 'ar';

export function FinPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [tab, setTab] = useState<Tab>('expenses');
  return (
    <div className="app docs-app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>財務管理</h1></div>
        </div>
        <nav className="tabs">
          <button className={tab === 'expenses' ? 'on' : ''} onClick={() => setTab('expenses')}>費用報銷</button>
          <button className={tab === 'invoices' ? 'on' : ''} onClick={() => setTab('invoices')}>請款單</button>
          <button className={tab === 'ar' ? 'on' : ''} onClick={() => setTab('ar')}>應收帳款</button>
        </nav>
      </header>
      {tab === 'expenses' && <ExpensesTab me={me} />}
      {tab === 'invoices' && <InvoicesTab me={me} />}
      {tab === 'ar' && <ARTab />}
    </div>
  );
}

/* ═══════════ 費用報銷 ═══════════ */

function ExpensesTab({ me }: { me: User }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  const isMgr = me.role === 'admin' || me.role === 'pm';
  const reload = () => api.get<any[]>('/api/expenses').then(setList);
  useEffect(() => { reload(); }, []);

  if (openId != null) return <ExpenseEditor id={openId === 'new' ? null : openId} me={me} onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <section>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn primary" onClick={() => setOpenId('new')}>＋ 新報銷單</button>
        {isMgr && <span className="muted" style={{ fontSize: 12.5 }}>你是{me.role === 'admin' ? '管理員' : '專案負責人'}，看得到全部人的報銷單</span>}
      </div>
      {list.map(e => (
        <button key={e.id} className="card proj-card" onClick={() => setOpenId(e.id)}>
          <span><span className="mono muted">{e.exp_no}</span> <b>{e.title || '（未命名）'}</b>
            <span className="muted" style={{ marginLeft: 8 }}>{e.claimant}</span>
            {e.status === 'draft' && e.reject_note && <span className="stchip st-red" style={{ marginLeft: 8 }}>被退回</span>}</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Chip s={e.status} map={ES} /><span className="mono">{NT(e.total)}</span></span>
        </button>
      ))}
      {!list.length && <p className="muted">還沒有報銷單。出差、購物、代墊費用都從「＋ 新報銷單」開始。</p>}
    </section>
  );
}

type ExpLine = { date: string; category: string; description: string; amount: number; project_id: number | null };
const emptyExpLine = (): ExpLine => ({ date: new Date().toISOString().slice(0, 10), category: '雜項', description: '', amount: 0, project_id: null });

function ExpenseEditor({ id, me, onBack }: { id: number | null; me: User; onBack: () => void }) {
  const [e, setE] = useState<any>(id == null
    ? { status: 'draft', title: '', note: '', claimant_id: me.id, lines: [emptyExpLine()], receipts: [], signatures: [], events: [] }
    : null);
  const [projects, setProjects] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [act, setAct] = useState<'approve' | 'reject' | 'pay' | null>(null);
  const [pw, setPw] = useState(''); const [note, setNote] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const reload = (eid: number) => api.get<any>(`/api/expenses/${eid}`).then(d =>
    setE({ ...d, lines: d.lines.length ? d.lines : [emptyExpLine()] }));
  useEffect(() => {
    api.get<any[]>('/api/projects').then(setProjects).catch(() => {});
    if (id != null) reload(id);
  }, [id]);
  if (!e) return <p className="muted">載入中…</p>;

  const mine = e.claimant_id === me.id;
  const isMgr = me.role === 'admin' || me.role === 'pm';
  const editable = mine && e.status === 'draft';
  const total = e.lines.reduce((s: number, l: ExpLine) => s + (Math.round(Number(l.amount)) || 0), 0);

  const setLine = (i: number, patch: Partial<ExpLine>) => {
    const lines = e.lines.slice(); lines[i] = { ...lines[i], ...patch }; setE({ ...e, lines });
  };
  const save = async (): Promise<number | null> => {
    setErr('');
    try {
      if (id == null) {
        const r = await api.post<{ id: number }>('/api/expenses', { title: e.title, note: e.note, lines: e.lines });
        return r.id;
      }
      await api.put(`/api/expenses/${id}`, { title: e.title, note: e.note, lines: e.lines });
      return id;
    } catch (ex: any) { setErr(ex.message); return null; }
  };
  const doAction = async (eid: number, action: string, extra: any = {}) => {
    setErr('');
    try {
      await api.post(`/api/expenses/${eid}/action`, { action, ...extra });
      setAct(null); setPw(''); setNote('');
      reload(eid);
    } catch (ex: any) { setErr(ex.message); }
  };
  const saveAndSubmit = async () => {
    const eid = await save();
    if (eid == null) return;
    await doAction(eid, 'submit');
    onBack();
  };
  const uploadReceipt = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,.pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || id == null) return;
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; name?: string; error?: string };
      if (!res.ok || !data.url) { setErr(data.error || '上傳失敗'); return; }
      await api.post(`/api/expenses/${id}/receipts`, { file_key: data.url.split('/').pop(), file_name: data.name });
      reload(id);
    };
    input.click();
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 報銷單列表</button>
        <h2 style={{ margin: 0 }}>{id == null ? '新報銷單' : e.exp_no}</h2>
        <Chip s={e.status} map={ES} />
        {e.claimant && <span className="muted">申請人：{e.claimant}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editable && <button className="btn" onClick={async () => { const eid = await save(); if (eid != null) { if (id == null) { onBack(); } else reload(eid); } }}>儲存草稿</button>}
          {editable && <button className="btn primary" onClick={saveAndSubmit}>送審</button>}
          {mine && e.status === 'submitted' && <button className="btn" onClick={() => doAction(id!, 'withdraw')}>抽回修改</button>}
          {isMgr && !mine && e.status === 'submitted' && <>
            <button className="btn primary" onClick={() => { setAct(act === 'approve' ? null : 'approve'); setErr(''); }}>核准…</button>
            <button className="btn" onClick={() => { setAct(act === 'reject' ? null : 'reject'); setErr(''); }}>退回…</button>
          </>}
          {me.role === 'admin' && e.status === 'approved' &&
            <button className="btn primary" onClick={() => { setAct(act === 'pay' ? null : 'pay'); setErr(''); }}>標記已付款…</button>}
          {id != null && !['paid', 'void'].includes(e.status) && (mine || me.role === 'admin') &&
            <button className="btn subtle" onClick={() => { if (confirm('作廢這張報銷單？')) doAction(id, 'void'); }}>作廢</button>}
        </span>
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
      {e.status === 'draft' && e.reject_note && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
          <b style={{ color: 'var(--danger)' }}>上次送審被退回：</b>{e.reject_note}
        </div>
      )}

      {act && (
        <div className="card sign-box" style={{ marginBottom: 12 }}>
          <b>{act === 'approve' ? '核准報銷' : act === 'reject' ? '退回報銷' : '確認付款'}</b>
          <p className="muted" style={{ margin: '2px 0 8px', fontSize: 12.5 }}>
            {act === 'approve' && '核准後進入待付款。需重新輸入你的密碼驗證本人，並寫入電子簽章鏈。'}
            {act === 'reject' && '退回後申請人可修改重送。請填寫退回原因（會留存於簽章紀錄）。'}
            {act === 'pay' && '確認款項已匯出／支付。需重新輸入你的密碼驗證本人，並寫入電子簽章鏈。'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {act !== 'reject' && <input type="password" placeholder="你的登入密碼" value={pw} onChange={ev => setPw(ev.target.value)} style={{ width: 180 }} />}
            <input placeholder={act === 'reject' ? '退回原因（必填）' : '附註（選填）'} value={note} onChange={ev => setNote(ev.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button className="btn primary" onClick={() => doAction(id!, act, { password: pw, note })}>
              {act === 'approve' ? '確認核准' : act === 'reject' ? '確認退回' : '確認付款'}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fld-grid">
          <label className="fld wide"><span>標題</span>
            <input value={e.title} readOnly={!editable} placeholder="例如：8 月出差高雄客戶訪談" onChange={ev => setE({ ...e, title: ev.target.value })} /></label>
        </div>
        <div className="erp-thead" style={{ marginTop: 12 }}>
          <span style={{ width: 130 }}>日期</span><span style={{ width: 110 }}>類別</span>
          <span style={{ flex: 1 }}>說明</span><span style={{ width: 110, textAlign: 'right' }}>金額</span>
          <span style={{ width: 160 }}>歸屬專案</span>
          {editable && <span style={{ width: 32 }}></span>}
        </div>
        {e.lines.map((l: ExpLine, i: number) => (
          <div key={i} className="erp-trow">
            <input style={{ width: 130 }} type="date" value={l.date ?? ''} readOnly={!editable} onChange={ev => setLine(i, { date: ev.target.value })} />
            <select style={{ width: 110 }} value={l.category} disabled={!editable} onChange={ev => setLine(i, { category: ev.target.value })}>
              {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              {!CATEGORIES.includes(l.category) && <option value={l.category}>{l.category}</option>}
            </select>
            <input style={{ flex: 1 }} value={l.description} readOnly={!editable} placeholder="用途說明" onChange={ev => setLine(i, { description: ev.target.value })} />
            <input style={{ width: 110, textAlign: 'right' }} type="number" value={l.amount} readOnly={!editable} onChange={ev => setLine(i, { amount: Number(ev.target.value) })} />
            <select style={{ width: 160 }} value={l.project_id ?? ''} disabled={!editable} onChange={ev => setLine(i, { project_id: ev.target.value ? Number(ev.target.value) : null })}>
              <option value="">（不歸專案）</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {editable && <button className="btn subtle" style={{ width: 32 }} onClick={() => setE({ ...e, lines: e.lines.filter((_: any, j: number) => j !== i) })}>✕</button>}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          {editable ? <button className="btn" onClick={() => setE({ ...e, lines: [...e.lines, emptyExpLine()] })}>＋ 加一筆</button> : <span />}
          <b style={{ fontSize: 16 }}>合計 <span className="mono">{NT(total)}</span></b>
        </div>
        <label className="fld wide" style={{ marginTop: 10 }}><span>備註</span>
          <input value={e.note ?? ''} readOnly={!editable} onChange={ev => setE({ ...e, note: ev.target.value })} /></label>
      </div>

      {id != null && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>憑證（發票／收據）</span>
            {mine && ['draft', 'submitted'].includes(e.status) && <button className="btn" onClick={uploadReceipt}>＋ 上傳憑證</button>}
          </div>
          {e.receipts.map((r: any) => (
            <div key={r.id} className="member-row">
              <button className="btn subtle" onClick={() => setPreview(`/api/files/${r.file_key}`)}>🧾 {r.file_name || r.file_key}</button>
              <span className="muted" style={{ marginLeft: 'auto' }}>{r.created_at.slice(5, 16)}</span>
              {mine && ['draft', 'submitted'].includes(e.status) &&
                <button className="btn subtle" onClick={async () => { await api.del(`/api/expenses/${id}/receipts/${r.id}`); reload(id); }}>✕</button>}
            </div>
          ))}
          {!e.receipts.length && <p className="muted" style={{ margin: '4px 0' }}>還沒有憑證。核准前記得附上發票或收據照片。</p>}
          {preview && (
            <div style={{ marginTop: 8 }}>
              <button className="btn subtle" onClick={() => setPreview(null)}>關閉預覽</button>
              {preview.match(/\.pdf$/i)
                ? <iframe src={preview} style={{ width: '100%', height: 480, border: '1px solid var(--line)', borderRadius: 8, marginTop: 6 }} title="憑證" />
                : <img src={preview} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6, border: '1px solid var(--line)' }} alt="憑證" />}
            </div>
          )}
        </div>
      )}

      {id != null && (e.signatures.length > 0 || e.events.length > 0) && (
        <div className="card">
          <div className="side-label">簽章與歷程</div>
          {e.signatures.map((s: any, i: number) => (
            <div key={`s${i}`} className="member-row">
              <span>{s.action === 'sign' ? '✅ 核准' : s.action === 'reject' ? '⛔ 退回' : '💰 付款確認'}</span>
              <b>{s.signer}</b>
              {s.note && <span className="muted">{s.note}</span>}
              <span className="muted mono" style={{ marginLeft: 'auto', fontSize: 11 }} title={`內容雜湊 ${s.content_hash}`}>
                ⛓ {s.chain_hash.slice(0, 12)}…</span>
              <span className="muted">{s.created_at.slice(5, 16)}</span>
            </div>
          ))}
          {e.events.map((ev: any, i: number) => (
            <div key={`e${i}`} className="member-row"><span>{ev.action}</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>{ev.actor}・{ev.created_at.slice(5, 16)}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════ 請款單 ═══════════ */

type InvLine = { item_id: number | null; name: string; qty: number; unit: string; price: number };
const emptyInvLine = (): InvLine => ({ item_id: null, name: '', qty: 1, unit: '式', price: 0 });

function InvoicesTab({ me }: { me: User }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  const canWrite = me.role === 'admin' || me.role === 'pm';
  const reload = () => api.get<any[]>('/api/invoices').then(setList);
  useEffect(() => { reload(); }, []);

  if (openId != null) return <InvoiceEditor id={openId === 'new' ? null : openId} canWrite={canWrite} onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <section>
      {canWrite && <div style={{ marginBottom: 12 }}><button className="btn primary" onClick={() => setOpenId('new')}>＋ 新請款單</button></div>}
      {list.map(inv => (
        <button key={inv.id} className="card proj-card" onClick={() => setOpenId(inv.id)}>
          <span><span className="mono muted">{inv.inv_no}</span> <b>{inv.title || inv.party_name}</b>
            <span className="muted" style={{ marginLeft: 8 }}>{inv.party_name}{inv.order_no ? `・${inv.order_no}` : ''}</span></span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Chip s={inv.status} map={IS} />
            {inv.status === 'partial' && <span className="muted mono" style={{ fontSize: 12 }}>已收 {NT(inv.paid)}</span>}
            <span className="mono">{NT(inv.total)}</span>
          </span>
        </button>
      ))}
      {!list.length && <p className="muted">還沒有請款單。可以從訂單頁一鍵產生，或按「＋ 新請款單」。</p>}
    </section>
  );
}

function InvoiceEditor({ id, canWrite, onBack }: { id: number | null; canWrite: boolean; onBack: () => void }) {
  const [inv, setInv] = useState<any>(id == null
    ? { status: 'draft', title: '', note: '', party_id: '', order_id: '', tax_rate: 0.05, gui_no: '', issue_date: '', due_date: '', lines: [emptyInvLine()], payments: [], events: [] }
    : null);
  const [parties, setParties] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [pay, setPay] = useState<{ date: string; amount: number; method: string; note: string } | null>(null);

  const reload = (iid: number) => api.get<any>(`/api/invoices/${iid}`).then(d =>
    setInv({ ...d, lines: d.lines.length ? d.lines : [emptyInvLine()] }));
  useEffect(() => {
    api.get<any[]>('/api/parties').then(setParties);
    api.get<any[]>('/api/orders').then(setOrders).catch(() => {});
    if (id != null) reload(id);
  }, [id]);
  if (!inv) return <p className="muted">載入中…</p>;

  const editable = canWrite && inv.status === 'draft';
  const rate = Number(inv.tax_rate) || 0;
  const amount = inv.lines.reduce((s: number, l: InvLine) => s + Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)), 0);
  const tax = Math.round(amount * rate);
  const paid = (inv.payments ?? []).reduce((s: number, p: any) => s + p.amount, 0);

  const setLine = (i: number, patch: Partial<InvLine>) => {
    const lines = inv.lines.slice(); lines[i] = { ...lines[i], ...patch }; setInv({ ...inv, lines });
  };
  const pickOrder = (oid: string) => {
    const o = orders.find(x => x.id === Number(oid));
    setInv({ ...inv, order_id: oid, ...(o ? { party_id: String(o.party_id), title: inv.title || o.title } : {}) });
    if (o) api.get<any>(`/api/orders/${o.id}`).then(d =>
      setInv((cur: any) => ({ ...cur, lines: d.lines.length ? d.lines.map((l: any) => ({ item_id: l.item_id, name: l.name, qty: l.qty, unit: l.unit, price: l.price })) : cur.lines })));
  };
  const save = async (): Promise<number | null> => {
    setErr('');
    if (!inv.party_id && !inv.order_id) { setErr('請選擇客戶或訂單'); return null; }
    const body = {
      order_id: inv.order_id ? Number(inv.order_id) : null,
      party_id: inv.party_id ? Number(inv.party_id) : null,
      title: inv.title, lines: inv.lines, tax_rate: rate,
      gui_no: inv.gui_no || null, issue_date: inv.issue_date || null, due_date: inv.due_date || null, note: inv.note || null,
    };
    try {
      if (id == null) { const r = await api.post<{ id: number }>('/api/invoices', body); return r.id; }
      await api.put(`/api/invoices/${id}`, body);
      return id;
    } catch (ex: any) { setErr(ex.message); return null; }
  };
  const issue = async () => {
    const iid = await save();
    if (iid == null) return;
    try { await api.post(`/api/invoices/${iid}/status`, { status: 'issued' }); onBack(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const addPayment = async () => {
    if (!pay) return;
    try {
      await api.post(`/api/invoices/${id}/payments`, pay);
      setPay(null); reload(id!);
    } catch (ex: any) { setErr(ex.message); }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 請款單列表</button>
        <h2 style={{ margin: 0 }}>{id == null ? '新請款單' : inv.inv_no}</h2>
        <Chip s={inv.status} map={IS} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editable && <button className="btn" onClick={async () => { const iid = await save(); if (iid != null) { if (id == null) onBack(); else reload(iid); } }}>儲存草稿</button>}
          {editable && <button className="btn primary" onClick={issue}>送出請款</button>}
          {canWrite && ['issued', 'partial'].includes(inv.status) &&
            <button className="btn primary" onClick={() => setPay(pay ? null : { date: new Date().toISOString().slice(0, 10), amount: inv.total - paid, method: '匯款', note: '' })}>登記收款…</button>}
          {canWrite && ['draft', 'issued', 'partial'].includes(inv.status) && id != null &&
            <button className="btn subtle" onClick={async () => {
              if (confirm('作廢這張請款單？')) { await api.post(`/api/invoices/${id}/status`, { status: 'void' }); onBack(); }
            }}>作廢</button>}
        </span>
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      {pay && (
        <div className="card sign-box" style={{ marginBottom: 12 }}>
          <b>登記收款</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <input type="date" value={pay.date} onChange={ev => setPay({ ...pay, date: ev.target.value })} style={{ width: 140 }} />
            <input type="number" value={pay.amount} onChange={ev => setPay({ ...pay, amount: Number(ev.target.value) })} style={{ width: 130, textAlign: 'right' }} />
            <select value={pay.method} onChange={ev => setPay({ ...pay, method: ev.target.value })}>
              {['匯款', '支票', '現金', '刷卡'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input placeholder="附註（選填）" value={pay.note} onChange={ev => setPay({ ...pay, note: ev.target.value })} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn primary" onClick={addPayment}>確認收款</button>
          </div>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>未收餘額 {NT(inv.total - paid)}。收款累計達含稅總額時自動標記「已收款」。</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fld-grid">
          <label className="fld"><span>來源訂單</span>
            <select value={inv.order_id ?? ''} disabled={!editable} onChange={ev => pickOrder(ev.target.value)}>
              <option value="">（不掛訂單）</option>
              {orders.filter(o => o.status !== 'void').map(o => <option key={o.id} value={o.id}>{o.order_no}｜{o.title}</option>)}
            </select></label>
          <label className="fld"><span>客戶</span>
            <select value={inv.party_id ?? ''} disabled={!editable} onChange={ev => setInv({ ...inv, party_id: ev.target.value })}>
              <option value="">選擇客戶…</option>
              {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="fld wide"><span>標題</span>
            <input value={inv.title} readOnly={!editable} placeholder="例如：定序服務第 1 期款" onChange={ev => setInv({ ...inv, title: ev.target.value })} /></label>
          <label className="fld"><span>請款日</span>
            <input type="date" value={inv.issue_date ?? ''} readOnly={!editable} onChange={ev => setInv({ ...inv, issue_date: ev.target.value })} /></label>
          <label className="fld"><span>付款期限</span>
            <input type="date" value={inv.due_date ?? ''} readOnly={!editable} onChange={ev => setInv({ ...inv, due_date: ev.target.value })} /></label>
          <label className="fld"><span>統一發票號碼</span>
            <input value={inv.gui_no ?? ''} readOnly={!editable} placeholder="AB-12345678" onChange={ev => setInv({ ...inv, gui_no: ev.target.value })} /></label>
          <label className="fld"><span>稅率</span>
            <select value={String(rate)} disabled={!editable} onChange={ev => setInv({ ...inv, tax_rate: Number(ev.target.value) })}>
              <option value="0.05">5%（應稅）</option>
              <option value="0">0%（免稅／零稅率）</option>
            </select></label>
        </div>
        <div className="erp-thead" style={{ marginTop: 12 }}>
          <span style={{ flex: 1 }}>品項</span><span style={{ width: 64 }}>數量</span><span style={{ width: 64 }}>單位</span>
          <span style={{ width: 100, textAlign: 'right' }}>單價</span><span style={{ width: 110, textAlign: 'right' }}>金額</span>
          {editable && <span style={{ width: 32 }}></span>}
        </div>
        {inv.lines.map((l: InvLine, i: number) => (
          <div key={i} className="erp-trow">
            <input style={{ flex: 1 }} value={l.name} readOnly={!editable} placeholder="品項說明" onChange={ev => setLine(i, { name: ev.target.value })} />
            <input style={{ width: 64 }} type="number" value={l.qty} readOnly={!editable} onChange={ev => setLine(i, { qty: Number(ev.target.value) })} />
            <input style={{ width: 64 }} value={l.unit} readOnly={!editable} onChange={ev => setLine(i, { unit: ev.target.value })} />
            <input style={{ width: 100, textAlign: 'right' }} type="number" value={l.price} readOnly={!editable} onChange={ev => setLine(i, { price: Number(ev.target.value) })} />
            <span style={{ width: 110, textAlign: 'right' }} className="mono">{NT(Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)))}</span>
            {editable && <button className="btn subtle" style={{ width: 32 }} onClick={() => setInv({ ...inv, lines: inv.lines.filter((_: any, j: number) => j !== i) })}>✕</button>}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 }}>
          {editable ? <button className="btn" onClick={() => setInv({ ...inv, lines: [...inv.lines, emptyInvLine()] })}>＋ 加一行</button> : <span />}
          <div style={{ textAlign: 'right', lineHeight: 1.9 }}>
            <div className="muted">未稅 <span className="mono">{NT(amount)}</span>　稅額（{Math.round(rate * 100)}%）<span className="mono">{NT(tax)}</span></div>
            <b style={{ fontSize: 16 }}>含稅總額 <span className="mono">{NT(amount + tax)}</span></b>
            {paid > 0 && <div className="muted">已收 <span className="mono">{NT(paid)}</span>・未收 <span className="mono">{NT(inv.total - paid)}</span></div>}
          </div>
        </div>
        <label className="fld wide" style={{ marginTop: 10 }}><span>備註</span>
          <input value={inv.note ?? ''} readOnly={!editable} onChange={ev => setInv({ ...inv, note: ev.target.value })} /></label>
      </div>

      {id != null && inv.payments?.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label">收款紀錄</div>
          {inv.payments.map((p: any) => (
            <div key={p.id} className="member-row">
              <span className="mono">{p.date}</span><b className="mono">{NT(p.amount)}</b>
              <span className="muted">{p.method}{p.note ? `・${p.note}` : ''}</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>{p.creator}</span>
              {canWrite && <button className="btn subtle" onClick={async () => {
                if (confirm('刪除這筆收款紀錄？')) { await api.del(`/api/payments/${p.id}`); reload(id); }
              }}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {id != null && inv.events?.length > 0 && (
        <div className="card">
          <div className="side-label">歷程</div>
          {inv.events.map((ev: any, i: number) => (
            <div key={i} className="member-row"><span>{ev.action}</span><span className="muted" style={{ marginLeft: 'auto' }}>{ev.actor}・{ev.created_at.slice(5, 16)}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════ 應收帳款 ═══════════ */

function ARTab() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { api.get<any[]>('/api/ar').then(setList); }, []);
  const bucket = (d: number) => (d <= 0 ? '未到期' : d <= 30 ? '逾期 1–30 天' : d <= 60 ? '逾期 31–60 天' : d <= 90 ? '逾期 61–90 天' : '逾期 90 天以上');
  const buckets = ['未到期', '逾期 1–30 天', '逾期 31–60 天', '逾期 61–90 天', '逾期 90 天以上'];
  const sums = new Map<string, number>();
  for (const r of list) {
    const b = bucket(r.overdue_days ?? 0);
    sums.set(b, (sums.get(b) ?? 0) + (r.total - r.paid));
  }
  const totalOut = list.reduce((s, r) => s + (r.total - r.paid), 0);
  return (
    <section>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">帳齡總覽</div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '4px 0' }}>
          <div><div className="muted" style={{ fontSize: 12 }}>未收總額</div><b style={{ fontSize: 18 }} className="mono">{NT(totalOut)}</b></div>
          {buckets.map(b => (
            <div key={b}><div className="muted" style={{ fontSize: 12 }}>{b}</div>
              <b className={`mono ${b !== '未到期' && (sums.get(b) ?? 0) > 0 ? 'banner-over' : ''}`} style={{ fontSize: 15 }}>{NT(sums.get(b) ?? 0)}</b></div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="erp-thead">
          <span style={{ width: 110 }}>單號</span><span style={{ flex: 1 }}>客戶／標題</span>
          <span style={{ width: 100 }}>付款期限</span><span style={{ width: 110 }}>帳齡</span>
          <span style={{ width: 110, textAlign: 'right' }}>未收金額</span>
        </div>
        {list.map(r => {
          const days = r.overdue_days ?? 0;
          return (
            <div key={r.id} className="erp-trow">
              <span style={{ width: 110 }} className="mono">{r.inv_no}</span>
              <span style={{ flex: 1 }}><b>{r.party_name}</b><span className="muted" style={{ marginLeft: 6 }}>{r.title}{r.order_no ? `・${r.order_no}` : ''}</span></span>
              <span style={{ width: 100 }} className="mono">{r.due_date ?? '—'}</span>
              <span style={{ width: 110 }} className={days > 0 ? 'banner-over' : 'muted'}>{days > 0 ? `逾期 ${days} 天` : '未到期'}</span>
              <span style={{ width: 110, textAlign: 'right' }} className="mono">{NT(r.total - r.paid)}</span>
            </div>
          );
        })}
        {!list.length && <p className="muted" style={{ margin: '8px 0' }}>目前沒有未收清的請款單。</p>}
      </div>
    </section>
  );
}
