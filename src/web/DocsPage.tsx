import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';

/** 圖片加寬度屬性（以 % 儲存），供編輯器調整與匯出沿用 */
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.style.width || el.getAttribute('width') || null,
        renderHTML: (attrs: Record<string, any>) => (attrs.width ? { style: `width:${attrs.width}` } : {}),
      },
    };
  },
});
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { api, User } from './api';

type FolderT = { id: number; parent_id: number | null; name: string; restricted: number; my_level: string };
type DocMeta = {
  id: number; folder_id: number | null; title: string; restricted: number;
  is_template?: number; class_id?: number | null; doc_no?: string | null;
  updated_at: string; my_level: string;
};
type Tree = { folders: FolderT[]; docs: DocMeta[] };
export type ClsT = { id: number; parent_id: number | null; name: string; code: string };

export function classPathLabel(classes: ClsT[], id: number | null | undefined): string {
  if (!id) return '';
  const map = new Map(classes.map(x => [x.id, x]));
  const parts: string[] = [];
  let cur = map.get(id);
  while (cur) { parts.unshift(cur.code); cur = cur.parent_id != null ? map.get(cur.parent_id) : undefined; }
  return parts.join('-');
}

/* ═══════════ 文件中心主頁 ═══════════ */
export function DocsPage({ me, onHome }: { me: User; onHome: () => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [classes, setClasses] = useState<ClsT[]>([]);
  const [curDoc, setCurDoc] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DocMeta[] | null>(null);
  const [curFolder, setCurFolder] = useState<number | null>(null);
  const [view, setView] = useState<'docs' | 'index'>('docs');
  const [expanded, setExpanded] = useState<Set<number> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  const exportTree = async () => {
    const res = await fetch('/api/tpl-classes/export');
    const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'tpl-index.txt'; a.click();
    URL.revokeObjectURL(url);
  };
  const doImport = async () => {
    try {
      const r = await api.post<{ created: number; skipped: number; bad_lines: number[] }>('/api/tpl-classes/import', { text: importText });
      alert(`匯入完成：新增 ${r.created} 個節點、略過 ${r.skipped} 個已存在${r.bad_lines.length ? `；第 ${r.bad_lines.join(', ')} 行格式錯誤已跳過` : ''}`);
      setShowImport(false); setImportText('');
      setExpanded(null); // 重新載入後重算預設展開
      await reload();
    } catch (ex: any) { alert(ex.message); }
  };

  // 預設只展開第一層
  useEffect(() => {
    if (expanded === null && classes.length) {
      setExpanded(new Set(classes.filter(x => x.parent_id == null).map(x => x.id)));
    }
  }, [classes]);
  const isOpen = (id: number) => expanded?.has(id) ?? false;
  const toggleOpen = (id: number) => {
    const next = new Set(expanded ?? []);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const reload = () => {
    api.get<Tree>('/api/docs/tree').then(setTree);
    api.get<ClsT[]>('/api/tpl-classes').then(setClasses).catch(() => {});
  };
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
  const newTemplate = async (classId: number | null = null) => {
    const title = prompt('模版名稱？（例如：實驗記錄表、請購單）');
    if (!title?.trim()) return;
    const r = await api.post<{ id: number }>('/api/docs', { title, is_template: 1, class_id: classId });
    await reload();
    setCurDoc(r.id);
  };
  const newClass = async (parentId: number | null) => {
    const name = prompt('節點名稱？（例如：研發部、實驗記錄）');
    if (!name?.trim()) return;
    const code = prompt('節點代號？（英數字，例如 RD、EXP，會成為文件編號的一段）');
    if (!code?.trim()) return;
    try { await api.post('/api/tpl-classes', { name, code, parent_id: parentId }); await reload(); }
    catch (ex: any) { alert(ex.message); }
  };
  const editClass = async (cls: ClsT) => {
    const name = prompt('節點名稱：', cls.name);
    if (name === null) return;
    const code = prompt('節點代號：', cls.code);
    if (code === null) return;
    await api.patch(`/api/tpl-classes/${cls.id}`, { name, code });
    await reload();
  };
  const delClass = async (cls: ClsT) => {
    if (!confirm(`刪除節點「${cls.name}」？（底下有子節點或模版時無法刪除）`)) return;
    try { await api.del(`/api/tpl-classes/${cls.id}`); await reload(); }
    catch (ex: any) { alert(ex.message); }
  };

  const renderClasses = (parent: number | null, depth: number): JSX.Element[] => {
    const out: JSX.Element[] = [];
    for (const cls of classes.filter(x => x.parent_id === parent)) {
      const tpls = (tree?.docs ?? []).filter(x => x.is_template && x.class_id === cls.id);
      const hasKids = classes.some(x => x.parent_id === cls.id) || tpls.length > 0;
      const open = isOpen(cls.id);
      out.push(
        <div key={`cls${cls.id}`} className="cls-row" style={{ paddingLeft: 4 + depth * 16 }}>
          <button className="chev" onClick={() => toggleOpen(cls.id)}
            aria-label={open ? '收摺' : '展開'} style={{ visibility: hasKids ? 'visible' : 'hidden' }}>
            {open ? '▾' : '▸'}
          </button>
          <span className="cls-code mono">{cls.code}</span>
          <span className="cls-name">{cls.name}</span>
          {!open && hasKids && <span className="muted" style={{ fontSize: 11, flex: 'none' }}>{tpls.length ? `${tpls.length} 模版` : ''}</span>}
          <span className="cls-acts">
            <button title="新增子節點" onClick={() => newClass(cls.id)}>＋節點</button>
            <button title="在此節點建立模版" onClick={() => newTemplate(cls.id)}>＋模版</button>
            <button title="編輯" onClick={() => editClass(cls)}>✎</button>
            <button title="刪除" onClick={() => delClass(cls)}>✕</button>
          </span>
        </div>
      );
      if (open) {
        for (const d of tpls) {
          out.push(
            <button key={`tpl${d.id}`} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`}
              style={{ paddingLeft: 40 + depth * 16 }} onClick={() => setCurDoc(d.id)}>
              <span className="tpl-badge">模</span>{d.title || '未命名模版'}
            </button>
          );
        }
        out.push(...renderClasses(cls.id, depth + 1));
      }
    }
    return out;
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
        <nav className="tabs" aria-label="檢視切換">
          <button className={view === 'docs' ? 'on' : ''} onClick={() => setView('docs')}>文件</button>
          <button className={view === 'index' ? 'on' : ''} onClick={() => setView('index')}>模版引索</button>
        </nav>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view === 'docs' ? (
            <>
              <button className="btn" onClick={newFolder}>＋ 資料夾</button>
              <button className="btn primary" onClick={newDoc}>＋ 新文件</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={exportTree}>匯出</button>
              <button className="btn" onClick={() => setShowImport(true)}>匯入</button>
              <button className="btn" onClick={() => newClass(null)}>＋ 根節點</button>
              <button className="btn" onClick={() => newTemplate(null)}>＋ 未分類模版</button>
            </>
          )}
        </div>
      </header>
      <div className="docs-layout">
        <aside className="docs-side">
          {view === 'docs' ? (
            <>
              <input className="doc-search" placeholder="搜尋文件（標題／內文／編號）…" value={q} onChange={e => setQ(e.target.value)} />
              {hits !== null ? (
                <>
                  <div className="side-label">搜尋結果（{hits.length}）</div>
                  {hits.map(d => (
                    <button key={d.id} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`} onClick={() => setCurDoc(d.id)}>
                      {d.doc_no && <span className="docno mono">{d.doc_no}</span>}{d.title || '未命名文件'}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {curFolder != null && <div className="side-label">新文件會建立在：{tree.folders.find(f => f.id === curFolder)?.name}</div>}
                  {renderFolder(null, 0)}
                  {rootDocs.length > 0 && <div className="side-label">未分類</div>}
                  {rootDocs.map(d => (
                    <button key={d.id} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`} onClick={() => setCurDoc(d.id)}>
                      {d.title || '未命名文件'}{!!d.restricted && <span className="lockmark">🔒</span>}
                    </button>
                  ))}
                  {tree.docs.filter(d => !d.is_template).length === 0 && <p className="muted" style={{ padding: '8px 12px' }}>還沒有文件，按「＋ 新文件」開始。</p>}
                </>
              )}
            </>
          ) : (
            <>
              <div className="side-label">模版引索樹（點 ▸ 展開）</div>
              {renderClasses(null, 0)}
              {classes.length === 0 && <p className="muted" style={{ padding: '8px 12px' }}>還沒有引索節點——按「＋ 根節點」建第一層（例如部門），再往下建類型。</p>}
              {templates.filter(d => !d.class_id).length > 0 && <div className="side-label">未分類模版</div>}
              {templates.filter(d => !d.class_id).map(d => (
                <button key={`t${d.id}`} className={`side-item doc ${curDoc === d.id ? 'on' : ''}`} onClick={() => setCurDoc(d.id)}>
                  <span className="tpl-badge">模</span>{d.title || '未命名模版'}
                </button>
              ))}
            </>
          )}
        </aside>
        <main className="docs-main">
          {curDoc == null
            ? <div className="doc-empty muted">選一份文件，或建立新文件</div>
            : <DocEditor key={curDoc} docId={curDoc} me={me} folders={tree.folders} classes={classes} onMetaChanged={reload}
                onDeleted={() => { setCurDoc(null); reload(); }} onOpenDoc={id => { setCurDoc(id); reload(); }} />}
        </main>
        {showImport && (
          <>
            <div className="scrim show" onClick={() => setShowImport(false)} />
            <div className="modal-card" role="dialog" aria-label="匯入引索樹">
              <h3 style={{ margin: '0 0 6px' }}>匯入引索樹</h3>
              <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
                每行一個節點的完整路徑，各層用 Tab 分隔，節點寫成 名稱(代號)。已存在的節點（同層同代號）會略過，可以放心重複匯入。範例：<br />
                <code style={{ fontSize: 11.5 }}>研發部(RD)　→Tab→　實驗記錄(EXP)</code>
              </p>
              <textarea className="panel-desc" rows={10} value={importText} placeholder={'研發部(RD)\n研發部(RD)\t實驗記錄(EXP)\n行政部(ADM)\t請購單(PR)'}
                onChange={e => setImportText(e.target.value)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="btn" style={{ cursor: 'pointer' }}>
                  選擇檔案…
                  <input type="file" accept=".txt,.tsv,.csv,text/plain" style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () => setImportText(String(reader.result ?? ''));
                      reader.readAsText(f);
                    }} />
                </label>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setShowImport(false)}>取消</button>
                  <button className="btn primary" disabled={!importText.trim()} onClick={doImport}>匯入</button>
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════ 編輯器（可獨立嵌入 PM）═══════════ */
export function DocEditor({ docId, me, folders, classes, onMetaChanged, onDeleted, onOpenDoc }: {
  docId: number; me: User; folders: FolderT[]; classes?: ClsT[]; onMetaChanged: () => void; onDeleted: () => void;
  onOpenDoc?: (id: number) => void;
}) {
  const [doc, setDoc] = useState<any>(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [panel, setPanel] = useState<'none' | 'versions' | 'perms'>('none');
  const [, forceSel] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const titleTimer = useRef<ReturnType<typeof setTimeout>>();
  const canEdit = doc && (doc.my_level === 'edit' || doc.my_level === 'manage');

  /** 上傳圖片檔並插入目前游標位置（貼上/拖放共用） */
  const uploadImageFile = async (view: any, file: File) => {
    if (file.size > 20 * 1024 * 1024) { alert('圖片上限 20MB'); return; }
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/files', { method: 'POST', body: fd });
    const data = await res.json() as { url?: string; error?: string };
    if (res.ok && data.url) {
      const node = view.state.schema.nodes.image.create({ src: data.url });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    } else alert(data.error || '圖片上傳失敗');
  };

  const editor = useEditor({
    editorProps: {
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) { event.preventDefault(); uploadImageFile(view, file); return true; }
          }
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        files.forEach(f => uploadImageFile(view, f));
        return true;
      },
    },
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false }),
      Placeholder.configure({ placeholder: '開始輸入內容…（支援 Markdown 快捷鍵，例如 # 標題、- 清單）' }),
      Table.configure({ resizable: false }), TableRow, TableCell, TableHeader,
      TaskList, TaskItem.configure({ nested: true }),
    ],
    editable: false,
    onSelectionUpdate: () => forceSel(x => x + 1),
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

  /* ── 匯出 ── */
  const escHtml = (s: string) => s.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]!));
  /** 把站內圖片抓下來內嵌成 base64，匯出檔才能離線顯示 */
  const inlineImages = async (html: string): Promise<string> => {
    const div = document.createElement('div');
    div.innerHTML = html;
    await Promise.all(Array.from(div.querySelectorAll('img')).map(async img => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>(resolve => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.readAsDataURL(blob);
        });
        img.setAttribute('src', dataUrl);
      } catch { /* 圖抓不到就保留原樣 */ }
    }));
    return div.innerHTML;
  };
  const buildExportHtml = async () => {
    const content = await inlineImages(editor.getHTML());
    const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
    return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escHtml(doc.title)}</title><style>
      @page{size:A4;margin:22mm 18mm}
      body{font-family:'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif;color:#1a1a1a;font-size:12.5pt;line-height:1.75;max-width:720px;margin:0 auto;padding:24px}
      .exp-hdr{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:6px;margin-bottom:4px;font-size:10pt;color:#555}
      .exp-hdr .no{font-family:Consolas,Menlo,monospace;font-weight:600;letter-spacing:.03em}
      h1.exp-title{font-size:17pt;margin:14px 0 4px}
      .exp-meta{font-size:9.5pt;color:#777;margin-bottom:18px}
      h1{font-size:15pt;margin:16px 0 6px}h2{font-size:13.5pt;margin:14px 0 5px}h3{font-size:12.5pt;margin:12px 0 4px}
      p{margin:5px 0}ul,ol{padding-left:22px}
      table{border-collapse:collapse;width:100%;margin:8px 0}
      th,td{border:1px solid #999;padding:5px 9px;text-align:left;font-size:11.5pt}
      th{background:#f0f0f0;font-weight:700}
      blockquote{border-left:3px solid #888;margin:8px 0;padding:2px 12px;color:#555}
      pre{background:#f4f4f4;border-radius:4px;padding:10px 12px;font-family:Consolas,Menlo,monospace;font-size:10pt;white-space:pre-wrap}
      code{background:#f4f4f4;border-radius:3px;padding:1px 4px;font-family:Consolas,Menlo,monospace;font-size:10.5pt}
      img{max-width:100%}
      ul[data-type="taskList"]{list-style:none;padding-left:4px}
      ul[data-type="taskList"] li{display:flex;gap:8px;align-items:flex-start}
      @media print{body{padding:0}}
    </style></head><body>
      <div class="exp-hdr"><span class="no">${escHtml(doc.doc_no ?? '')}</span><span>${doc.is_template ? '表單模版' : '文件'}</span></div>
      <h1 class="exp-title">${escHtml(doc.title)}</h1>
      <div class="exp-meta">版本 v${doc.version_no}　匯出日期 ${today}</div>
      ${content}
    </body></html>`;
  };
  const exportPdf = async () => {
    const w = window.open('', '_blank');
    if (!w) { alert('瀏覽器阻擋了彈出視窗，請允許後重試'); return; }
    w.document.write(await buildExportHtml());
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };
  const exportWord = async () => {
    const html = (await buildExportHtml()).replace('<html lang="zh-Hant">',
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="zh-Hant">');
    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.doc_no ? doc.doc_no + '_' : ''}${doc.title || '文件'}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
        {doc.doc_no && <span className="docno mono" title="文件編號（自動生成，不可變）">{doc.doc_no}</span>}
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
          {!!doc.is_template && classes && classes.length > 0 && (
            <select value={doc.class_id ?? ''} disabled={!canEdit} aria-label="引索節點" title="模版所屬引索節點（決定生成文件的編號前綴）"
              onChange={async e => {
                await api.patch(`/api/docs/${docId}`, { class_id: e.target.value ? Number(e.target.value) : null });
                setDoc({ ...doc, class_id: e.target.value ? Number(e.target.value) : null });
                onMetaChanged();
              }}>
              <option value="">未掛引索節點</option>
              {classes.map(cl => <option key={cl.id} value={cl.id}>{classPathLabel(classes, cl.id)}｜{cl.name}</option>)}
            </select>
          )}
          {!doc.is_template && (
          <select value={doc.folder_id ?? ''} disabled={!canEdit} aria-label="所在資料夾"
            onChange={async e => { await api.patch(`/api/docs/${docId}`, { folder_id: e.target.value ? Number(e.target.value) : null }); onMetaChanged(); }}>
            <option value="">未分類</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          )}
          {(me.role === 'admin' || me.role === 'pm' || doc.created_by === me.id) && (
            <>
              <button className="btn" title="開啟列印視圖，選「另存為 PDF」" onClick={exportPdf}>PDF</button>
              <button className="btn" title="下載 Word 檔（.doc）" onClick={exportWord}>Word</button>
            </>
          )}
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
          {editor.isActive('image') && (
            <>
              <span className="tsep" />
              <span className="tb-label">圖片寬度</span>
              {(['25%', '50%', '75%', null] as const).map(w => (
                <B key={w ?? 'full'} label={w ?? '100%'} title={w ? `縮至 ${w}` : '原始寬度'}
                  active={editor.getAttributes('image').width === w}
                  act={() => editor.chain().focus().updateAttributes('image', { width: w }).run()} />
              ))}
            </>
          )}
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
          <button className="edoc-open" onClick={() => onOpenDoc(d.id)}>
            {d.doc_no && <span className="docno mono" style={{ marginRight: 6 }}>{d.doc_no}</span>}
            {d.title || '未命名文件'}
          </button>
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
