import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { api, User } from './api';

type FolderT = { id: number; parent_id: number | null; name: string; restricted: number; my_level: string };
type DocMeta = { id: number; folder_id: number | null; title: string; restricted: number; is_template?: number; updated_at: string; my_level: string };
type Tree = { folders: FolderT[]; docs: DocMeta[] };

/* ═══════════ 文件中心主頁 ═══════════ */
export function DocsPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [curDoc, setCurDoc] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DocMeta[] | null>(null);
  const [curFolder, setCurFolder] = useState<number | null>(null);

  const reload = () => api.get<Tree>('/api/docs/tree').then(setTree);
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const t = setTimeout(() => api.get<DocMeta[]>(`/api/docs-search?q=${encodeURIComponent(q)}`).then(setHits), 300);
    return () => clearTimeout(t);
  }, [q]);

  const newDoc = async () => {
    const r = await api.post<{ id: number }>('/api/docs', { folder_id: curFolder });
    await reload();
    setCurDoc(r.id);
  };
  const newTemplate = async () => {
    const title = prompt('模版名稱？（例如：實驗記錄表、請購單）');
    if (!title?.trim()) return;
    const r = await api.post<{ id: number }>('/api/docs', { title, is_template: 1 });
    await reload();
    setCurDoc(r.id);
  };
  const newFolder = async () => {
    const name = prompt('資料夾名稱？');
    if (!name?.trim()) return;
    await api.post('/api/folders', { name, parent_id: curFolder });
    await reload();
  };

  if (!tree) return <div className="app"><p className="muted">載入中…</p></div>;

  const renderFolder = (parent: number | null, depth: number): JSX.Element[] => {
    const out: JSX.Element[] = [];
    for (const f of tree.folders.filter(x => x.parent_id === parent)) {
      out.push(
        <button key={`f${f.id}`} className={`side-item folder ${curFolder === f.id ? 'on' : ''}`}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => setCurFolder(curFolder === f.id ? f.parent_id : f.id)}>
          <span className="fico">▸</span>{f.name}{!!f.restricted && <span className="lockmark">🔒</span>}
        </button>
      );
      out.push(...renderFolder(f.id, depth + 1));
      for (const d of tree.docs.filter(x => x.folder_id === f.id && !x.is_template)) {
        out.push(
          <button key={`d${d.id}`} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`}
            style={{ paddingLeft: 28 + depth * 16 }} onClick={() => setCurDoc(d.id)}>
            {d.title || '未命名文件'}{!!d.restricted && <span className="lockmark">🔒</span>}
          </button>
        );
      }
    }
    return out;
  };
  const rootDocs = tree.docs.filter(d => !d.is_template && (d.folder_id == null || !tree.folders.some(f => f.id === d.folder_id)));
  const templates = tree.docs.filter(d => d.is_template);

  return (
    <div className="app docs-app">
      <header className="home-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={onHome}>← 首頁</button>
          <div><div className="eyebrow">功能模組</div><h1>文件中心</h1></div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={newFolder}>＋ 資料夾</button>
          <button className="btn" onClick={newTemplate}>＋ 新模版</button>
          <button className="btn primary" onClick={newDoc}>＋ 新文件</button>
        </div>
      </header>
      <div className="docs-layout">
        <aside className="docs-side">
          <input className="doc-search" placeholder="搜尋文件…" value={q} onChange={e => setQ(e.target.value)} />
          {hits !== null ? (
            <>
              <div className="side-label">搜尋結果（{hits.length}）</div>
              {hits.map(d => (
                <button key={d.id} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`} onClick={() => setCurDoc(d.id)}>
                  {d.title || '未命名文件'}
                </button>
              ))}
            </>
          ) : (
            <>
              {templates.length > 0 && <div className="side-label">表單模版</div>}
              {templates.map(d => (
                <button key={`t${d.id}`} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`} onClick={() => setCurDoc(d.id)}>
                  <span className="tpl-badge">模</span>{d.title || '未命名模版'}
                </button>
              ))}
              {curFolder != null && <div className="side-label">新文件會建立在：{tree.folders.find(f => f.id === curFolder)?.name}</div>}
              {renderFolder(null, 0)}
              {rootDocs.length > 0 && <div className="side-label">未分類</div>}
              {rootDocs.map(d => (
                <button key={d.id} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`} onClick={() => setCurDoc(d.id)}>
                  {d.title || '未命名文件'}{!!d.restricted && <span className="lockmark">🔒</span>}
                </button>
              ))}
              {tree.docs.length === 0 && <p className="muted" style={{ padding: '8px 12px' }}>還沒有文件，按「＋ 新文件」開始。</p>}
            </>
          )}
        </aside>
        <main className="docs-main">
          {curDoc == null
            ? <div className="doc-empty muted">選一份文件，或建立新文件</div>
            : <DocEditor key={curDoc} docId={curDoc} me={me} folders={tree.folders} onMetaChanged={reload}
                onDeleted={() => { setCurDoc(null); reload(); }} onOpenDoc={id => { setCurDoc(id); reload(); }} />}
        </main>
      </div>
    </div>
  );
}

/* ═══════════ 編輯器（可獨立嵌入 PM）═══════════ */
export function DocEditor({ docId, me, folders, onMetaChanged, onDeleted, onOpenDoc }: {
  docId: number; me: User; folders: FolderT[]; onMetaChanged: () => void; onDeleted: () => void;
  onOpenDoc?: (id: number) => void;
}) {
  const [doc, setDoc] = useState<any>(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [panel, setPanel] = useState<'none' | 'versions' | 'perms'>('none');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const titleTimer = useRef<ReturnType<typeof setTimeout>>();
  const canEdit = doc && (doc.my_level === 'edit' || doc.my_level === 'manage');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: '開始輸入內容…（支援 Markdown 快捷鍵，例如 # 標題、- 清單）' }),
      Table.configure({ resizable: false }), TableRow, TableCell, TableHeader,
      TaskList, TaskItem.configure({ nested: true }),
    ],
    editable: false,
    onUpdate: ({ editor }) => {
      setSaved('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await api.put(`/api/docs/${docId}/content`, {
          content_json: JSON.stringify(editor.getJSON()),
          content_html: editor.getHTML(),
          content_text: editor.getText(),
        });
        setSaved('saved');
      }, 1500);
    },
  });

  useEffect(() => {
    api.get<any>(`/api/docs/${docId}`).then(d => {
      setDoc(d);
      if (editor) {
        try { editor.commands.setContent(JSON.parse(d.content_json || '{}')); } catch { /* empty */ }
        editor.setEditable(d.my_level === 'edit' || d.my_level === 'manage');
      }
    });
    return () => clearTimeout(saveTimer.current);
  }, [docId, editor]);

  if (!doc || !editor) return <p className="muted">載入中…</p>;

  const setTitle = (title: string) => {
    setDoc({ ...doc, title });
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => { await api.patch(`/api/docs/${docId}`, { title }); onMetaChanged(); }, 800);
  };

  const uploadImage = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (res.ok && data.url) editor.chain().focus().setImage({ src: data.url }).run();
      else alert(data.error || '上傳失敗');
    };
    input.click();
  };

  const B = ({ label, act, active, title }: { label: string; act: () => void; active?: boolean; title: string }) => (
    <button className={`tb ${active ? 'on' : ''}`} title={title} onMouseDown={e => { e.preventDefault(); act(); }}>{label}</button>
  );

  return (
    <div className="doc-editor">
      <div className="doc-head">
        {!!doc.is_template && <span className="stchip st-amber" style={{ flex: 'none' }}>模版</span>}
        <input className="doc-title" value={doc.title} placeholder="文件標題" readOnly={!canEdit}
          onChange={e => setTitle(e.target.value)} />
        <div className="doc-headr">
          {!!doc.is_template && (
            <button className="btn primary" onClick={async () => {
              const title = prompt('新文件標題？', doc.title);
              if (title === null) return;
              const r = await api.post<{ id: number }>('/api/docs', { template_id: docId, title });
              onMetaChanged();
              if (onOpenDoc) onOpenDoc(r.id);
              else alert(`已由模版建立文件「${title || doc.title}」`);
            }}>用此模版建立文件</button>
          )}
          {!doc.is_template && canEdit && (
            <button className="btn" title="把目前內容存成一份可重複使用的模版" onClick={async () => {
              const r = await api.post<{ id: number }>(`/api/docs/${docId}/save-as-template`);
              onMetaChanged();
              if (onOpenDoc) onOpenDoc(r.id);
              else alert('已另存為模版');
            }}>另存為模版</button>
          )}
          <span className="muted save-state">{saved === 'saving' ? '儲存中…' : saved === 'saved' ? '已儲存' : `v${doc.version_no}`}</span>
          <select value={doc.folder_id ?? ''} disabled={!canEdit} aria-label="所在資料夾"
            onChange={async e => { await api.patch(`/api/docs/${docId}`, { folder_id: e.target.value ? Number(e.target.value) : null }); onMetaChanged(); }}>
            <option value="">未分類</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button className="btn" onClick={() => setPanel(panel === 'versions' ? 'none' : 'versions')}>版本</button>
          {doc.my_level === 'manage' && <button className="btn" onClick={() => setPanel(panel === 'perms' ? 'none' : 'perms')}>權限</button>}
          {doc.my_level === 'manage' && <button className="btn subtle" onClick={async () => {
            if (confirm(`刪除文件「${doc.title}」？`)) { await api.del(`/api/docs/${docId}`); onDeleted(); }
          }}>✕</button>}
        </div>
      </div>

      {canEdit && (
        <div className="toolbar">
          <B label="B" title="粗體" active={editor.isActive('bold')} act={() => editor.chain().focus().toggleBold().run()} />
          <B label="I" title="斜體" active={editor.isActive('italic')} act={() => editor.chain().focus().toggleItalic().run()} />
          <B label="S" title="刪除線" active={editor.isActive('strike')} act={() => editor.chain().focus().toggleStrike().run()} />
          <span className="tsep" />
          <B label="H1" title="大標題" active={editor.isActive('heading', { level: 1 })} act={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
          <B label="H2" title="標題" active={editor.isActive('heading', { level: 2 })} act={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <B label="H3" title="小標題" active={editor.isActive('heading', { level: 3 })} act={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <span className="tsep" />
          <B label="•" title="項目清單" active={editor.isActive('bulletList')} act={() => editor.chain().focus().toggleBulletList().run()} />
          <B label="1." title="編號清單" active={editor.isActive('orderedList')} act={() => editor.chain().focus().toggleOrderedList().run()} />
          <B label="☑" title="待辦清單" active={editor.isActive('taskList')} act={() => editor.chain().focus().toggleTaskList().run()} />
          <span className="tsep" />
          <B label="表" title="插入表格" act={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          <B label="圖" title="插入圖片" act={uploadImage} />
          <B label="&lt;/&gt;" title="程式碼區塊" active={editor.isActive('codeBlock')} act={() => editor.chain().focus().toggleCodeBlock().run()} />
          <B label="❝" title="引用" active={editor.isActive('blockquote')} act={() => editor.chain().focus().toggleBlockquote().run()} />
        </div>
      )}

      <EditorContent editor={editor} className="tiptap-wrap" />

      {panel === 'versions' && <VersionsPanel docId={docId} onRestored={async () => {
        const d = await api.get<any>(`/api/docs/${docId}`);
        setDoc(d);
        try { editor.commands.setContent(JSON.parse(d.content_json || '{}')); } catch { /* noop */ }
        setPanel('none');
      }} />}
      {panel === 'perms' && <PermsPanel docId={docId} onClose={() => setPanel('none')} />}
    </div>
  );
}

function VersionsPanel({ docId, onRestored }: { docId: number; onRestored: () => void }) {
  const [versions, setVersions] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>(null);
  useEffect(() => { api.get<any[]>(`/api/docs/${docId}/versions`).then(setVersions); }, [docId]);
  return (
    <div className="side-panel">
      <div className="side-label">版本歷史</div>
      {versions.map(v => (
        <div key={v.id} className="ver-row">
          <b className="mono">v{v.version_no}</b>
          <span className="muted">{v.author}・{v.created_at.slice(5, 16)}</span>
          {v.note && <span className="chip">{v.note}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn subtle" onClick={async () => setPreview(await api.get(`/api/docs/${docId}/versions/${v.id}`))}>檢視</button>
            <button className="btn subtle" onClick={async () => {
              if (confirm(`還原到 v${v.version_no}？（會建立新版本，不會遺失歷史）`)) {
                await api.post(`/api/docs/${docId}/restore/${v.id}`);
                onRestored();
              }
            }}>還原</button>
          </span>
        </div>
      ))}
      {preview && (
        <div className="ver-preview">
          <div className="side-label">v{preview.version_no} 內容預覽 <button className="btn subtle" onClick={() => setPreview(null)}>關閉</button></div>
          <div className="tiptap readonly" dangerouslySetInnerHTML={{ __html: preview.content_html }} />
        </div>
      )}
    </div>
  );
}

function PermsPanel({ docId, onClose }: { docId: number; onClose: () => void }) {
  const [restricted, setRestricted] = useState(false);
  const [perms, setPerms] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    api.get<any>(`/api/docs/${docId}/perms`).then(p => { setRestricted(p.restricted); setPerms(p.perms); });
    api.get<User[]>('/api/users').then(setUsers);
  }, [docId]);
  const save = async (r: boolean, p: any[]) => {
    setRestricted(r); setPerms(p);
    await api.put(`/api/docs/${docId}/perms`, {
      restricted: r,
      perms: p.map(x => ({ subject_kind: x.subject_kind, subject_id: x.subject_id, level: x.level })),
    });
  };
  return (
    <div className="side-panel">
      <div className="side-label">權限設定 <button className="btn subtle" onClick={onClose}>關閉</button></div>
      <label className="perm-row">
        <input type="checkbox" checked={restricted} onChange={e => save(e.target.checked, perms)} />
        限制存取（關閉「全公司可讀」，只有下列名單與管理員能看到）
      </label>
      {perms.map((p, i) => (
        <div key={i} className="perm-row">
          <span>{p.subject_kind === 'everyone' ? '全公司' : p.user_name ?? users.find(u => u.id === p.subject_id)?.name ?? `#${p.subject_id}`}</span>
          <select value={p.level} onChange={e => { const np = [...perms]; np[i] = { ...p, level: e.target.value }; save(restricted, np); }} style={{ width: 100 }}>
            <option value="read">可讀</option>
            <option value="edit">可編輯</option>
            <option value="manage">可管理</option>
          </select>
          <button className="btn subtle" onClick={() => save(restricted, perms.filter((_, j) => j !== i))}>移除</button>
        </div>
      ))}
      <div className="perm-row">
        <select defaultValue="" onChange={e => {
          if (!e.target.value) return;
          const v = e.target.value;
          const row = v === 'everyone'
            ? { subject_kind: 'everyone', subject_id: null, level: 'read' }
            : { subject_kind: 'user', subject_id: Number(v), level: 'read', user_name: users.find(u => u.id === Number(v))?.name };
          save(restricted, [...perms, row]);
          e.target.value = '';
        }}>
          <option value="">＋ 加入成員或全公司…</option>
          <option value="everyone">全公司</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ═══════════ 掛在實體上的文件清單（PM/ERP 用）═══════════ */
export function EntityDocs({ entityType, entityId, me, onOpenDoc }: {
  entityType: string; entityId: number; me: User; onOpenDoc: (id: number) => void;
}) {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [all, setAll] = useState<DocMeta[]>([]);
  const reload = () => api.get<DocMeta[]>(`/api/entity-docs?type=${entityType}&id=${entityId}`).then(setDocs);
  useEffect(() => { reload(); api.get<Tree>('/api/docs/tree').then(t => setAll(t.docs)); }, [entityType, entityId]);

  const createDoc = async () => {
    const title = prompt('文件標題？');
    if (!title?.trim()) return;
    const r = await api.post<{ id: number }>('/api/docs', { title, entity_type: entityType, entity_id: entityId });
    await reload();
    onOpenDoc(r.id);
  };
  const templates = all.filter(d => d.is_template);

  return (
    <div className="entity-docs">
      {docs.map(d => (
        <div key={d.id} className="edoc-row">
          <button className="edoc-open" onClick={() => onOpenDoc(d.id)}>{d.title || '未命名文件'}</button>
          <span className="muted mono">{d.updated_at.slice(5, 10)}</span>
          <button className="btn subtle" title="取消連結" onClick={async () => {
            await fetch('/api/entity-docs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_id: d.id, entity_type: entityType, entity_id: entityId }) });
            reload();
          }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={createDoc}>＋ 新建文件</button>
        {templates.length > 0 && (
          <select defaultValue="" onChange={async e => {
            if (!e.target.value) return;
            const tpl = templates.find(t => t.id === Number(e.target.value))!;
            e.target.value = '';
            const title = prompt('文件標題？', tpl.title);
            if (title === null) return;
            const r = await api.post<{ id: number }>('/api/docs', {
              template_id: tpl.id, title, entity_type: entityType, entity_id: entityId,
            });
            await reload();
            onOpenDoc(r.id);
          }}>
            <option value="">＋ 從模版建立…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        <select defaultValue="" onChange={async e => {
          if (!e.target.value) return;
          await api.post('/api/entity-docs', { doc_id: Number(e.target.value), entity_type: entityType, entity_id: entityId });
          e.target.value = '';
          reload();
        }}>
          <option value="">連結既有文件…</option>
          {all.filter(d => !d.is_template && !docs.some(x => x.id === d.id)).map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </div>
    </div>
  );
}
