import { useEffect, useState } from 'react';
import { api, User } from './api';

type Item = {
  key: string; kind: 'comment' | 'event';
  author: string; color?: string; body: string; action?: string;
  created_at: string; commentId?: number; authorId?: number;
};
const ACTION_LABEL: Record<string, string> = { sign: '簽核', reject: '退回', close: '結案' };

/** 留言＋簽核事件合併時間軸（物件層共通：node / quote / order / expense…） */
export function Comments({ entityType, entityId, me, includeEvents = true }: {
  entityType: string; entityId: number; me: User; includeEvents?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState('');

  const load = async () => {
    const [comments, sigs] = await Promise.all([
      api.get<any[]>(`/api/comments?type=${entityType}&id=${entityId}`),
      includeEvents && entityType === 'node' ? api.get<any[]>(`/api/nodes/${entityId}/signatures`).catch(() => []) : Promise.resolve([]),
    ]);
    const list: Item[] = [
      ...comments.map(cm => ({
        key: `c${cm.id}`, kind: 'comment' as const, author: cm.author, color: cm.color,
        body: cm.body, created_at: cm.created_at, commentId: cm.id, authorId: cm.author_id,
      })),
      ...sigs.map((g: any, i: number) => ({
        key: `s${i}`, kind: 'event' as const, author: g.signer, action: g.action,
        body: g.note ?? '', created_at: g.created_at,
      })),
    ].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    setItems(list);
  };
  useEffect(() => { load(); }, [entityType, entityId]);

  const post = async () => {
    if (!draft.trim()) return;
    await api.post('/api/comments', { entity_type: entityType, entity_id: entityId, body: draft.trim() });
    setDraft('');
    await load();
  };

  return (
    <div className="cmt-wrap">
      {items.map(it => (
        <div key={it.key} className={`cmt ${it.kind}`}>
          <span className="av" style={{ background: it.color ?? 'var(--locked)', width: 22, height: 22, fontSize: 11, border: 'none', margin: 0 }}>
            {it.author?.[0] ?? '?'}
          </span>
          <div className="cmt-body">
            <div className="cmt-meta">
              <b>{it.author}</b>
              {it.kind === 'event' && <span className={`stchip ${it.action === 'reject' ? 'st-red' : it.action === 'sign' ? 'st-green' : 'st-grey'}`}>{ACTION_LABEL[it.action!] ?? it.action}</span>}
              <span className="muted">{it.created_at.slice(5, 16)}</span>
              {it.kind === 'comment' && (it.authorId === me.id || me.role === 'admin') && (
                <button className="btn subtle" style={{ padding: '0 4px', fontSize: 11 }}
                  onClick={async () => { await api.del(`/api/comments/${it.commentId}`); await load(); }}>✕</button>
              )}
            </div>
            {it.body && <div className="cmt-text">{it.body}</div>}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 8px' }}>還沒有留言。</p>}
      <div className="cmt-input">
        <input value={draft} placeholder="留言…（Enter 送出）" onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') post(); }} />
        <button className="btn primary" disabled={!draft.trim()} onClick={post}>送出</button>
      </div>
    </div>
  );
}
