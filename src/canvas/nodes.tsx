import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Handle, NodeResizer, NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { MOD, MODELS, NODE_META, PARAMS, ratioOf } from './config';
import { Icon } from './Icon';
import { downloadMedia, downloadText, mediaKindOf, putMedia, useMediaUrl, useMediaUrls } from './media';
import { allRoles, coverStyle, findMaterial, findRole, roleHue, useLibrary, type Role } from './library';
import { composeRequest, currentOutput, useCanvas } from './store';
import { useImeField } from './useImeField';
import { VideoToolButtons } from './videoTools';
import { useUI } from './ui';
import { isGenKind, type CanvasNode, type CanvasNodeData, type GenKind, type MediaRef, type NodeKind } from './types';

type P = NodeProps<CanvasNode>;

// Toolbars render through a portal, but React still bubbles their events up the
// component tree to the node and pane, where a click would reset the selection.
const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
const isolate = { onClick: stop, onDoubleClick: stop, onMouseDown: stop, onPointerDown: stop, onContextMenu: stop, onKeyDown: stop };

const useSingleSelected = () => useCanvas((s) => s.nodes.filter((n) => n.selected).length === 1);

function useUpstream(id: string) {
  return useCanvas(
    useShallow((s) => {
      const sources = s.edges.filter((e) => e.target === id).map((e) => e.source);
      return s.nodes.filter((n) => sources.includes(n.id));
    }),
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function NodeTitle({ id, title, icon }: { id: string; title: string; icon: string }) {
  const [editing, setEditing] = useState(false);
  const updateData = useCanvas((s) => s.updateData);
  return (
    <div className="cn-title" onDoubleClick={() => setEditing(true)}>
      <Icon name={icon} size={13} />
      {editing ? (
        <input
          className="nodrag"
          autoFocus
          defaultValue={title}
          onBlur={(e) => {
            updateData(id, { title: e.target.value.trim() || title });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span>{title}</span>
      )}
    </div>
  );
}

export function MediaThumb({ media, className }: { media: MediaRef; className?: string }) {
  const url = useMediaUrl(media.id);
  if (!url) return <div className={`thumb ${className ?? ''}`} />;
  if (media.kind === 'image') return <img className={`thumb ${className ?? ''}`} src={url} draggable={false} alt="" />;
  if (media.kind === 'video') return <video className={`thumb ${className ?? ''}`} src={url} muted preload="metadata" />;
  return (
    <div className={`thumb thumb-audio ${className ?? ''}`}>
      <Icon name="audio" />
    </div>
  );
}

function Progress({ data }: { data: CanvasNodeData }) {
  if (data.busy)
    return (
      <div className="cn-progress">
        <span className="cn-progress-text">
          <span className="spinner light" />
          {data.busy}
        </span>
      </div>
    );
  if (data.status === 'running')
    return (
      <div className="cn-progress">
        <div className="cn-progress-bar" style={{ width: `${Math.round((data.progress ?? 0) * 100)}%` }} />
        <span className="cn-progress-text">
          生成中 {Math.round((data.progress ?? 0) * 100)}%{data.statusText ? <small>{data.statusText}</small> : null}
        </span>
      </div>
    );
  if (data.status === 'error') return <div className="cn-error">生成失败：{data.error}</div>;
  return null;
}

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="cn-handle" />
      <Handle type="source" position={Position.Right} className="cn-handle">
        <Icon name="plus" size={12} />
      </Handle>
    </>
  );
}

function NodeShell({ id, data, selected, kind, cardWidth, children, extraActions }: P & { kind: NodeKind; cardWidth?: number; children: ReactNode; extraActions?: ReactNode }) {
  const meta = NODE_META[kind];
  return (
    <div className={`cn cn-k-${kind} ${selected ? 'is-selected' : ''} ${data.status === 'running' ? 'is-running' : ''}`} style={{ width: cardWidth ?? meta.width }}>
      <NodeTitle id={id} title={data.title} icon={meta.icon} />
      <div className="cn-card">
        {children}
        <Progress data={data} />
      </div>
      <Handles />
      <NodeActions id={id} data={data} kind={kind} selected={!!selected} extra={extraActions} />
      {isGenKind(kind) && <PromptPanel id={id} kind={kind} data={data} selected={!!selected} />}
    </div>
  );
}

function NodeActions({ id, data, kind, selected, extra }: { id: string; data: CanvasNodeData; kind: NodeKind; selected: boolean; extra?: ReactNode }) {
  const single = useSingleSelected();
  const { updateData, deleteNodes, duplicate } = useCanvas(useShallow((s) => ({ updateData: s.updateData, deleteNodes: s.deleteNodes, duplicate: s.duplicate })));
  const setUI = useUI((s) => s.set);
  const { getNode, flowToScreenPosition } = useReactFlow();
  const outs = data.outputs ?? [];
  const cur = data.current ?? outs.length - 1;
  const out = currentOutput(data);

  const referThis = () => {
    const n = getNode(id);
    if (!n) return;
    const w = n.measured?.width ?? 300;
    const flow = { x: n.position.x + w + 120, y: n.position.y };
    const screen = flowToScreenPosition(flow);
    setUI({ menu: { x: screen.x, y: screen.y, flow, from: id } });
  };

  return (
    <NodeToolbar isVisible={selected && single} position={Position.Top} offset={34} className="cn-actions" {...isolate}>
      {outs.length > 1 && (
        <div className="cn-versions">
          <button disabled={cur <= 0} onClick={() => updateData(id, { current: cur - 1 })} title="上一个版本">
            <Icon name="left" size={14} />
          </button>
          <span>
            {cur + 1}/{outs.length}
          </span>
          <button disabled={cur >= outs.length - 1} onClick={() => updateData(id, { current: cur + 1 })} title="下一个版本">
            <Icon name="right" size={14} />
          </button>
        </div>
      )}
      {extra}
      {out?.sent && (
        <button onClick={() => setUI({ sentView: { title: data.title, sent: out.sent! } })} title="查看这次生成实际发送的内容">
          <Icon name="file" size={14} />
        </button>
      )}
      {out?.media && (
        <>
          <button onClick={() => setUI({ preview: out.media! })} title="全屏预览">
            <Icon name="expand" size={14} />
          </button>
          <button onClick={() => downloadMedia(out.media!, data.title)} title="下载">
            <Icon name="download" size={14} />
          </button>
        </>
      )}
      {kind === 'text' && data.text && (
        <button onClick={() => downloadText(data.text!, `${data.title}.txt`)} title="下载文本">
          <Icon name="download" size={14} />
        </button>
      )}
      {kind !== 'group' && (
        <button onClick={referThis} title="引用该节点生成">
          <Icon name="sparkles" size={14} />
          <span>引用生成</span>
        </button>
      )}
      <button onClick={() => duplicate([id])} title={`创建副本 ${MOD} D`}>
        <Icon name="copy" size={14} />
      </button>
      <button onClick={() => deleteNodes([id])} title="删除">
        <Icon name="trash" size={14} />
      </button>
    </NodeToolbar>
  );
}

function InputChip({ node }: { node: CanvasNode }) {
  const out = currentOutput(node.data);
  const meta = NODE_META[node.type ?? 'text'];
  return (
    <div className={`chip ${node.type === 'reference' ? 'chip-muted' : ''}`} title={node.type === 'reference' ? '参考节点不参与生成' : node.data.title}>
      {out?.media ? <MediaThumb media={out.media} className="chip-thumb" /> : <Icon name={meta.icon} size={12} />}
      <span>{node.data.title}</span>
    </div>
  );
}

function MentionChip({ role }: { role: Role }) {
  return (
    <div className="chip chip-role" title={`角色：${role.name}`}>
      <RoleAvatar role={role} size={20} />
      <span>@{role.name}</span>
    </div>
  );
}

/** `@query` right before the caret, if the user is typing a mention. */
const mentionQuery = (text: string, caret: number) => /@([^\s@]{0,20})$/.exec(text.slice(0, caret))?.[1];

function PromptPanel({ id, kind, data, selected }: { id: string; kind: GenKind; data: CanvasNodeData; selected: boolean }) {
  const single = useSingleSelected();
  const upstream = useUpstream(id);
  const myRoles = useLibrary((s) => s.roles);
  const { updateData, commit, run } = useCanvas(useShallow((s) => ({ updateData: s.updateData, commit: s.commit, run: s.run })));
  const [mention, setMention] = useState<{ q: string; active: number } | null>(null);
  const [showSent, setShowSent] = useState(false);
  const allNodes = useCanvas((s) => s.nodes);
  const allEdges = useCanvas((s) => s.edges);
  const prefs = useLibrary((s) => s.preferences);
  const preview = useMemo(() => (showSent ? composeRequest(id, allNodes, allEdges) : null), [showSent, id, allNodes, allEdges, prefs]);
  const area = useRef<HTMLTextAreaElement>(null);
  const params = data.params ?? {};
  const running = data.status === 'running';
  const prompt = data.prompt ?? '';
  const placeholder: Record<GenKind, string> = {
    text: '描述你想生成的文案，连接的文本会作为上下文，输入 @ 可引用角色…',
    image: '描述你想生成的画面，连接的图片会作为参考图，输入 @ 可引用角色…',
    script: '输入故事创意，生成分镜脚本，输入 @ 可引用角色…',
    audio: '描述想要的音乐：风格、情绪、乐器、节奏，例如「温暖的钢琴与弦乐，缓慢抒情」…',
  };
  const roles = useMemo(() => [...myRoles, ...allRoles().filter((r) => r.official)], [myRoles]);
  const mentioned = roles.filter((r) => prompt.includes(`@${r.name}`));
  // Connected nodes first, then anything else on the canvas, then characters. Character
  // nodes are listed through their role; groups and this node itself can't be referenced.
  const mentionable = (n: CanvasNode) => n.id !== id && n.type !== 'group' && n.type !== 'character' && !!n.data.title;
  const upstreamIds = new Set(upstream.map((n) => n.id));
  const candidates = mention
    ? [
        ...upstream.filter(mentionable).map((n) => ({ key: n.id, label: n.data.title, sub: `已连接 · ${NODE_META[n.type ?? 'text'].label}`, role: undefined as Role | undefined })),
        ...allNodes.filter((n) => mentionable(n) && !upstreamIds.has(n.id)).map((n) => ({ key: n.id, label: n.data.title, sub: NODE_META[n.type ?? 'text'].label, role: undefined as Role | undefined })),
        ...roles.map((r) => ({ key: r.id, label: r.name, sub: r.official ? '官方角色' : '我的角色', role: r as Role | undefined })),
      ].filter((c) => c.label.toLowerCase().includes(mention.q.toLowerCase()))
    : [];
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    popRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [mention?.active]);

  const promptField = useImeField(
    prompt,
    (v) => updateData(id, { prompt: v }),
    (v, el) => {
      const q = mentionQuery(v, el.selectionStart ?? v.length);
      setMention(q === undefined ? null : { q, active: 0 });
    },
  );

  const insertMention = (label: string) => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = prompt.slice(0, caret).replace(/@[^\s@]*$/, `@${label} `);
    const next = before + prompt.slice(caret);
    updateData(id, { prompt: next });
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  return (
    <NodeToolbar isVisible={selected && single} position={Position.Bottom} offset={16} className="pp nowheel" {...isolate}>
      {(upstream.length > 0 || mentioned.length > 0) && (
        <div className="pp-inputs">
          {upstream.map((n) => (
            <InputChip key={n.id} node={n} />
          ))}
          {mentioned.map((r) => (
            <MentionChip key={r.id} role={r} />
          ))}
        </div>
      )}
      {preview && (
        <div className="sent-preview nowheel">
          <div className="sent-parts">
            {preview.parts.length === 0 ? <span className="muted small">只有你输入的提示词</span> : null}
            {preview.parts.map((p, i) => (
              <span key={i} className="sent-chip">
                <b>{p.label}</b>
                {p.detail}
              </span>
            ))}
          </div>
          {preview.notes.map((n, i) => (
            <div key={i} className="sent-note">
              未使用：{n}
            </div>
          ))}
          <pre>{preview.prompt || '（还没有可发送的内容：请输入提示词，或连接文本、图片等）'}</pre>
          <small className="muted">
            {MODELS[kind].find((m) => m.id === preview.model)?.label} 会收到以上全文
            {preview.images.length + preview.videos.length ? `，并附上 ${preview.images.length + preview.videos.length} 张参考图` : ''}；另附「{kind === 'image' ? '画幅比例与保存图片' : '直接输出正文'}」的格式要求。
          </small>
        </div>
      )}
      <div className="pp-area">
        <textarea
          ref={area}
          className="nodrag"
          {...promptField}
          placeholder={placeholder[kind]}
          rows={3}
          onFocus={commit}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onKeyDown={(e) => {
            // Keys that pick an input-method candidate belong to the IME, not the @ list.
            if (e.nativeEvent.isComposing || !mention || !candidates.length) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setMention({ ...mention, active: (mention.active + d + candidates.length) % candidates.length });
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insertMention(candidates[mention.active].label);
            } else if (e.key === 'Escape') setMention(null);
          }}
        />
        {mention && candidates.length > 0 && (
          <div className="mention-pop nowheel" ref={popRef} onWheel={(e) => e.stopPropagation()}>
            {candidates.map((c, i) => (
              <button
                key={c.key}
                className={i === mention.active ? 'on' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(c.label);
                }}
              >
                {c.role ? <RoleAvatar role={c.role} size={20} /> : <Icon name="link" size={14} />}
                <span>{c.label}</span>
                <small>{c.sub}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pp-row">
        <select
          className="pp-select pp-model"
          value={MODELS[kind].some((m) => m.id === data.model) ? data.model : MODELS[kind][0].id}
          onChange={(e) => updateData(id, { model: e.target.value })}
          title={kind === 'image' ? '图片由 ChatGPT 生成（Claude 不能生成图片）' : '选择本地 AI 应用'}
        >
          {MODELS[kind].map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {PARAMS[kind].map((p) => (
          <select
            key={p.key}
            className="pp-select"
            title={p.label}
            value={String(params[p.key])}
            onChange={(e) => {
              const v = p.options.find((o) => String(o) === e.target.value)!;
              updateData(id, { params: { ...params, [p.key]: v } });
            }}
          >
            {p.options.map((o) => (
              <option key={String(o)} value={String(o)}>
                {p.format ? p.format(o) : String(o)}
              </option>
            ))}
          </select>
        ))}
        <div className="grow" />
        <button className={`text-btn sent-toggle ${showSent ? 'on' : ''}`} onClick={() => setShowSent(!showSent)} title="查看本次会发送给 AI 的全部内容">
          <Icon name="file" size={14} />
          发送内容
        </button>
        <button className="pp-go" disabled={running} onClick={() => run([id])} title={`生成 ${MOD} ↵`}>
          {running ? <span className="spinner" /> : <Icon name="arrowUp" size={16} />}
        </button>
      </div>
    </NodeToolbar>
  );
}

function EmptyState({ icon, title, hint, aspect }: { icon: string; title: string; hint: string; aspect?: number }) {
  return (
    <div className="cn-empty" style={aspect ? { aspectRatio: String(aspect) } : undefined}>
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export const TextNode = memo(function TextNode(props: P) {
  const { id, data, selected } = props;
  const { updateData, commit } = useCanvas(useShallow((s) => ({ updateData: s.updateData, commit: s.commit })));
  const textField = useImeField(data.text ?? '', (v) => updateData(id, { text: v }));
  return (
    <NodeShell {...props} kind="text">
      {selected ? (
        <textarea className="cn-text nodrag nowheel" {...textField} placeholder="输入文本，或在下方输入提示词生成…" onFocus={commit} />
      ) : data.text ? (
        <div className="cn-text cn-text-view">{data.text}</div>
      ) : (
        <EmptyState icon="text" title="文本" hint="选中后输入或生成文本" />
      )}
    </NodeShell>
  );
});

/** Shows media at its true aspect ratio; when the size isn't known yet it is measured on load. */
function MediaView({ media, kind, caption, onMeasure }: { media: MediaRef; kind: NodeKind; caption?: string; onMeasure: (w: number, h: number) => void }) {
  const url = useMediaUrl(media.id);
  const known = !!(media.w && media.h);
  const aspect = known ? media.w! / media.h! : kind === 'video' ? 16 / 9 : 1;
  const style = known ? { aspectRatio: String(aspect) } : undefined;
  if (!url) return <div className="cn-media" style={{ aspectRatio: String(aspect) }} />;
  if (media.kind === 'image')
    return (
      <img
        className="cn-media"
        src={url}
        style={style}
        draggable={false}
        alt=""
        onLoad={(e) => !known && e.currentTarget.naturalWidth && onMeasure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      />
    );
  if (media.kind === 'video')
    return (
      <video
        className="cn-media"
        src={url}
        style={style}
        preload="metadata"
        onLoadedMetadata={(e) => !known && e.currentTarget.videoWidth && onMeasure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
        muted
        loop
        playsInline
        onMouseEnter={(e) => e.currentTarget.play()}
        onMouseLeave={(e) => e.currentTarget.pause()}
      />
    );
  return (
    <div className="cn-audio">
      <div className="cn-wave">
        {Array.from({ length: 40 }, (_, i) => (
          <i key={i} style={{ height: `${20 + Math.abs(Math.sin(i * 1.7 + media.id.charCodeAt(0))) * 80}%` }} />
        ))}
      </div>
      <audio className="nodrag" src={url} controls />
      {caption && <p className="cn-caption">{caption}</p>}
    </div>
  );
}

export const MediaNode = memo(function MediaNode(props: P) {
  const kind = props.type as 'image' | 'video' | 'audio';
  const out = currentOutput(props.data);
  const meta = NODE_META[kind];
  const aspect = kind === 'audio' ? undefined : ratioOf(props.data.params?.ratio, kind === 'video' ? '16:9' : '1:1');
  const media = out?.media;
  const width = media?.w && media?.h && media.h > media.w ? Math.round(meta.width * 0.8) : meta.width;
  return (
    <NodeShell {...props} kind={kind} cardWidth={width} extraActions={kind === 'video' && media && !props.data.busy ? <VideoToolButtons id={props.id} /> : null}>
      {media ? (
        <MediaView
          media={media}
          kind={kind}
          caption={kind === 'audio' ? out?.text : undefined}
          onMeasure={(w, h) => {
            // Remember the size so the frame keeps the right shape next time (not an undo step).
            const outputs = (props.data.outputs ?? []).map((o) => (o.media?.id === media.id ? { ...o, media: { ...o.media, w, h } } : o));
            useCanvas.getState().updateData(props.id, { outputs });
          }}
        />
      ) : (
        <div className="cn-empty" style={aspect ? { aspectRatio: String(aspect) } : undefined}>
          <Icon name={meta.icon} size={28} />
          <strong>{kind === 'image' ? '图片' : meta.label}</strong>
          <span>
            {kind === 'image'
              ? '选中后在下方输入提示词由 ChatGPT 生成，或'
              : kind === 'audio'
                ? '选中后在下方描述想要的音乐，由 AI 作曲并合成，或'
                : '上传本地文件，自动留档到「影片/WCcanvastv」'}
          </span>
          <UploadInto id={props.id} kind={kind} />
        </div>
      )}
    </NodeShell>
  );
});

/** Fills an empty media node with a local file, archived on disk. */
function UploadInto({ id, kind }: { id: string; kind: 'image' | 'video' | 'audio' }) {
  const [busy, setBusy] = useState(false);
  const notify = useUI((s) => s.notify);
  return (
    <label className={`text-btn nodrag upload-into ${busy ? 'busy' : ''}`}>
      <Icon name="upload" size={14} />
      {busy ? '上传中…' : `上传${NODE_META[kind].label}`}
      <input
        type="file"
        hidden
        accept={`${kind}/*`}
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (mediaKindOf(f.type) !== kind) return notify(`请选择${NODE_META[kind].label}文件`);
          setBusy(true);
          try {
            const media = await putMedia(f, kind, f.name);
            const s = useCanvas.getState();
            s.commit();
            s.addAsset(media);
            s.updateData(id, {
              outputs: [{ id: media.id, createdAt: Date.now(), media }],
              current: 0,
              status: 'done',
              title: f.name.replace(/\.[^.]+$/, ''),
            });
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

export const ScriptNode = memo(function ScriptNode(props: P) {
  const shots = currentOutput(props.data)?.shots;
  const storyboard = useCanvas((s) => s.storyboard);
  return (
    <NodeShell
      {...props}
      kind="script"
      extraActions={
        shots?.length ? (
          <button onClick={() => storyboard(props.id)} title="为每个镜头创建图片节点">
            <Icon name="film" size={14} />
            <span>生成分镜图</span>
          </button>
        ) : null
      }
    >
      {shots?.length ? (
        <ol className="cn-shots nowheel">
          {shots.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="script" title="脚本" hint="输入创意，生成分镜脚本" />
      )}
    </NodeShell>
  );
});

export const ReferenceNode = memo(function ReferenceNode({ id, data, selected }: P) {
  const [editing, setEditing] = useState(false);
  const { updateData, commit } = useCanvas(useShallow((s) => ({ updateData: s.updateData, commit: s.commit })));
  const noteField = useImeField(data.text ?? '', (v) => updateData(id, { text: v }));
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);
  return (
    <div className={`cn cn-k-reference ${selected ? 'is-selected' : ''}`} style={{ width: NODE_META.reference.width }}>
      <NodeTitle id={id} title={data.title} icon="note" />
      <div className="cn-card" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <textarea className="cn-text nodrag nowheel" autoFocus {...noteField} onFocus={commit} />
        ) : (
          <div className={`cn-text cn-text-view ${data.text ? '' : 'muted'}`}>{data.text || '双击输入参考说明（不参与生成）'}</div>
        )}
      </div>
      <Handles />
    </div>
  );
});

export const GroupNode = memo(function GroupNode({ id, data, selected }: P) {
  const { run, ungroup, nodes } = useCanvas(useShallow((s) => ({ run: s.run, ungroup: s.ungroup, nodes: s.nodes })));
  const notify = useUI((s) => s.notify);
  const children = nodes.filter((n) => n.parentId === id && isGenKind(n.type));
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={200} minHeight={120} lineClassName="grp-line" handleClassName="grp-handle" />
      <div className={`grp ${selected ? 'is-selected' : ''}`}>
        <NodeTitle id={id} title={data.title} icon="group" />
      </div>
      <NodeToolbar isVisible={!!selected} position={Position.Top} className="cn-actions" {...isolate}>
        <button disabled={!children.length} onClick={() => run(children.map((n) => n.id))}>
          <Icon name="sparkles" size={14} />
          <span>批量生成 {children.length} 个节点</span>
        </button>
        <button
          onClick={() => {
            const t = useCanvas.getState().saveGroupToToolbox(id);
            notify(t ? `已将「${t.name}」添加到工具箱` : '分组内没有节点');
          }}
        >
          <Icon name="workflow" size={14} />
          <span>添加到工具箱</span>
        </button>
        <button onClick={() => ungroup([id])}>
          <Icon name="group" size={14} />
          <span>取消分组</span>
        </button>
      </NodeToolbar>
    </>
  );
});

export const VideoClipNode = memo(function VideoClipNode(props: P) {
  const { id } = props;
  const sources = useUpstream(id);
  // Clip order follows the canvas: top-to-bottom, then left-to-right.
  const clips = sources
    .map((n) => ({ node: n, media: currentOutput(n.data)?.media }))
    .filter((c): c is { node: CanvasNode; media: MediaRef } => c.media?.kind === 'video')
    .sort((a, b) => a.node.position.y - b.node.position.y || a.node.position.x - b.node.position.x);
  const urls = useMediaUrls(clips.map((c) => c.media.id));
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const notify = useUI((s) => s.notify);

  useEffect(() => {
    if (idx >= clips.length) setIdx(0);
  }, [clips.length, idx]);
  useEffect(() => {
    if (playing) video.current?.play().catch(() => setPlaying(false));
  }, [idx, playing]);

  const exportList = () =>
    downloadText(
      JSON.stringify(
        clips.map((c, i) => ({ index: i + 1, node: c.node.data.title, mediaId: c.media.id })),
        null,
        2,
      ),
      `${props.data.title}-剪辑清单.json`,
      'application/json',
    );

  return (
    <NodeShell
      {...props}
      kind="video-clip"
      extraActions={
        clips.length ? (
          <>
            <button onClick={exportList} title="导出剪辑清单">
              <Icon name="file" size={14} />
              <span>剪辑清单</span>
            </button>
            <button onClick={() => notify('合成成片需要接入后端合成服务（如 FFmpeg），当前为预览模式')}>
              <Icon name="film" size={14} />
              <span>合成</span>
            </button>
          </>
        ) : null
      }
    >
      {clips.length === 0 ? (
        <EmptyState icon="clip" title="空空如也" hint="请连接视频节点后操作，片段按画布上的位置排序" aspect={16 / 9} />
      ) : (
        <div className="clip">
          <video
            ref={video}
            className="cn-media"
            src={urls[idx]}
            style={{ aspectRatio: '16 / 9' }}
            playsInline
            onEnded={() => (idx < clips.length - 1 ? setIdx(idx + 1) : (setPlaying(false), setIdx(0)))}
          />
          <div className="clip-bar nodrag">
            <button
              onClick={() => {
                if (playing) video.current?.pause();
                setPlaying(!playing);
              }}
            >
              {playing ? '暂停' : '连播'}
            </button>
            <div className="clip-track nowheel">
              {clips.map((c, i) => (
                <button key={c.node.id} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} title={c.node.data.title}>
                  <MediaThumb media={c.media} />
                  <span>{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </NodeShell>
  );
});

export function RoleAvatar({ role, size = 40 }: { role: Role; size?: number }) {
  if (role.assets.avatar) return <MediaThumb media={role.assets.avatar} className="role-avatar" />;
  return (
    <div className="role-avatar role-initial" style={{ ...coverStyle(roleHue(role)), width: size, height: size, fontSize: size * 0.42 }}>
      {role.name.slice(0, 1)}
    </div>
  );
}

function MaterialNode(props: P & { kind: 'style' | 'lens' }) {
  const { id, data, kind } = props;
  const item = findMaterial(kind, data.materialId);
  const setUI = useUI((s) => s.set);
  const label = kind === 'style' ? '风格' : '特效';
  const pick = () => setUI({ library: { kind, targetNodeId: id } });
  return (
    <NodeShell
      {...props}
      kind={kind}
      extraActions={
        <button onClick={pick}>
          <Icon name={NODE_META[kind].icon} size={14} />
          <span>{item ? `更换${label}` : `选择${label}`}</span>
        </button>
      }
    >
      {item ? (
        <div className="mat-node">
          <div className="mat-cover" style={coverStyle(item.hue)}>
            <span className="mat-cover-name">{item.name}</span>
          </div>
          <p>{item.prompt}</p>
        </div>
      ) : (
        <div className="cn-empty">
          <Icon name={NODE_META[kind].icon} size={28} />
          <strong>{label}节点</strong>
          <button className="text-btn nodrag" onClick={pick}>
            选择{label}
          </button>
        </div>
      )}
    </NodeShell>
  );
}

export const StyleNode = memo(function StyleNode(props: P) {
  return <MaterialNode {...props} kind="style" />;
});

export const LensNode = memo(function LensNode(props: P) {
  return <MaterialNode {...props} kind="lens" />;
});

export const CharacterNode = memo(function CharacterNode(props: P) {
  const { id, data } = props;
  useLibrary((s) => s.roles); // re-render when the role is edited
  const role = findRole(data.roleId);
  const setUI = useUI((s) => s.set);
  return (
    <NodeShell
      {...props}
      kind="character"
      extraActions={
        <button onClick={() => setUI({ studio: role ? { roleId: role.id } : { pickFor: id } })}>
          <Icon name="smile" size={14} />
          <span>{role ? '编辑角色' : '选择角色'}</span>
        </button>
      }
    >
      {role ? (
        <div className="char-node">
          <RoleAvatar role={role} size={64} />
          <div>
            <b>{role.name}</b>
            <small>
              {role.attrs.gender} · {role.attrs.age} · {role.attrs.era}
            </small>
            <p>{role.desc || '（无描述）'}</p>
          </div>
        </div>
      ) : (
        <div className="cn-empty">
          <Icon name="smile" size={28} />
          <strong>角色节点</strong>
          <button className="text-btn nodrag" onClick={() => setUI({ studio: { pickFor: id } })}>
            从角色库选择
          </button>
        </div>
      )}
    </NodeShell>
  );
});

export const DirectorNode = memo(function DirectorNode(props: P) {
  const setUI = useUI((s) => s.set);
  const out = currentOutput(props.data);
  const sc = props.data.scene;
  const count = (k: string) => sc?.objects.filter((o) => o.kind === k).length ?? 0;
  const open = () => setUI({ directorFor: props.id });
  return (
    <NodeShell
      {...props}
      kind="director"
      extraActions={
        <button onClick={open}>
          <Icon name="cube" size={14} />
          <span>打开导演台</span>
        </button>
      }
    >
      <div className="dir-node" onDoubleClick={open}>
        {out?.media ? <MediaThumb media={out.media} className="dir-shot" /> : <div className="dir-empty"><Icon name="cube" size={30} /><span>双击打开 3D 导演台</span></div>}
        <div className="dir-meta">
          {count('character')} 个人物 · {count('prop')} 个道具 · {count('camera')} 个机位
        </div>
      </div>
    </NodeShell>
  );
});

export const nodeTypes = {
  director: DirectorNode,
  style: StyleNode,
  lens: LensNode,
  character: CharacterNode,
  text: TextNode,
  image: MediaNode,
  video: MediaNode,
  audio: MediaNode,
  script: ScriptNode,
  reference: ReferenceNode,
  group: GroupNode,
  'video-clip': VideoClipNode,
};
