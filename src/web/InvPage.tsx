/** 庫存與生產：料號主檔／批號庫存／出入庫／BOM／生產單／警示 */
import { useEffect, useState, FormEvent } from 'react';
import { api, User } from './api';

const NT = (n: number) => `NT$ ${Number(n || 0).toLocaleString('zh-TW')}`;
const WS: Record<string, { label: string; cls: string }> = {
  draft: { label: '已建立', cls: 'st-grey' }, in_progress: { label: '生產中', cls: 'st-blue' },
  done: { label: '已完工', cls: 'st-green' }, void: { label: '作廢', cls: 'st-red' },
};
const REASONS: Record<string, string> = {
  purchase_in: '採購入庫', manual_out: '領用出庫', production_out: '生產領料',
  production_in: '完工入庫', adjust: '盤點調整', scrap: '報廢',
};
const Chip = ({ s, map }: { s: string; map: Record<string, { label: string; cls: string }> }) => (
  <span className={`stchip ${map[s]?.cls ?? 'st-grey'}`}>{map[s]?.label ?? s}</span>
);

type Tab = 'materials' | 'wo' | 'alerts';

export function InvPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [tab, setTab] = useState<Tab>('materials');
  const [alertN, setAlertN] = useState(0);
  useEffect(() => {
    api.get<any>('/api/stock-alerts').then(a => setAlertN(a.low.length + a.expiring.length)).catch(() => {});
  }, [tab]);
  return (
    <div className="app docs-app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>庫存與生產</h1></div>
        </div>
        <nav className="tabs">
          <button className={tab === 'materials' ? 'on' : ''} onClick={() => setTab('materials')}>料號庫存</button>
          <button className={tab === 'wo' ? 'on' : ''} onClick={() => setTab('wo')}>生產單</button>
          <button className={tab === 'alerts' ? 'on' : ''} onClick={() => setTab('alerts')}>
            警示{alertN > 0 && <span className="stchip st-red" style={{ marginLeft: 5 }}>{alertN}</span>}
          </button>
        </nav>
      </header>
      {tab === 'materials' && <MaterialsTab me={me} />}
      {tab === 'wo' && <WoTab me={me} />}
      {tab === 'alerts' && <AlertsTab />}
    </div>
  );
}

/* ═══ 料號庫存 ═══ */
function MaterialsTab({ me }: { me: User }) {
  const [list, setList] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const canWrite = me.role === 'admin' || me.role === 'pm';
  const reload = () => {
    api.get<any[]>('/api/materials').then(setList);
    api.get<any[]>('/api/mat-categories').then(setCats);
  };
  useEffect(() => { reload(); }, []);

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    setErr('');
    try {
      const r = await api.post<{ id: number }>('/api/materials', {
        category_id: Number(f.get('cat')), name: f.get('name'), spec: f.get('spec') || null,
        unit: f.get('unit') || '個', safe_stock: Number(f.get('safe')) || 0,
      });
      form.reset(); await reload(); setOpenId(r.id);
    } catch (ex: any) { setErr(ex.message); }
  };

  if (openId != null) return <MaterialDetail id={openId} me={me} canWrite={canWrite} materials={list}
    onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <section>
      {canWrite && (
        <form onSubmit={add} className="erp-add card">
          <select name="cat" required style={{ width: 130 }} aria-label="料號類別">
            {cats.map(cc => <option key={cc.id} value={cc.id}>{cc.code}｜{cc.name}</option>)}
          </select>
          <input name="name" placeholder="品名（必填）" required style={{ flex: 2, minWidth: 160 }} />
          <input name="spec" placeholder="規格" style={{ flex: 1, minWidth: 100 }} />
          <input name="unit" placeholder="單位" style={{ width: 70 }} />
          <input name="safe" type="number" placeholder="安全庫存" style={{ width: 100 }} />
          <button className="btn primary" type="submit">＋ 建料號</button>
        </form>
      )}
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="card">
        <div className="erp-thead">
          <span style={{ width: 90 }}>料號</span><span style={{ flex: 1 }}>品名／規格</span>
          <span style={{ width: 90 }}>類別</span><span style={{ width: 110, textAlign: 'right' }}>庫存</span>
          <span style={{ width: 90, textAlign: 'right' }}>安全庫存</span>
        </div>
        {list.map(m => (
          <button key={m.id} className="erp-trow" style={{ cursor: 'pointer', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--surface-2)', opacity: m.active ? 1 : 0.45 }}
            onClick={() => setOpenId(m.id)}>
            <span style={{ width: 90 }} className="mono">{m.mat_no}</span>
            <span style={{ flex: 1, textAlign: 'left' }}><b>{m.name}</b>{m.spec && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>{m.spec}</span>}</span>
            <span style={{ width: 90 }} className="muted">{m.cat_name}</span>
            <span style={{ width: 110, textAlign: 'right' }} className={`mono ${m.safe_stock > 0 && m.stock < m.safe_stock ? 'banner-over' : ''}`}>
              {m.stock} {m.unit}</span>
            <span style={{ width: 90, textAlign: 'right' }} className="muted mono">{m.safe_stock || '—'}</span>
          </button>
        ))}
        {!list.length && <p className="muted" style={{ margin: '8px 0' }}>還沒有料號。先建類別下的第一筆料，庫存與生產都從這裡開始。</p>}
      </div>
    </section>
  );
}

function MaterialDetail({ id, me, canWrite, materials, onBack }: {
  id: number; me: User; canWrite: boolean; materials: any[]; onBack: () => void;
}) {
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState('');
  const [mv, setMv] = useState<any>(null);       // 出入庫表單
  const [bomEdit, setBomEdit] = useState<any[] | null>(null);
  const reload = () => api.get<any>(`/api/materials/${id}`).then(setM);
  useEffect(() => { reload(); }, [id]);
  if (!m) return <p className="muted">載入中…</p>;

  const patch = (k: string) => async (e: any) => {
    const v = e.target.type === 'number' ? Number(e.target.value) || 0 : e.target.value;
    await api.patch(`/api/materials/${id}`, { [k]: v });
    reload();
  };
  const doMove = async () => {
    setErr('');
    try {
      await api.post(`/api/materials/${id}/moves`, {
        qty: mv.dir === 'out' ? -Math.abs(Number(mv.qty)) : Math.abs(Number(mv.qty)),
        reason: mv.reason, lot_no: mv.lot_no || null, expiry: mv.expiry || null, note: mv.note || null,
      });
      setMv(null); reload();
    } catch (ex: any) { setErr(ex.message); }
  };
  const saveBom = async () => {
    setErr('');
    try { await api.put(`/api/materials/${id}/bom`, { lines: bomEdit }); setBomEdit(null); reload(); }
    catch (ex: any) { setErr(ex.message); }
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 料號清單</button>
        <h2 style={{ margin: 0 }} className="mono">{m.mat_no}</h2>
        <b>{m.name}</b>
        <span className="stchip st-blue">{m.cat_name}</span>
        {!!m.track_lot && <span className="stchip st-amber">批號管理</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => setMv(mv ? null : { dir: 'in', qty: '', reason: 'purchase_in', lot_no: '', expiry: '', note: '' })}>出入庫…</button>
          {canWrite && <button className="btn subtle" onClick={async () => {
            await api.patch(`/api/materials/${id}`, { active: m.active ? 0 : 1 }); reload();
          }}>{m.active ? '停用' : '啟用'}</button>}
        </span>
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      {mv && (
        <div className="card sign-box" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={mv.dir} onChange={e => setMv({ ...mv, dir: e.target.value, reason: e.target.value === 'in' ? 'purchase_in' : 'manual_out' })}>
              <option value="in">入庫 ＋</option><option value="out">出庫 −</option>
            </select>
            <select value={mv.reason} onChange={e => setMv({ ...mv, reason: e.target.value })}>
              {(mv.dir === 'in' ? ['purchase_in', 'production_in', 'adjust'] : ['manual_out', 'scrap', 'adjust'])
                .map(rr => <option key={rr} value={rr}>{REASONS[rr]}</option>)}
            </select>
            <input type="number" step="any" placeholder={`數量（${m.unit}）`} value={mv.qty} onChange={e => setMv({ ...mv, qty: e.target.value })} style={{ width: 110 }} />
            {!!m.track_lot && <input placeholder="批號" value={mv.lot_no} onChange={e => setMv({ ...mv, lot_no: e.target.value })} style={{ width: 130 }} list={mv.dir === 'out' ? 'lot-list' : undefined} />}
            {!!m.track_lot && mv.dir === 'out' && (
              <datalist id="lot-list">{m.lots.map((l: any) => <option key={l.lot_no} value={l.lot_no}>{`結存 ${l.qty}`}</option>)}</datalist>
            )}
            {!!m.track_lot && mv.dir === 'in' && <input type="date" title="效期" value={mv.expiry} min={today} onChange={e => setMv({ ...mv, expiry: e.target.value })} />}
            <input placeholder="附註" value={mv.note} onChange={e => setMv({ ...mv, note: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
            <button className="btn primary" onClick={doMove} disabled={!Number(mv.qty)}>確認</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">基本資料（目前庫存 <b className={`mono ${m.safe_stock > 0 && m.stock < m.safe_stock ? 'banner-over' : ''}`}>{m.stock} {m.unit}</b>）</div>
        <div className="fld-grid">
          <label className="fld"><span>品名</span><input defaultValue={m.name} readOnly={!canWrite} onBlur={patch('name')} /></label>
          <label className="fld"><span>規格</span><input defaultValue={m.spec ?? ''} readOnly={!canWrite} onBlur={patch('spec')} /></label>
          <label className="fld"><span>單位</span><input defaultValue={m.unit} readOnly={!canWrite} onBlur={patch('unit')} /></label>
          <label className="fld"><span>安全庫存</span><input type="number" defaultValue={m.safe_stock} readOnly={!canWrite} onBlur={patch('safe_stock')} /></label>
          <label className="fld"><span>參考單價</span><input type="number" defaultValue={m.cost} readOnly={!canWrite} onBlur={patch('cost')} /></label>
          <label className="fld"><span>存放位置</span><input defaultValue={m.location ?? ''} readOnly={!canWrite} onBlur={patch('location')} /></label>
          <label className="fld wide"><span>備註</span><input defaultValue={m.note ?? ''} readOnly={!canWrite} onBlur={patch('note')} /></label>
        </div>
      </div>

      {!!m.track_lot && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label">批號結存（出庫依效期先進先出）</div>
          {m.lots.map((l: any) => {
            const days = l.expiry ? Math.round((new Date(l.expiry).getTime() - Date.now()) / 86400000) : null;
            return (
              <div key={l.lot_no || '-'} className="member-row">
                <span className="mono">{l.lot_no || '（無批號）'}</span>
                <b className="mono">{l.qty} {m.unit}</b>
                <span className={`muted mono ${days != null && days <= 30 ? 'banner-over' : ''}`} style={{ marginLeft: 'auto' }}>
                  {l.expiry ? `效期 ${l.expiry}${days != null && days <= 30 ? `（剩 ${days} 天）` : ''}` : '無效期'}
                </span>
              </div>
            );
          })}
          {!m.lots.length && <p className="muted" style={{ margin: '4px 0' }}>目前沒有結存批號。</p>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>BOM 用料清單（每 1 {m.unit} {m.name} 的用料；生產單開工時照這裡領料）</span>
          {canWrite && !bomEdit && <button className="btn" onClick={() => setBomEdit(m.bom.map((b: any) => ({ component_id: b.component_id, qty: b.qty })).concat([{ component_id: '', qty: 1 }]))}>編輯 BOM</button>}
        </div>
        {!bomEdit && m.bom.map((b: any) => (
          <div key={b.id} className="member-row">
            <span className="mono">{b.component_no}</span><b>{b.component_name}</b>
            <span className="mono" style={{ marginLeft: 'auto' }}>{b.qty} {b.component_unit}</span>
          </div>
        ))}
        {!bomEdit && !m.bom.length && <p className="muted" style={{ margin: '4px 0' }}>還沒有 BOM。要用生產單產出這個料號，先在這裡設定用料。</p>}
        {bomEdit && (
          <>
            {bomEdit.map((l: any, i: number) => (
              <div key={i} className="erp-trow">
                <select style={{ flex: 1 }} value={l.component_id} onChange={e => {
                  const next = bomEdit.slice(); next[i] = { ...l, component_id: Number(e.target.value) || '' }; setBomEdit(next);
                }}>
                  <option value="">選擇用料…</option>
                  {materials.filter(x => x.id !== id && x.active).map(x =>
                    <option key={x.id} value={x.id}>{x.mat_no}｜{x.name}</option>)}
                </select>
                <input type="number" step="any" style={{ width: 100, textAlign: 'right' }} value={l.qty}
                  onChange={e => { const next = bomEdit.slice(); next[i] = { ...l, qty: Number(e.target.value) }; setBomEdit(next); }} />
                <button className="btn subtle" style={{ width: 32 }} onClick={() => setBomEdit(bomEdit.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={() => setBomEdit([...bomEdit, { component_id: '', qty: 1 }])}>＋ 加一行</button>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setBomEdit(null)}>取消</button>
                <button className="btn primary" onClick={saveBom}>儲存 BOM</button>
              </span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="side-label">最近異動</div>
        {m.moves.map((mvr: any) => (
          <div key={mvr.id} className="member-row">
            <b className={`mono ${mvr.qty < 0 ? 'banner-over' : ''}`} style={mvr.qty > 0 ? { color: 'var(--ok)' } : {}}>
              {mvr.qty > 0 ? '＋' : ''}{mvr.qty}</b>
            <span>{REASONS[mvr.reason] ?? mvr.reason}</span>
            {mvr.lot_no && <span className="mono muted">批 {mvr.lot_no}</span>}
            {mvr.wo_no && <span className="mono muted">{mvr.wo_no}</span>}
            {mvr.note && <span className="muted">{mvr.note}</span>}
            <span className="muted" style={{ marginLeft: 'auto' }}>{mvr.actor}・{mvr.created_at.slice(5, 16)}</span>
          </div>
        ))}
        {!m.moves.length && <p className="muted" style={{ margin: '4px 0' }}>還沒有異動紀錄。</p>}
      </div>
    </section>
  );
}

/* ═══ 生產單 ═══ */
function WoTab({ me }: { me: User }) {
  const [list, setList] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [mats, setMats] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: '', qty: 1, note: '' });
  const [err, setErr] = useState('');
  const canWrite = me.role === 'admin' || me.role === 'pm';
  const reload = () => api.get<any[]>('/api/work-orders').then(setList);
  useEffect(() => { reload(); api.get<any[]>('/api/materials').then(setMats); }, []);

  const create = async () => {
    setErr('');
    try {
      const r = await api.post<{ id: number }>('/api/work-orders', { product_id: Number(form.product_id), qty: form.qty, note: form.note });
      setShowNew(false); setForm({ product_id: '', qty: 1, note: '' });
      await reload(); setOpenId(r.id);
    } catch (ex: any) { setErr(ex.message); }
  };

  if (openId != null) return <WoDetail id={openId} canWrite={canWrite} onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <section>
      {canWrite && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" onClick={() => setShowNew(!showNew)}>＋ 新生產單</button>
          {showNew && (
            <div className="card sign-box" style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} style={{ minWidth: 220 }}>
                  <option value="">選擇要生產的料號（需已設 BOM）…</option>
                  {mats.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.mat_no}｜{x.name}</option>)}
                </select>
                <input type="number" step="any" value={form.qty} onChange={e => setForm({ ...form, qty: Number(e.target.value) })} style={{ width: 100 }} />
                <input placeholder="附註（選填）" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
                <button className="btn primary" onClick={create} disabled={!form.product_id || form.qty <= 0}>建立</button>
              </div>
              {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
            </div>
          )}
        </div>
      )}
      {list.map(w => (
        <button key={w.id} className="card proj-card" onClick={() => setOpenId(w.id)}>
          <span><span className="mono muted">{w.wo_no}</span> <b>{w.product_name}</b>
            <span className="muted" style={{ marginLeft: 8 }}>×{w.qty} {w.unit}{w.lot_no ? `・批 ${w.lot_no}` : ''}</span></span>
          <Chip s={w.status} map={WS} />
        </button>
      ))}
      {!list.length && <p className="muted">還沒有生產單。</p>}
    </section>
  );
}

function WoDetail({ id, canWrite, onBack }: { id: number; canWrite: boolean; onBack: () => void }) {
  const [w, setW] = useState<any>(null);
  const [err, setErr] = useState('');
  const [finishBox, setFinishBox] = useState<{ lot_no: string; expiry: string } | null>(null);
  const reload = () => api.get<any>(`/api/work-orders/${id}`).then(setW);
  useEffect(() => { reload(); }, [id]);
  if (!w) return <p className="muted">載入中…</p>;

  const act = async (action: string, extra: any = {}) => {
    setErr('');
    try { await api.post(`/api/work-orders/${id}/action`, { action, ...extra }); setFinishBox(null); reload(); }
    catch (ex: any) { setErr(ex.message); }
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onBack}>← 生產單列表</button>
        <h2 style={{ margin: 0 }} className="mono">{w.wo_no}</h2>
        <b>{w.product_name} ×{w.qty} {w.unit}</b>
        <Chip s={w.status} map={WS} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canWrite && w.status === 'draft' &&
            <button className="btn primary" onClick={() => { if (confirm('照 BOM 領料開工？（依效期先進先出扣批號）')) act('start'); }}>領料開工</button>}
          {canWrite && w.status === 'in_progress' &&
            <button className="btn primary" onClick={() => setFinishBox(finishBox ? null : { lot_no: '', expiry: '' })}>完工入庫…</button>}
          {canWrite && ['draft', 'in_progress'].includes(w.status) &&
            <button className="btn subtle" onClick={() => {
              if (confirm(w.status === 'in_progress' ? '作廢並把已領的料退回庫存？' : '作廢這張生產單？')) act('void');
            }}>作廢</button>}
        </span>
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      {finishBox && (
        <div className="card sign-box" style={{ marginBottom: 12 }}>
          <b>完工入庫：{w.product_name} ×{w.qty} {w.unit}</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            {!!w.product_track_lot && <input placeholder="產出批號（必填）" value={finishBox.lot_no} onChange={e => setFinishBox({ ...finishBox, lot_no: e.target.value })} style={{ width: 160 }} />}
            {!!w.product_track_lot && <input type="date" title="產出效期" value={finishBox.expiry} onChange={e => setFinishBox({ ...finishBox, expiry: e.target.value })} />}
            <button className="btn primary" onClick={() => act('finish', finishBox)}>確認入庫</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="side-label">用料需求（BOM ×{w.qty}）</div>
        <div className="erp-thead">
          <span style={{ width: 90 }}>料號</span><span style={{ flex: 1 }}>品名</span>
          <span style={{ width: 100, textAlign: 'right' }}>需求</span><span style={{ width: 100, textAlign: 'right' }}>現有庫存</span>
        </div>
        {w.requirements.map((r: any) => (
          <div key={r.component_id} className="erp-trow">
            <span style={{ width: 90 }} className="mono">{r.mat_no}</span>
            <span style={{ flex: 1 }}>{r.name}</span>
            <span style={{ width: 100, textAlign: 'right' }} className="mono">{r.need} {r.unit}</span>
            <span style={{ width: 100, textAlign: 'right' }} className={`mono ${r.enough ? '' : 'banner-over'}`}>{r.stock} {r.unit}</span>
          </div>
        ))}
      </div>

      {w.moves.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="side-label">關聯異動（領料／入庫）</div>
          {w.moves.map((mv: any) => (
            <div key={mv.id} className="member-row">
              <span className="mono">{mv.mat_no}</span><span>{mv.mat_name}</span>
              <b className="mono" style={mv.qty > 0 ? { color: 'var(--ok)' } : {}}>{mv.qty > 0 ? '＋' : ''}{mv.qty}</b>
              {mv.lot_no && <span className="mono muted">批 {mv.lot_no}</span>}
              <span className="muted" style={{ marginLeft: 'auto' }}>{mv.created_at.slice(5, 16)}</span>
            </div>
          ))}
        </div>
      )}
      {w.events?.length > 0 && (
        <div className="card">
          <div className="side-label">歷程</div>
          {w.events.map((ev: any, i: number) => (
            <div key={i} className="member-row"><span>{ev.action}</span><span className="muted" style={{ marginLeft: 'auto' }}>{ev.actor}・{ev.created_at.slice(5, 16)}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══ 警示 ═══ */
function AlertsTab() {
  const [a, setA] = useState<{ low: any[]; expiring: any[] } | null>(null);
  useEffect(() => { api.get<any>('/api/stock-alerts').then(setA); }, []);
  if (!a) return <p className="muted">載入中…</p>;
  return (
    <section>
      <div className="card" style={{ marginBottom: 14, borderColor: a.low.length ? 'var(--danger)' : undefined }}>
        <div className="side-label">低於安全庫存（{a.low.length}）</div>
        {a.low.map(m => (
          <div key={m.id} className="member-row">
            <span className="mono">{m.mat_no}</span><b>{m.name}</b>
            <span style={{ marginLeft: 'auto' }} className="mono banner-over">{m.stock} / 安全 {m.safe_stock} {m.unit}</span>
          </div>
        ))}
        {!a.low.length && <p className="muted" style={{ margin: '4px 0' }}>沒有低庫存料號。</p>}
      </div>
      <div className="card" style={{ borderColor: a.expiring.length ? 'var(--warn)' : undefined }}>
        <div className="side-label">30 天內到期批號（{a.expiring.length}）</div>
        {a.expiring.map((l: any) => (
          <div key={`${l.id}-${l.lot_no}`} className="member-row">
            <span className="mono">{l.mat_no}</span><b>{l.name}</b>
            <span className="mono muted">批 {l.lot_no}・{l.qty} {l.unit}</span>
            <span style={{ marginLeft: 'auto' }} className={`mono ${l.days_left <= 7 ? 'banner-over' : ''}`}>
              {l.expiry}（剩 {l.days_left} 天）</span>
          </div>
        ))}
        {!a.expiring.length && <p className="muted" style={{ margin: '4px 0' }}>沒有即將到期的批號。</p>}
      </div>
    </section>
  );
}
