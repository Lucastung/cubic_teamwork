import { useEffect, useState } from 'react';
import { api, Node, Dep, User } from './api';
import { Model } from './model';
import { NodePanel } from './ProjectView';
import { DocEditor } from './DocsPage';

/** 任務獨立頁（/task/:id）：完整編輯 */
export function TaskPage({ id, me }: { id: number; me: User }) {
  const [info, setInfo] = useState<{ node: Node; project: any } | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const reload = async () => {
    try {
      const inf = await api.get<{ node: Node; project: any }>(`/api/nodes/${id}`);
      setInfo(inf);
      const [tree, users] = await Promise.all([
        api.get<{ nodes: Node[]; deps: Dep[] }>(`/api/projects/${inf.node.project_id}/tree`),
        api.get<User[]>('/api/users'),
      ]);
      setModel(new Model(tree.nodes, tree.deps, users));
    } catch (ex: any) { setErr(ex.message); }
  };
  useEffect(() => { reload(); api.get<any>('/api/docs/tree').then(t => setFolders(t.folders)).catch(() => {}); }, [id]);

  if (err) return <div className="app taskpage"><p className="err">{err}</p><a className="btn" href="/">回首頁</a></div>;
  if (!info || !model) return <div className="app taskpage"><p className="muted">載入中…</p></div>;
  const n = model.byId(info.node.id);
  if (!n) return <div className="app taskpage"><p className="muted">這個節點已被刪除。</p><a className="btn" href="/">回首頁</a></div>;

  const patch = async (nid: number, body: object) => { await api.patch(`/api/nodes/${nid}`, body); await reload(); };

  return (
    <div className="app taskpage">
      <header className="home-head">
        <div>
          <div className="eyebrow">{info.project.kind === 'template' ? '專案模版' : '專案'}／{info.project.name}</div>
          <h1 style={{ fontSize: 19 }}>任務完整編輯</h1>
        </div>
        <a className="btn" href="/">← 回系統首頁</a>
      </header>
      {openDoc != null ? (
        <>
          <button className="btn" style={{ marginBottom: 10 }} onClick={() => setOpenDoc(null)}>← 返回任務</button>
          <DocEditor key={openDoc} docId={openDoc} me={me} folders={folders}
            onMetaChanged={() => {}} onDeleted={() => setOpenDoc(null)} />
        </>
      ) : (
        <NodePanel model={model} n={n} me={me} isTemplate={info.project.kind === 'template'}
          patch={patch} onChanged={reload} onOpenDoc={setOpenDoc}
          onDeleted={() => { location.href = '/'; }} />
      )}
    </div>
  );
}
