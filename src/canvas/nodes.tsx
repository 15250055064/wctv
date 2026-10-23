import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Handle, NodeResizer, NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { CUSTOM_LEN, defaultParams, MOD, MODELS, NODE_META, PARAMS, ratioOf } from './config';
import { Icon } from './Icon';
import { downloadMedia, downloadText, mediaKindOf, putMedia, revealInFinder, useMediaUrl, useMediaUrls } from './media';
import { allRoles, coverStyle, findMaterial, findRole, roleHue, useLibrary, type Role } from './library';
import { findMethod, type VideoMethod } from './methods';
import { composeRequest, currentOutput, useCanvas } from './store';
import { useImeField } from './useImeField';
import { VideoToolButtons } from './videoTools';
import { MediaToolsButton, exportGroupPsd } from './tools/ToolsUI';
import { useUI } from './ui';
import { isGenKind, type CanvasNode, type CanvasNodeData, type GenKind, type MediaRef, type NodeKind, type ParamValue, type Shot } from './types';

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

/** A generation node's option selects; 「自定义」 options get a number field next to them. */
function ParamControls({ id, kind, params, hide }: { id: string; kind: GenKind; params: Record<string, ParamValue>; hide?: string[] }) {
  const updateData = useCanvas((s) => s.updateData);
  const setParam = (key: string, v: ParamValue) => updateData(id, { params: { ...params, [key]: v } });
  return (
    <>
      {PARAMS[kind].filter((p) => (!p.when || p.when(params)) && !hide?.includes(p.key)).map((p) => {
        const value = params[p.key] ?? p.options[0];
        // A value saved from an older option list still shows up.
        const options = p.options.some((o) => String(o) === String(value)) ? p.options : [...p.options, value];
        return (
          <span key={p.key} className="pp-param">
            <select
              className="pp-select"
              title={p.label}
              value={String(value)}
              onChange={(e) => setParam(p.key, options.find((o) => String(o) === e.target.value)!)}
            >
              {options.map((o) => (
                <option key={String(o)} value={String(o)}>
                  {p.format ? p.format(o) : String(o)}
                </option>
              ))}
            </select>
            {p.custom && value === CUSTOM_LEN && <CustomNumber value={params[`${p.key}Custom`]} range={p.custom} onCommit={(n) => setParam(`${p.key}Custom`, n)} />}
          </span>
        );
      })}
    </>
  );
}

function CustomNumber({ value, range, onCommit }: { value?: ParamValue; range: { min: number; max: number; unit: string }; onCommit: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  const commit = () => {
    const n = Math.round(Number(text));
    if (!(n > 0)) return setText(value ? String(value) : '');
    const v = Math.min(range.max, Math.max(range.min, n));
    setText(String(v));
    onCommit(v);
  };
  return (
    <label className="pp-custom">
      <input
        className="nodrag"
        inputMode="numeric"
        value={text}
        autoFocus={!value}
        placeholder="输入"
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {range.unit}
    </label>
  );
}

/** Text-like nodes can be resized; their content then fills the box and scrolls inside it. */
const RESIZABLE: ReadonlySet<NodeKind> = new Set(['text', 'script', 'vprompt', 'voice']);

function NodeResize({ selected }: { selected: boolean }) {
  return <NodeResizer isVisible={selected} minWidth={240} minHeight={140} lineClassName="cn-rs-line" handleClassName="cn-rs-handle" />;
}

function NodeShell({ id, data, selected, kind, cardWidth, children, extraActions }: P & { kind: NodeKind; cardWidth?: number; children: ReactNode; extraActions?: ReactNode }) {
  const meta = NODE_META[kind];
  const resizable = RESIZABLE.has(kind);
  // Only a size the user dragged out counts: React Flow also passes the measured size as
  // width/height, which would lock every node to whatever it last measured.
  const userSized = useCanvas((s) => {
    const n = s.nodes.find((x) => x.id === id);
    return !!(n?.width && n?.height);
  });
  const sized = resizable && userSized;
  return (
    <div
      className={`cn cn-k-${kind} ${selected ? 'is-selected' : ''} ${data.status === 'running' ? 'is-running' : ''} ${sized ? 'is-sized' : ''}`}
      style={sized ? { width: '100%', height: '100%' } : { width: cardWidth ?? meta.width }}
    >
      {resizable && <NodeResize selected={!!selected} />}
      <NodeTitle id={id} title={data.title} icon={meta.icon} />
      <div className="cn-card">
        {children}
        <Progress data={data} />
      </div>
      <Handles />
      {/* Toolbar and prompt panel exist only while selected: mounted on every node they'd re-render on each canvas change. */}
      {selected && <NodeActions id={id} data={data} kind={kind} selected extra={extraActions} />}
      {selected && isGenKind(kind) && kind !== 'method' && <PromptPanel id={id} kind={kind} data={data} selected />}
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
  // Voice-overs read wired-in text; the box then holds reading directions instead.
  const hasTextInput = useCanvas((st) => st.edges.some((e) => e.target === id && ['text', 'script'].includes(st.nodes.find((n) => n.id === e.source)?.type ?? '')));
  const placeholder: Record<GenKind, string> = {
    text: '描述你想生成的文案，连接的文本会作为上下文，输入 @ 可引用角色…',
    image: '描述你想生成的画面，连接的图片会作为参考图，输入 @ 可引用角色…',
    script: '输入故事创意，生成分镜脚本，输入 @ 可引用角色…',
    audio: '描述想要的音乐：风格、情绪、乐器、节奏，例如「温暖的钢琴与弦乐，缓慢抒情」…',
    vprompt: '描述这段视频，或连入分镜脚本、参考图、角色、视频玩法，按 Seedance 2.0 写提示词…',
    voice: '输入要配音的文字，或连入文本 / 脚本节点；选「AI 写口播」会先改写成口播稿…',
    method:
      data.params?.version === '改上一版'
        ? '说说哪里要改，例如「标题再大一点，第二段节奏放慢」，AI 会在上一版的基础上修改并重新渲染…'
        : '写下想做的视频：主题、内容、风格、要出现的文字…连入的文本、脚本、图片、视频和音频都会作为素材交给 AI…',
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
          {preview.kind === 'voice' && String(params.writer ?? '原文') === '原文' ? (
            <small className="muted">不经过 AI：{params.mode === '克隆' ? '用克隆的声音' : 'Qwen3-TTS'} 直接朗读以上文字{preview.instruct ? '，并按朗读要求调整语气' : ''}。</small>
          ) : (
            <small className="muted">
              {MODELS[kind].find((m) => m.id === preview.model)?.label} 会收到以上全文
              {preview.images.length + preview.videos.length ? `，并附上 ${preview.images.length + preview.videos.length} 张参考图` : ''}；另附「{kind === 'image' ? '画幅比例与保存图片' : '直接输出正文'}」的格式要求。
            </small>
          )}
        </div>
      )}
      <div className="pp-area">
        <textarea
          ref={area}
          className="nodrag"
          {...promptField}
          placeholder={
            kind === 'audio' && params.mode === '配音' && hasTextInput
              ? '已连入文本：这里写朗读要求（如「语速稍慢，带点笑意」），会读连入的文字；男声 / 女声在下方「音色」里选…'
              : kind === 'audio' && params.mode === '克隆'
              ? '输入要用克隆声音朗读的文字，并把一段要克隆的录音（音频节点）连到这里…'
              : kind === 'audio' && params.mode === '配音'
                ? placeholder.voice
                : kind === 'text' && params.mode === '视频提示词'
                  ? placeholder.vprompt
                  : placeholder[kind]
          }
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
        <div className="pp-opts">
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
          <ParamControls id={id} kind={kind} params={params} />
        </div>
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
  const { getNode } = useReactFlow();
  /** 转旁白 / 转音乐: a new audio node wired from this text, selected so its options can be set before generating. */
  const toAudio = (voice: boolean) => {
    if (!data.text?.trim()) return useUI.getState().notify('先写好文本内容');
    const n = getNode(id);
    if (!n) return;
    const s = useCanvas.getState();
    const params = voice ? { ...defaultParams('audio'), mode: '配音', writer: '原文' } : { ...defaultParams('audio'), vocal: '纯音乐' };
    const prompt = voice ? '' : '为这段文字配一段背景音乐，贴合它的情绪、节奏和用途';
    s.addNode('audio', { x: n.position.x + (n.measured?.width ?? 320) + 120, y: n.position.y }, { from: id, data: { title: voice ? `${data.title} · 旁白` : `${data.title} · 配乐`, params, prompt } });
    useUI.getState().notify(voice ? '已新建旁白节点：选好音色和语气，可写朗读要求，再点 ↑ 生成' : '已新建配乐节点：可改风格描述、人声和时长，再点 ↑ 生成');
  };
  return (
    <NodeShell
      {...props}
      kind="text"
      extraActions={
        <>
          <button onClick={() => toAudio(true)} title="用 Qwen3-TTS 把这段文字读成旁白（新建一个配音节点）">
            <Icon name="mic" size={14} />
            <span>转旁白</span>
          </button>
          <button onClick={() => toAudio(false)} title="按这段文字的内容和情绪生成背景音乐（新建一个音乐节点）">
            <Icon name="audio" size={14} />
            <span>转音乐</span>
          </button>
        </>
      }
    >
      {selected ? (
        <textarea className="cn-text nodrag nowheel" {...textField} placeholder="输入文本，或在下方输入提示词生成…" onFocus={commit} />
      ) : data.text ? (
        <div className="cn-text cn-text-view cn-selectable">{data.text}</div>
      ) : (
        <EmptyState icon="text" title="文本" hint="选中后输入或生成文本" />
      )}
      <Reasoning text={currentOutput(data)?.reasoning} />
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
    <NodeShell
      {...props}
      kind={kind}
      cardWidth={width}
      extraActions={
        media && !props.data.busy ? (
          <>
            {kind === 'video' && <VideoToolButtons id={props.id} />}
            <MediaToolsButton id={props.id} kind={kind} />
          </>
        ) : null
      }
    >
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
                ? '选中后在下方选「音乐」或「配音」：音乐由 ACE-Step 出歌或合成小样，配音用 Qwen3-TTS（可克隆连入的声音）；也可以'
                : '上传本地文件，自动留档到「影片/WCcanvastv」'}
          </span>
          <UploadInto id={props.id} kind={kind} />
        </div>
      )}
          {kind === 'audio' && <Reasoning text={out?.reasoning} />}
    </NodeShell>
  );
});

/** Voice-over: the narration that was read, its audio, and how the AI wrote it. */
export const VoiceNode = memo(function VoiceNode(props: P) {
  const out = currentOutput(props.data);
  return (
    <NodeShell {...props} kind="voice">
      {out?.media ? (
        <>
          <MediaView media={out.media} kind="audio" onMeasure={() => {}} />
          {out.text && <div className={`cn-voice-text nowheel cn-selectable ${props.selected ? 'nodrag' : ''}`}>{out.text}</div>}
        </>
      ) : (
        <EmptyState icon="mic" title="配音" hint="输入文字或连入文本 / 脚本，选音色和语气后生成；也可以先让 GPT / Claude 写口播" />
      )}
      <Reasoning text={out?.reasoning} />
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
      {shots?.length && props.selected ? (
        <ShotsEditor id={props.id} shots={shots} />
      ) : shots?.length ? (
        <ol className="cn-shots nowheel cn-selectable">
          {shots.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="script" title="脚本" hint="输入创意，生成分镜脚本" />
      )}
      <Reasoning text={currentOutput(props.data)?.reasoning} />
    </NodeShell>
  );
});

/** Replaces the shots of the node's current output (an edit, so it can be undone). */
function setShots(id: string, shots: Shot[]) {
  const s = useCanvas.getState();
  const n = s.nodes.find((x) => x.id === id);
  if (!n) return;
  const cur = n.data.current ?? (n.data.outputs?.length ?? 1) - 1;
  const outputs = (n.data.outputs ?? []).map((o, i) => (i === cur ? { ...o, shots } : o));
  s.updateData(id, { outputs });
}

/** A selected storyboard: one line per shot, freely editable (blank lines are dropped). */
function ShotsEditor({ id, shots }: { id: string; shots: Shot[] }) {
  const commit = useCanvas((s) => s.commit);
  const field = useImeField(shots.map((s) => s.text).join('\n'), (v) => {
    const lines = v.split('\n');
    // Keep ids stable for lines that stay in place, so a half-typed new line isn't lost.
    setShots(id, lines.map((text, i) => ({ id: shots[i]?.id ?? Math.random().toString(36).slice(2, 8), text })));
  });
  // Blank lines stay while typing (so a new shot can be inserted anywhere) and go on blur.
  const tidy = () => {
    const kept = shots.filter((s) => s.text.trim());
    if (kept.length !== shots.length) setShots(id, kept);
  };
  return <textarea className="cn-text cn-edit nodrag nowheel" {...field} onFocus={commit} onBlur={tidy} spellCheck={false} placeholder="每行一个镜头" />;
}

/** One editable video prompt inside a selected video-prompt node. */
function PromptEditor({ id, shots, index }: { id: string; shots: Shot[]; index: number }) {
  const commit = useCanvas((s) => s.commit);
  const field = useImeField(shots[index].text, (v) => setShots(id, shots.map((s, i) => (i === index ? { ...s, text: v } : s))));
  const rows = Math.min(16, Math.max(3, Math.ceil(shots[index].text.length / 26) + shots[index].text.split('\n').length));
  return <textarea className="cn-vprompt-edit nodrag nowheel" rows={rows} {...field} onFocus={commit} spellCheck={false} />;
}

/** "生成思路": how the AI read and used each connected input. Collapsed by default. */
function Reasoning({ text, label = '生成思路' }: { text?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return null;
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^\s*[-•·]\s*/, '').trim())
    .filter(Boolean);
  return (
    <div className={`cn-reason nodrag ${open ? 'open' : ''}`}>
      <button className="cn-reason-head" onClick={() => setOpen(!open)}>
        <Icon name="sparkles" size={12} />
        <span>{label} · {lines.length} 条</span>
        <Icon name={open ? 'down' : 'right'} size={12} />
      </button>
      {open && (
        <ul className="cn-reason-list nowheel">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const copyText = (t: string) => navigator.clipboard.writeText(t).then(() => useUI.getState().notify('已复制'));

/** Seedance video prompts, one card per clip, each copyable. */
export const VPromptNode = memo(function VPromptNode(props: P) {
  const out = currentOutput(props.data);
  const prompts = out?.shots;
  return (
    <NodeShell
      {...props}
      kind="vprompt"
      extraActions={
        prompts?.length ? (
          <button onClick={() => copyText(prompts.map((p) => `${p.meta ? `【${p.meta}】\n` : ''}${p.text}`).join('\n\n'))} title="复制全部提示词">
            <Icon name="copy" size={14} />
            <span>复制全部</span>
          </button>
        ) : null
      }
    >
      {prompts?.length ? (
        <div className="cn-vprompts nowheel">
          {prompts.map((p, i) => (
            <div key={p.id} className="cn-vprompt">
              <div className="cn-vprompt-head">
                <b>{i + 1}</b>
                <span>{p.meta}</span>
                <button className="icon-btn nodrag" title="复制这条提示词" onClick={() => copyText(p.text)}>
                  <Icon name="copy" size={12} />
                </button>
              </div>
              {props.selected ? <PromptEditor id={props.id} shots={prompts} index={i} /> : <p className="cn-selectable">{p.text}</p>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="film" title="视频提示词" hint="连入分镜脚本、参考图或角色，按 Seedance 2.0 方法写提示词" />
      )}
      <Reasoning text={out?.reasoning} />
    </NodeShell>
  );
});

function MethodPreview({ m, className }: { m: VideoMethod; className?: string }) {
  const src = `/methods/${m.preview}`;
  return m.preview.endsWith('.mp4') ? <video className={className} src={src} autoPlay muted loop playsInline /> : <img className={className} src={src} alt={m.name} />;
}

/**
 * A 玩法 node: pick a video method, add material, describe the film, and Claude Code or ChatGPT
 * builds and renders it with HyperFrames (server/studio.mjs). Everything happens in the card;
 * wired into a text / script / image node instead, the method shapes that generation.
 */
export const MethodNode = memo(function MethodNode(props: P) {
  const { id, data } = props;
  const m = findMethod(data.methodId);
  const setUI = useUI((s) => s.set);
  const rerender = useCanvas((s) => s.rerenderFilm);
  const out = currentOutput(data);
  const film = out?.media?.kind === 'video' ? out.media : undefined;
  const url = useMediaUrl(film?.id ?? '');
  const pick = () => setUI({ methodFor: id });
  const [opening, setOpening] = useState(false);
  const openStudio = async () => {
    if (!out?.studio || opening) return;
    setOpening(true);
    try {
      const r = await fetch('/api/studio/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: out.studio.workspace }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setUI({ hfStudio: { url: j.url, nodeId: id, workspace: out.studio.workspace } });
    } catch (err) {
      useUI.getState().notify(err instanceof Error ? err.message : '无法打开 Studio');
    } finally {
      setOpening(false);
    }
  };
  const running = data.status === 'running';
  return (
    <NodeShell
      {...props}
      kind="method"
      extraActions={
        out?.studio && (
          <>
            <button onClick={openStudio} disabled={running} title="在 HyperFrames Studio 里修改画面、文字和时间线">
              <Icon name="edit" size={14} />
              <span>{opening ? '正在打开…' : '在 Studio 中编辑'}</span>
            </button>
            <button onClick={() => rerender(id)} disabled={running} title="把 Studio 里的修改重新渲染成新版本">
              <Icon name="refresh" size={14} />
            </button>
            <button onClick={() => revealInFinder(`${out.studio!.workspace}/index.html`)} title="在访达中打开制作文件夹">
              <Icon name="folder" size={14} />
            </button>
          </>
        )
      }
    >
      <div className="method-head">
        {m ? <MethodPreview m={m} className="method-head-media" /> : <span className="method-head-media method-head-free"><Icon name="workflow" size={18} /></span>}
        <div className="method-head-text">
          <b>{m?.name ?? '自由创作'}</b>
          <small>{m?.tagline ?? '不套玩法，AI 按需求自己设计画面'}</small>
        </div>
        <button className="text-btn nodrag" onClick={pick}>
          {m ? '更换' : '选择玩法'}
        </button>
      </div>
      {film && url && (
        <div className="method-film nodrag">
          <video className="method-film-video" src={url} controls playsInline preload="metadata" />
          <div className="method-film-meta">
            <span>{out?.studio ? '可以在 Studio 里继续改，或在下面写修改意见' : ''}</span>
            <span className="grow" />
            {out?.studio && (
              <button className="text-btn" onClick={openStudio} disabled={running}>
                {opening ? '正在打开…' : '在 Studio 中编辑'}
              </button>
            )}
          </div>
          <Reasoning text={out?.text} label="制作说明" />
        </div>
      )}
      <MethodForm id={id} data={data} hasFilm={!!out?.studio} />
    </NodeShell>
  );
});

/** The 玩法 node's brief: material, request, options and the start button. */
function MethodForm({ id, data, hasFilm }: { id: string; data: CanvasNodeData; hasFilm: boolean }) {
  const { updateData, commit, run } = useCanvas(useShallow((s) => ({ updateData: s.updateData, commit: s.commit, run: s.run })));
  // Wired-in inputs as "kind|title" strings, so the selector stays stable while nodes move.
  const wired = useCanvas(
    useShallow((s) =>
      s.edges
        .filter((e) => e.target === id)
        .map((e) => {
          const n = s.nodes.find((x) => x.id === e.source);
          if (!n) return '';
          const media = currentOutput(n.data)?.media;
          const kind = media?.kind ?? (n.type === 'text' || n.type === 'script' || n.type === 'vprompt' ? 'text' : n.type);
          return `${kind}|${n.data.title}`;
        })
        .filter(Boolean),
    ),
  );
  const own = data.materials ?? [];
  const params = data.params ?? {};
  const running = data.status === 'running';
  const field = useImeField(data.prompt ?? '', (v) => updateData(id, { prompt: v }));
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const add = (items: MediaRef[]) => {
    if (!items.length) return;
    commit();
    const cur = useCanvas.getState().nodes.find((n) => n.id === id)?.data.materials ?? [];
    updateData(id, { materials: [...cur, ...items.filter((x) => !cur.some((c) => c.id === x.id))] });
  };
  const upload = async (files: File[]) => {
    const media = files.filter((f) => mediaKindOf(f.type));
    if (!media.length) return;
    setUploading(true);
    try {
      add(await Promise.all(media.map((f) => putMedia(f, mediaKindOf(f.type)!, f.name))));
    } finally {
      setUploading(false);
    }
  };
  const iconOf = (k: string) => (k === 'image' ? 'image' : k === 'video' ? 'video' : k === 'audio' ? 'audio' : 'text');
  return (
    <div
      className="method-form nodrag"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const asset = e.dataTransfer.getData('application/x-libcanvas-media');
        if (asset) add([JSON.parse(asset) as MediaRef]);
        else upload([...e.dataTransfer.files]);
      }}
    >
      <div className="method-label">
        素材
        <small>连线进来的节点、上传或拖进来的图片 / 视频 / 音频</small>
      </div>
      <div className="method-mats">
        {wired.map((w, i) => {
          const [k, title] = w.split('|');
          return (
            <span key={`w${i}`} className="method-mat" title="连线进来的节点">
              <Icon name={iconOf(k)} size={12} />
              {title}
            </span>
          );
        })}
        {own.map((x) => (
          <span key={x.id} className="method-mat own">
            {x.kind === 'image' ? <MediaThumb media={x} className="method-mat-thumb" /> : <Icon name={iconOf(x.kind)} size={12} />}
            {x.name ?? x.kind}
            <button title="移除" onClick={() => (commit(), updateData(id, { materials: own.filter((o) => o.id !== x.id) }))}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
        <button className="method-mat add" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Icon name="upload" size={12} />
          {uploading ? '上传中…' : '添加素材'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          hidden
          onChange={(e) => {
            upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <div className="method-label">{hasFilm && params.version === '改上一版' ? '修改意见' : '想做什么视频'}</div>
      <textarea
        className="method-text nowheel"
        rows={4}
        {...field}
        placeholder={
          hasFilm && params.version === '改上一版'
            ? '说说哪里要改，例如「标题再大一点，第二段节奏放慢」，AI 会在上一版的基础上修改并重新渲染…'
            : '主题、内容、风格、要出现的文字、时长…例如「30 秒介绍我们的咖啡店新品，温暖手绘风，结尾出现店名」'
        }
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run([id]);
        }}
      />
      <div className="method-opts">
        <select
          className="pp-select"
          value={MODELS.method.some((x) => x.id === data.model) ? data.model : MODELS.method[0].id}
          onChange={(e) => updateData(id, { model: e.target.value })}
          title="由谁来制作"
        >
          {MODELS.method.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <ParamControls id={id} kind="method" params={params} hide={hasFilm ? [] : ['version']} />
      </div>
      <button className="primary-btn method-go" disabled={running} onClick={() => run([id])}>
        {running ? (
          <>
            <span className="spinner light" /> 制作中…
          </>
        ) : (
          <>
            <Icon name="sparkles" size={14} /> {hasFilm && params.version === '改上一版' ? '按意见修改' : '开始制作'}
          </>
        )}
      </button>
    </div>
  );
}

export { MethodPreview };

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
        {data.psd && (
          <button disabled={!!data.busy} onClick={() => exportGroupPsd(id)} title="把这组图层按原位置导出成 PSD，用 Photoshop 等打开">
            <Icon name="layers" size={14} />
            <span>{data.busy ?? '导出 PSD'}</span>
          </button>
        )}
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
          {sc?.objects.some((o) => o.keys?.length || o.motionId) && ` · ${sc.duration ?? 5} 秒动画`}
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
  vprompt: VPromptNode,
  voice: VoiceNode,
  method: MethodNode,
  reference: ReferenceNode,
  group: GroupNode,
  'video-clip': VideoClipNode,
};
