import { useEffect, useState, FormEvent } from 'react';
import { api, User } from './api';
import { EntityDocs } from './DocsPage';

const NT = (n: number) => `NT$ ${Number(n || 0).toLocaleString('zh-TW')}`;
const QS: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'st-grey' }, sent: { label: '已送出', cls: 'st-blue' },
  won: { label: '成交', cls: 'st-green' }, lost: { label: '未成交', cls: 'st-grey' },
  void: { label: '作廢', cls: 'st-red' },
};
const OS: Record<string, { label: string; cls: string }> = {
  active: { label: '進行中', cls: 'st-blue' }, delivered: { label: '已交付', cls: 'st-amber' },
  invoiced: { label: '已請款', cls: 'st-amber' }, paid: { label: '已收款', cls: 'st-green' },
  void: { label: '作廢', cls: 'st-red' },
};
const Chip = ({ s, map }: { s: string; map: Record<string, { label: string; cls: string }> }) => (
  <span className={`stchip ${map[s]?.cls ?? 'st-grey'}`}>{map[s]?.label ?? s}</span>
);

type Tab = 'parties' | 'items' | 'quotes' | 'orders';

export function SalesPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [tab, setTab] = useState<Tab>('quotes');
  const canWrite = me.role === 'admin' || me.role === 'pm';
  return (
    <div className="app docs-app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>業務管理</h1></div>
        </div>
        <nav className="tabs">
          <button className={tab === 'parties' ? 'on' : ''} onClick={() => setTab('parties')}>客戶</button>
          <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>服務項目</button>
          <button className={tab === 'quotes' ? 'on' : ''} onClick={() => setTab('quotes')}>報價單</button>
          <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>訂單</button>
        </nav>
      </header>
      {tab === 'parties' && <PartiesTab me={me} canWrite={canWrite} />}
      {tab === 'items' && <ItemsTab canWrite={canWrite} />}
      {tab === 'quotes' && <QuotesTab me={me} canWrite={canWrite} onOrderCreated={() => setTab('orders')} />}
      {tab === 'orders' && <OrdersTab me={me} canWrite={canWrite} />}
    </div>
  );
}

/* ═══ 客戶 ═══ */
function PartiesTab({ me, canWrite }: { me: User; canWrite: boolean }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const reload = () => api.get<any[]>('/api/parties').then(setList);
  useEffect(() => { reload(); }, []);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    const r = await api.post<{ id: number }>('/api/parties', { name: f.get('name'), phone: f.get('phone'), email: f.get('email') });
    form.reset(); await reload(); setOpenId(r.id);
  };

  if (openId != null) return <PartyDetail id={openId} me={me} canWrite={canWrite} onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <section>
      {canWrite && (
        <form onSubmit={add} className="erp-add card">
          <input name="name" placeholder="客戶名稱（必填）" required style={{ flex: 2, minWidth: 160 }} />
          <input name="phone" placeholder="電話" style={{ flex: 1, minWidth: 110 }} />
          <input name="email" type="email" placeholder="Email" style={{ flex: 1, minWidth: 150 }} />
          <button className="btn primary" type="submit">＋ 新增客戶</button>
        </form>
      )}
      {list.map(p => (
        <button key={p.id} className="card proj-card" onClick={() => setOpenId(p.id)}>
          <span><b>{p.name}</b>{p.tax_id && <span className="muted mono" style={{ marginLeft: 8 }}>{p.tax_id}</span>}</span>
          <span className="muted">{p.contact_count} 位聯絡人・{p.quote_count} 張報價・{p.order_count} 張訂單</span>
        </button>
      ))}
      {!list.length && <p className="muted">還沒有客戶資料。</p>}
    </section>
  );
}

function PartyDetail({ id, me, canWrite, onBack }: { id: number; me: User; canWrite: boolean; onBack: () => void }) {
  const [p, setP] = useState<any>(null);
  const reload = () => api.get<any>(`/api/parties/${id}`).then(setP);
  useEffect(() => { reload(); }, [id]);
  if (!p) return <p className="muted">載入中…</p>;

  const save = (k: string) => async (e: any) => {
    if (e.target.value !== (p[k] ?? '')) { await api.patch(`/api/parties/${id}`, { [k]: e.target.value }); reload(); }
  };
  const addContact = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    await api.post(`/api/parties/${id}/contacts`, { name: f.get('name'), title: f.get('title'), phone: f.get('phone'), email: f.get('email') });
    form.reset(); reload();
  };

  const F = ({ k, label, wide }: { k: string; label: string; wide?: boolean }) => (
    <label className={`fld ${wide ? 'wide' : ''}`}><span>{label}</span>
      <input defaultValue={p[k] ?? ''} readOnly={!canWrite} onBlur={save(k)} /></label>
  );

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button className="btn" onClick={onBack}>← 客戶列表</button>
        <h2 style={{ margin: 0 }}>{p.name}</h2>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fld-grid">
          <F k="name" label="名稱" /><F k="tax_id" label="統一編號" /><F k="phone" label="電話" />
          <F k="email" label="Email" /><F k="address" label="地址" wide /><F k="note" label="備註" wide />
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">聯絡人</div>
        {p.contacts.map((ct: any) => (
          <div key={ct.id} className="member-row">
            <b>{ct.name}</b><span className="muted">{[ct.title, ct.phone, ct.email].filter(Boolean).join('・')}</span>
            {canWrite && <button className="btn subtle" style={{ marginLeft: 'auto' }}
              onClick={async () => { await api.del(`/api/contacts/${ct.id}`); reload(); }}>✕</button>}
          </div>
        ))}
        {canWrite && (
          <form onSubmit={addContact} className="member-add">
            <input name="name" placeholder="姓名" required style={{ width: 100 }} />
            <input name="title" placeholder="職稱" style={{ width: 100 }} />
            <input name="phone" placeholder="電話" style={{ width: 130 }} />
            <input name="email" placeholder="Email" style={{ width: 180 }} />
            <button className="btn" type="submit">＋ 聯絡人</button>
          </form>
        )}
      </div>
      {(p.quotes.length > 0 || p.orders.length > 0) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label">往來記錄</div>
          {p.quotes.map((q: any) => (
            <div key={`q${q.id}`} className="member-row"><span className="mono">{q.quote_no}</span><span>{q.title}</span>
              <Chip s={q.status} map={QS} /><span style={{ marginLeft: 'auto' }} className="mono">{NT(q.total)}</span></div>
          ))}
          {p.orders.map((o: any) => (
            <div key={`o${o.id}`} className="member-row"><span className="mono">{o.order_no}</span><span>{o.title}</span>
              <Chip s={o.status} map={OS} /><span style={{ marginLeft: 'auto' }} className="mono">{NT(o.total)}</span></div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="side-label">文件（合約、往來紀錄）</div>
        <EntityDocs entityType="party" entityId={id} me={me} onOpenDoc={() => alert('請到「文件中心」開啟編輯')} />
      </div>
    </section>
  );
}

/* ═══ 服務項目 ═══ */
function ItemsTab({ canWrite }: { canWrite: boolean }) {
  const [list, setList] = useState<any[]>([]);
  const reload = () => api.get<any[]>('/api/items').then(setList);
  useEffect(() => { reload(); }, []);
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    await api.post('/api/items', { name: f.get('name'), unit: f.get('unit') || '式', price: Number(f.get('price')) || 0 });
    form.reset(); reload();
  };
  const patch = (id: number, k: string) => async (e: any) => {
    await api.patch(`/api/items/${id}`, { [k]: k === 'price' ? Number(e.target.value) || 0 : e.target.value });
    reload();
  };
  return (
    <section>
      {canWrite && (
        <form onSubmit={add} className="erp-add card">
          <input name="name" placeholder="項目名稱（例如：全基因體定序分析）" required style={{ flex: 2, minWidth: 200 }} />
          <input name="unit" placeholder="單位（式/件/次）" style={{ width: 120 }} />
          <input name="price" type="number" placeholder="單價 NT$" style={{ width: 130 }} />
          <button className="btn primary" type="submit">＋ 新增項目</button>
        </form>
      )}
      <div className="card">
        <div className="erp-thead"><span style={{ flex: 2 }}>項目</span><span style={{ width: 80 }}>單位</span><span style={{ width: 120, textAlign: 'right' }}>單價</span><span style={{ width: 60 }}></span></div>
        {list.map(it => (
          <div key={it.id} className="erp-trow" style={{ opacity: it.active ? 1 : 0.45 }}>
            <input style={{ flex: 2 }} defaultValue={it.name} readOnly={!canWrite} onBlur={patch(it.id, 'name')} />
            <input style={{ width: 80 }} defaultValue={it.unit} readOnly={!canWrite} onBlur={patch(it.id, 'unit')} />
            <input style={{ width: 120, textAlign: 'right' }} type="number" defaultValue={it.price} readOnly={!canWrite} onBlur={patch(it.id, 'price')} />
            {canWrite && <button className="btn subtle" style={{ width: 60 }}
              onClick={async () => { await api.patch(`/api/items/${it.id}`, { active: it.active ? 0 : 1 }); reload(); }}>
              {it.active ? '停用' : '啟用'}</button>}
          </div>
        ))}
        {!list.length && <p className="muted" style={{ margin: '8px 0' }}>還沒有服務項目——先建幾個，報價單的明細會從這裡帶入。</p>}
      </div>
    </section>
  );
}

/* ═══ 報價單 ═══ */
type Line = { item_id: number | null; name: string; qty: number; unit: string; price: number };
const emptyLine = (): Line => ({ item_id: null, name: '', qty: 1, unit: '式', price: 0 });

function QuotesTab({ me, canWrite, onOrderCreated }: { me: User; canWrite: boolean; onOrderCreated: () => void }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  const reload = () => api.get<any[]>('/api/quotes').then(setList);
  useEffect(() => { reload(); }, []);

  if (openId != null) return (
    <QuoteEditor id={openId === 'new' ? null : openId} me={me} canWrite={canWrite}
      onBack={() => { setOpenId(null); reload(); }} onOrderCreated={onOrderCreated} />
  );
  return (
    <section>
      {canWrite && <div style={{ marginBottom: 12 }}><button className="btn primary" onClick={() => setOpenId('new')}>＋ 新報價單</button></div>}
      {list.map(q => (
        <button key={q.id} className="card proj-card" onClick={() => setOpenId(q.id)}>
          <span><span className="mono muted">{q.quote_no}</span> <b>{q.title || q.party_name}</b>
            <span className="muted" style={{ marginLeft: 8 }}>{q.party_name}</span></span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Chip s={q.status} map={QS} /><span className="mono">{NT(q.total)}</span></span>
        </button>
      ))}
      {!list.length && <p className="muted">還沒有報價單。</p>}
    </section>
  );
}

function QuoteEditor({ id, me, canWrite, onBack, onOrderCreated }: {
  id: number | null; me: User; canWrite: boolean; onBack: () => void; onOrderCreated: () => void;
}) {
  const [q, setQ] = useState<any>(id == null ? { status: 'draft', title: '', note: '', party_id: '', lines: [emptyLine()] } : null);
  const [parties, setParties] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const editable = canWrite && q?.status === 'draft';

  useEffect(() => {
    api.get<any[]>('/api/parties').then(setParties);
    api.get<any[]>('/api/items').then(setItems);
    if (id != null) api.get<any>(`/api/quotes/${id}`).then(d => setQ({ ...d, lines: d.lines.length ? d.lines : [emptyLine()] }));
  }, [id]);
  if (!q) return <p className="muted">載入中…</p>;

  const total = q.lines.reduce((s: number, l: Line) => s + Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)), 0);
  const setLine = (i: number, patch: Partial<Line>) => {
    const lines = q.lines.slice(); lines[i] = { ...lines[i], ...patch }; setQ({ ...q, lines });
  };
  const pickItem = (i: number, itemId: string) => {
    const it = items.find(x => x.id === Number(itemId));
    if (it) setLine(i, { item_id: it.id, name: it.name, unit: it.unit, price: it.price });
  };

  const save = async (): Promise<number | null> => {
    setErr('');
    if (!q.party_id) { setErr('請選擇客戶'); return null; }
    try {
      if (id == null) {
        const r = await api.post<{ id: number }>('/api/quotes', { party_id: Number(q.party_id), title: q.title, note: q.note, lines: q.lines });
        return r.id;
      }
      await api.put(`/api/quotes/${id}`, { party_id: Number(q.party_id), title: q.title, note: q.note, lines: q.lines });
      return id;
    } catch (ex: any) { setErr(ex.message); return null; }
  };
  const saveAnd = async (fn?: (qid: number) => Promise<void>) => {
    const qid = await save();
    if (qid == null) return;
    if (fn) await fn(qid);
    onBack();
  };
  const transition = (status: string, confirmMsg?: string) => async () => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    if (q.status === 'draft' && editable) await saveAnd(async qid => { await api.post(`/api/quotes/${qid}/status`, { status }); });
    else { await api.post(`/api/quotes/${id}/status`, { status }); onBack(); }
  };
  const convert = async () => {
    if (!confirm('標記成交並建立訂單？')) return;
    const r = await api.post<{ order_no: string }>(`/api/quotes/${id}/convert`);
    alert(`已成交！訂單 ${r.order_no} 已建立`);
    onOrderCreated();
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 報價單列表</button>
        <h2 style={{ margin: 0 }}>{id == null ? '新報價單' : q.quote_no}</h2>
        <Chip s={q.status} map={QS} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editable && <button className="btn" onClick={() => saveAnd()}>儲存草稿</button>}
          {editable && <button className="btn primary" onClick={transition('sent')}>送出報價</button>}
          {canWrite && q.status === 'sent' && <button className="btn primary" onClick={convert}>成交 → 建立訂單</button>}
          {canWrite && q.status === 'sent' && <button className="btn" onClick={transition('lost', '標記為未成交？')}>未成交</button>}
          {canWrite && ['draft', 'sent'].includes(q.status) && id != null &&
            <button className="btn subtle" onClick={transition('void', '作廢這張報價單？')}>作廢</button>}
        </span>
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fld-grid">
          <label className="fld"><span>客戶</span>
            <select value={q.party_id ?? ''} disabled={!editable} onChange={e => setQ({ ...q, party_id: e.target.value })}>
              <option value="">選擇客戶…</option>
              {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="fld wide"><span>標題</span>
            <input value={q.title} readOnly={!editable} placeholder="例如：2026 Q4 定序服務" onChange={e => setQ({ ...q, title: e.target.value })} /></label>
        </div>
        <div className="erp-thead" style={{ marginTop: 12 }}>
          <span style={{ width: 170 }}>帶入項目</span><span style={{ flex: 1 }}>名稱</span>
          <span style={{ width: 64 }}>數量</span><span style={{ width: 64 }}>單位</span>
          <span style={{ width: 100, textAlign: 'right' }}>單價</span><span style={{ width: 110, textAlign: 'right' }}>金額</span>
          {editable && <span style={{ width: 32 }}></span>}
        </div>
        {q.lines.map((l: Line, i: number) => (
          <div key={i} className="erp-trow">
            <select style={{ width: 170 }} value={l.item_id ?? ''} disabled={!editable} onChange={e => pickItem(i, e.target.value)}>
              <option value="">（自訂）</option>
              {items.filter(x => x.active).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <input style={{ flex: 1 }} value={l.name} readOnly={!editable} placeholder="品項說明" onChange={e => setLine(i, { name: e.target.value })} />
            <input style={{ width: 64 }} type="number" value={l.qty} readOnly={!editable} onChange={e => setLine(i, { qty: Number(e.target.value) })} />
            <input style={{ width: 64 }} value={l.unit} readOnly={!editable} onChange={e => setLine(i, { unit: e.target.value })} />
            <input style={{ width: 100, textAlign: 'right' }} type="number" value={l.price} readOnly={!editable} onChange={e => setLine(i, { price: Number(e.target.value) })} />
            <span style={{ width: 110, textAlign: 'right' }} className="mono">{NT(Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)))}</span>
            {editable && <button className="btn subtle" style={{ width: 32 }} onClick={() => setQ({ ...q, lines: q.lines.filter((_: any, j: number) => j !== i) })}>✕</button>}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          {editable ? <button className="btn" onClick={() => setQ({ ...q, lines: [...q.lines, emptyLine()] })}>＋ 加一行</button> : <span />}
          <b style={{ fontSize: 16 }}>合計 <span className="mono">{NT(total)}</span></b>
        </div>
        <label className="fld wide" style={{ marginTop: 10 }}><span>備註</span>
          <input value={q.note ?? ''} readOnly={!editable} onChange={e => setQ({ ...q, note: e.target.value })} /></label>
      </div>
      {id != null && q.events?.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label">歷程</div>
          {q.events.map((ev: any, i: number) => (
            <div key={i} className="member-row"><span>{ev.action}</span><span className="muted">{ev.actor}・{ev.created_at.slice(5, 16)}</span></div>
          ))}
        </div>
      )}
      {id != null && (
        <div className="card">
          <div className="side-label">附件文件</div>
          <EntityDocs entityType="quote" entityId={id} me={me} onOpenDoc={() => alert('請到「文件中心」開啟編輯')} />
        </div>
      )}
    </section>
  );
}

/* ═══ 訂單 ═══ */
function OrdersTab({ me, canWrite }: { me: User; canWrite: boolean }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const reload = () => api.get<any[]>('/api/orders').then(setList);
  useEffect(() => { reload(); }, []);

  if (openId != null) return <OrderDetail id={openId} me={me} canWrite={canWrite} onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <section>
      {list.map(o => (
        <button key={o.id} className="card proj-card" onClick={() => setOpenId(o.id)}>
          <span><span className="mono muted">{o.order_no}</span> <b>{o.title}</b>
            <span className="muted" style={{ marginLeft: 8 }}>{o.party_name}</span></span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Chip s={o.status} map={OS} /><span className="mono">{NT(o.total)}</span></span>
        </button>
      ))}
      {!list.length && <p className="muted">還沒有訂單——報價單成交後會自動出現在這裡。</p>}
    </section>
  );
}

function OrderDetail({ id, me, canWrite, onBack }: { id: number; me: User; canWrite: boolean; onBack: () => void }) {
  const [o, setO] = useState<any>(null);
  const reload = () => api.get<any>(`/api/orders/${id}`).then(setO);
  useEffect(() => { reload(); }, [id]);
  if (!o) return <p className="muted">載入中…</p>;

  const NEXT: Record<string, { status: string; label: string }> = {
    active: { status: 'delivered', label: '標記已交付' },
    delivered: { status: 'invoiced', label: '標記已請款' },
    invoiced: { status: 'paid', label: '標記已收款' },
  };
  const next = NEXT[o.status];

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 訂單列表</button>
        <h2 style={{ margin: 0 }}>{o.order_no}</h2>
        <Chip s={o.status} map={OS} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canWrite && next && <button className="btn primary" onClick={async () => {
            if (confirm(`${next.label}？`)) { await api.post(`/api/orders/${id}/status`, { status: next.status }); reload(); }
          }}>{next.label}</button>}
          {canWrite && !['paid', 'void'].includes(o.status) && <button className="btn subtle" onClick={async () => {
            if (confirm('作廢這張訂單？')) { await api.post(`/api/orders/${id}/status`, { status: 'void' }); reload(); }
          }}>作廢</button>}
        </span>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="member-row"><span className="muted">客戶</span><b>{o.party_name}</b>
          {o.quote_no && <span className="muted" style={{ marginLeft: 'auto' }}>來自報價 {o.quote_no}</span>}</div>
        <div className="member-row"><span className="muted">標題</span><b>{o.title}</b></div>
        <div className="erp-thead" style={{ marginTop: 10 }}>
          <span style={{ flex: 1 }}>品項</span><span style={{ width: 64 }}>數量</span><span style={{ width: 64 }}>單位</span>
          <span style={{ width: 100, textAlign: 'right' }}>單價</span><span style={{ width: 110, textAlign: 'right' }}>金額</span>
        </div>
        {o.lines.map((l: any) => (
          <div key={l.id} className="erp-trow">
            <span style={{ flex: 1 }}>{l.name}</span><span style={{ width: 64 }}>{l.qty}</span><span style={{ width: 64 }}>{l.unit}</span>
            <span style={{ width: 100, textAlign: 'right' }} className="mono">{NT(l.price)}</span>
            <span style={{ width: 110, textAlign: 'right' }} className="mono">{NT(l.amount)}</span>
          </div>
        ))}
        <div style={{ textAlign: 'right', marginTop: 10 }}><b style={{ fontSize: 16 }}>合計 <span className="mono">{NT(o.total)}</span></b></div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">交付專案</div>
        {o.project_id
          ? <p style={{ margin: '4px 0' }}>已連結專案：<b>{o.project_name}</b><span className="muted">（到「專案管理」開啟，拆解交付任務）</span></p>
          : canWrite
            ? <button className="btn" onClick={async () => {
                if (confirm('為這張訂單建立交付專案？')) { await api.post(`/api/orders/${id}/create-project`); reload(); }
              }}>＋ 建立交付專案（進入 PM 拆任務）</button>
            : <p className="muted" style={{ margin: '4px 0' }}>尚未建立交付專案</p>}
      </div>
      {o.events?.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label">歷程</div>
          {o.events.map((ev: any, i: number) => (
            <div key={i} className="member-row"><span>{ev.action}</span><span className="muted">{ev.actor}・{ev.created_at.slice(5, 16)}</span></div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="side-label">附件文件</div>
        <EntityDocs entityType="order" entityId={id} me={me} onOpenDoc={() => alert('請到「文件中心」開啟編輯')} />
      </div>
    </section>
  );
}
