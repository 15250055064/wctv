import { useEffect, useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from './Icon';
import {
  BUILTIN_TOOLBOX,
  LENS_CATEGORIES,
  OFFICIAL_ROLES,
  ROLE_ASSETS,
  ROLE_ATTR_LABEL,
  ROLE_OPTIONS,
  STYLE_CATEGORIES,
  VOICES,
  catalogOf,
  coverStyle,
  generateRoleAssets,
  newRole,
  previewVoice,
  useLibrary,
  type MaterialItem,
  type MaterialKind,
  type Role,
  type RoleAttrKey,
  type ToolboxTemplate,
} from './library';
import { putMedia } from './media';
import { IMAGE_PRESETS, applyPreset, type ImagePreset } from './presets';
import { MediaThumb, RoleAvatar } from './nodes';
import { useViewportCenter } from './panels';
import { useCanvas } from './store';
import { useUI } from './ui';
import { useImeField } from './useImeField';
import { isGenKind } from './types';

const KIND_LABEL: Record<MaterialKind, string> = { style: '风格', lens: '特效' };

// ---------------------------------------------------------------------------
// Style / effect library
// ---------------------------------------------------------------------------

/** Places a style or effect: fills a pending node, wires it into the selected consumer, or drops it mid-screen. */
function useApplyMaterial() {
  const center = useViewportCenter();
  const { getNode } = useReactFlow();
  return (kind: MaterialKind, item: MaterialItem, targetNodeId?: string) => {
    const canvas = useCanvas.getState();
    const title = `素材-${KIND_LABEL[kind]}-${item.name}`;
    useLibrary.getState().touchRecent(kind, item.id);
    if (targetNodeId) {
      canvas.commit();
      canvas.updateData(targetNodeId, { materialId: item.id, title });
      return `已更换${KIND_LABEL[kind]}`;
    }
    const sel = canvas.nodes.filter((n) => n.selected);
    // Styles and effects feed any generation node: image, text or script.
    const consumer = sel.length === 1 && isGenKind(sel[0].type) ? getNode(sel[0].id) : undefined;
    if (consumer) {
      const pos = { x: consumer.position.x - 300, y: consumer.position.y };
      canvas.addNode(kind, pos, { data: { materialId: item.id, title }, to: consumer.id });
      return `已连接到「${consumer.data.title}」`;
    }
    canvas.addNode(kind, center(), { data: { materialId: item.id, title } });
    return `已添加${KIND_LABEL[kind]}节点，连到图片、文本或脚本节点即可生效`;
  };
}

const hueDot = (hue: number) => ({ background: `hsl(${hue} 70% 58%)` });

/** One compact row: a colour dot, the name and a one-line description (full text on hover). */
function MaterialRow({ name, desc, dot, icon, fav, onFav, onUse }: { name: string; desc: string; dot?: number; icon?: string; fav?: boolean; onFav?: () => void; onUse: () => void }) {
  return (
    <div className="mat-row" title={desc} onClick={onUse}>
      {icon ? <Icon name={icon} size={14} /> : <i className="mat-dot" style={hueDot(dot ?? 0)} />}
      <span className="mat-text">
        <b>{name}</b>
        <small>{desc}</small>
      </span>
      {onFav && (
        <button
          className={`mat-fav ${fav ? 'on' : ''}`}
          title={fav ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            onFav();
          }}
        >
          <Icon name="star" size={12} />
        </button>
      )}
    </div>
  );
}

const PRESETS_TAB = '图片玩法';

export function MaterialLibrary() {
  const { library, set, notify } = useUI(useShallow((s) => ({ library: s.library, set: s.set, notify: s.notify })));
  const { favorites, recent, toggle } = useLibrary(useShallow((s) => ({ favorites: s.favorites, recent: s.recent, toggle: s.toggleFavorite })));
  const apply = useApplyMaterial();
  const center = useViewportCenter();
  const [cat, setCat] = useState('全部');
  const [q, setQ] = useState('');
  const kind = library?.kind;

  // Each opening starts on 全部.
  useEffect(() => {
    setCat('全部');
    setQ('');
  }, [library]);

  const list = useMemo(() => {
    if (!kind) return [];
    const catalog = catalogOf(kind);
    const byId = (ids: string[]) => ids.map((id) => catalog.find((m) => m.id === id)).filter((m): m is MaterialItem => !!m);
    const k = q.trim().toLowerCase();
    if (k) return catalog.filter((m) => [m.name, m.category, m.prompt].some((x) => x.toLowerCase().includes(k)));
    if (cat === '收藏') return byId(favorites[kind]);
    if (cat === '最近') return byId(recent[kind]);
    return catalog.filter((m) => cat === '全部' || m.category === cat);
  }, [kind, cat, q, favorites, recent]);
  const presets = useMemo(() => {
    const k = q.trim();
    return kind === 'style' && !library?.targetNodeId && (cat === PRESETS_TAB || k) ? IMAGE_PRESETS.filter((p) => !k || p.name.includes(k) || p.desc.includes(k)) : [];
  }, [kind, cat, q, library]);

  if (!library || !kind) return null;
  const close = () => set({ library: null });
  const use = (item: MaterialItem) => {
    notify(apply(kind, item, library.targetNodeId));
    close();
  };
  const usePreset = (p: ImagePreset) => {
    const sel = useCanvas.getState().nodes.filter((n) => n.selected && n.type !== 'group');
    const src = sel.length === 1 && sel[0].type === 'image' ? sel[0] : undefined;
    close();
    applyPreset(p, src, center());
  };
  const cats = [...(kind === 'style' ? STYLE_CATEGORIES : LENS_CATEGORIES), ...(kind === 'style' && !library.targetNodeId ? [PRESETS_TAB] : []), '收藏', '最近'];
  const showMaterials = cat !== PRESETS_TAB || !!q.trim();

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal mat-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">{KIND_LABEL[kind]}库</h3>
          <div className="lib-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`搜索${KIND_LABEL[kind]}`} />
          </div>
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        {!q && (
          <div className="lib-cats">
            {cats.map((c) => (
              <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="mat-list nowheel">
          {presets.length > 0 && <p className="muted small mat-hint">选中一张图片作参考再点，用 ChatGPT 生成（每次一张生图额度）；不选则新建空白节点。</p>}
          {presets.map((p) => (
            <MaterialRow key={p.id} name={p.name} desc={p.desc} icon="sparkles" onUse={() => usePreset(p)} />
          ))}
          {showMaterials &&
            list.map((m) => (
              <MaterialRow key={m.id} name={m.name} desc={m.prompt} dot={m.hue} fav={favorites[kind].includes(m.id)} onFav={() => toggle(kind, m.id)} onUse={() => use(m)} />
            ))}
          {!presets.length && (!showMaterials || !list.length) && <p className="empty">{cat === '收藏' ? '暂无收藏，点右侧星标收藏' : cat === '最近' ? '还没有使用过' : '没有匹配的内容'}</p>}
        </div>
        <p className="muted small mat-foot">{kind === 'style' ? '点一下即添加；选中图片、文本或脚本节点时会直接连上，生成时按这个风格来。' : '点一下即添加；连到脚本或文本节点会按这种运镜设计镜头，连到图片节点会体现在画面构图里。'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

function TemplateCard({ t, onUse, onDelete }: { t: ToolboxTemplate; onUse: () => void; onDelete?: () => void }) {
  return (
    <div className="tb-card">
      <div className="tb-cover" style={t.cover ? undefined : coverStyle(t.hue)}>
        {t.cover ? <MediaThumb media={t.cover} /> : <Icon name="workflow" size={28} />}
        <span className="tb-count">{t.nodes.length} 个节点</span>
        {onDelete && (
          <button className="tb-del" title="从工具箱删除" onClick={onDelete}>
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
      <div className="tb-meta">
        <span title={t.name}>
          {t.builtin ? '【预设】' : ''}
          {t.name}
        </span>
        <button className="text-btn" onClick={onUse}>
          使用
        </button>
      </div>
    </div>
  );
}

export function ToolboxPanel() {
  const { open, set, notify } = useUI(useShallow((s) => ({ open: s.toolbox, set: s.set, notify: s.notify })));
  const { toolbox, deleteTemplate } = useLibrary(useShallow((s) => ({ toolbox: s.toolbox, deleteTemplate: s.deleteTemplate })));
  const insert = useCanvas((s) => s.insertTemplate);
  const center = useViewportCenter();
  const { fitView } = useReactFlow();
  if (!open) return null;
  const close = () => set({ toolbox: false });
  const use = (t: ToolboxTemplate) => {
    insert(t, center());
    close();
    notify(`已插入「${t.name}」`);
    setTimeout(() => {
      const g = useCanvas.getState().nodes.find((n) => n.type === 'group' && n.selected);
      if (g) fitView({ nodes: [{ id: g.id }], duration: 400, padding: 0.3, maxZoom: 1 });
    }, 50);
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="lib-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lib-head">
          <h3 className="lib-title">我的工具箱</h3>
          <span className="muted small">选中分组，点工具栏的「添加到工具箱」即可保存自己的工作流</span>
          <div className="grow" />
          <button className="icon-btn" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
        </header>
        <div className="lib-grid tb-grid">
          {toolbox.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              onUse={() => use(t)}
              onDelete={() => {
                if (confirm(`从工具箱删除「${t.name}」？`)) deleteTemplate(t.id);
              }}
            />
          ))}
          {BUILTIN_TOOLBOX.map((t) => (
            <TemplateCard key={t.id} t={t} onUse={() => use(t)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Character studio
// ---------------------------------------------------------------------------

const roleMeta = (r: Role) => `${r.attrs.gender} · ${r.attrs.age} · ${r.attrs.region} · ${r.attrs.era}`;

function AttrSelect({ k, role, disabled, onChange }: { k: RoleAttrKey; role: Role; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{ROLE_ATTR_LABEL[k]}</span>
      <select className="pp-select" value={role.attrs[k]} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {ROLE_OPTIONS[k].map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function useAddRoleToCanvas() {
  const center = useViewportCenter();
  const { studio, set, notify } = useUI(useShallow((s) => ({ studio: s.studio, set: s.set, notify: s.notify })));
  return (r: Role) => {
    const canvas = useCanvas.getState();
    if (studio?.pickFor) {
      canvas.commit();
      canvas.updateData(studio.pickFor, { roleId: r.id, title: r.name });
    } else canvas.addNode('character', center(), { data: { roleId: r.id, title: r.name } });
    set({ studio: null });
    notify(`已将「${r.name}」添加到画布，连到图片/视频节点或在提示词中 @${r.name} 即可引用`);
  };
}

function RoleEditor({ role, onCopy }: { role: Role; onCopy: (r: Role) => void }) {
  const { saveRole, deleteRole } = useLibrary(useShallow((s) => ({ saveRole: s.saveRole, deleteRole: s.deleteRole })));
  const { set, notify } = useUI(useShallow((s) => ({ set: s.set, notify: s.notify })));
  const addMediaNode = useCanvas((s) => s.addMediaNode);
  const center = useViewportCenter();
  const addToCanvas = useAddRoleToCanvas();
  const ro = !!role.official;
  const patch = (p: Partial<Role>) => saveRole({ ...role, ...p });
  const setAttr = (k: RoleAttrKey, v: string) => patch({ attrs: { ...role.attrs, [k]: v } });
  const generating = role.status === 'generating';
  const nameField = useImeField(role.name, (v) => patch({ name: v }));
  const descField = useImeField(role.desc, (v) => patch({ desc: v }));

  return (
    <div className="role-editor">
      <div className="role-head">
        <RoleAvatar role={role} size={56} />
        <div className="role-head-text">
          {ro ? <h3>{role.name}</h3> : <input className="role-name" {...nameField} aria-label="角色名称" />}
          <span className="muted">{roleMeta(role)}</span>
        </div>
        <div className="grow" />
        <button className="text-btn" onClick={() => onCopy(role)} title="复制为我的角色，可独立修改">
          <Icon name="copy" size={14} />
          {ro ? '复制到我的角色库' : '复制'}
        </button>
        {!ro && (
          <button
            className="text-btn"
            onClick={() => {
              if (confirm(`删除角色「${role.name}」？删除后无法恢复。`)) {
                deleteRole(role.id);
                set({ studio: {} });
              }
            }}
          >
            <Icon name="trash" size={14} />
            删除
          </button>
        )}
        <button className="primary-btn" onClick={() => addToCanvas(role)}>
          添加到画布
        </button>
      </div>
      {ro && <div className="banner">官方角色不可直接编辑，复制到我的角色库后即可修改造型与音色。</div>}

      <section>
        <h4>基础信息</h4>
        <label className="field wide">
          <span>角色描述</span>
          <textarea
            {...descField}
            disabled={ro}
            placeholder="描述角色的核心特征或希望保留的细节"
            maxLength={200}
          />
        </label>
        <div className="fields">
          {(['gender', 'age', 'region', 'era'] as const).map((k) => (
            <AttrSelect key={k} k={k} role={role} disabled={ro} onChange={(v) => setAttr(k, v)} />
          ))}
        </div>
      </section>

      <section>
        <h4>身材与服装造型</h4>
        <div className="fields">
          {(['body', 'hair', 'outfit', 'look'] as const).map((k) => (
            <AttrSelect key={k} k={k} role={role} disabled={ro} onChange={(v) => setAttr(k, v)} />
          ))}
        </div>
      </section>

      <section>
        <h4>音色音调</h4>
        <div className="fields">
          <label className="field">
            <span>音色</span>
            <select className="pp-select" value={role.voice.preset} disabled={ro} onChange={(e) => patch({ voice: { ...role.voice, preset: e.target.value } })}>
              {VOICES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>语速 {role.voice.speed.toFixed(1)}</span>
            <input type="range" min={0.5} max={2} step={0.1} value={role.voice.speed} disabled={ro} onChange={(e) => patch({ voice: { ...role.voice, speed: Number(e.target.value) } })} />
          </label>
          <label className="field">
            <span>音调 {role.voice.pitch.toFixed(1)}</span>
            <input type="range" min={0.5} max={1.5} step={0.1} value={role.voice.pitch} disabled={ro} onChange={(e) => patch({ voice: { ...role.voice, pitch: Number(e.target.value) } })} />
          </label>
          <button
            className="text-btn voice-try"
            onClick={() => {
              if (!previewVoice(role.voice, `你好，我是${role.name}，很高兴和你见面。`)) notify('当前浏览器不支持语音试听');
            }}
          >
            <Icon name="mic" size={14} />
            试听
          </button>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h4>角色资产</h4>
          {!ro && (
            <button className="text-btn" disabled={generating} onClick={() => generateRoleAssets(role.id)}>
              <Icon name="sparkles" size={14} />
              {generating ? `生成中 ${Math.round((role.progress ?? 0) * 100)}%` : Object.keys(role.assets).length ? '重新生成全部' : '生成角色资产'}
            </button>
          )}
        </div>
        {ro && <p className="muted small">复制到我的角色库后可生成头像、全身图、转面板与情绪九宫格。</p>}
        <div className="asset-grid">
          {ROLE_ASSETS.map((a) => {
            const media = role.assets[a.kind];
            return (
              <div key={a.kind} className="asset-slot">
                <div className="asset-media">{media ? <MediaThumb media={media} /> : <span className="muted small">{generating ? '生成中…' : '未生成'}</span>}</div>
                <div className="asset-row">
                  <span>{a.label}</span>
                  {media && (
                    <button className="icon-btn" title="添加到画布" onClick={() => addMediaNode(media, center())}>
                      <Icon name="plus" size={14} />
                    </button>
                  )}
                  {!ro && !generating && (
                    <button className="icon-btn" title={`重新生成${a.label}`} onClick={() => generateRoleAssets(role.id, [a.kind])}>
                      <Icon name="redo" size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CreateRole({ onCreated }: { onCreated: (r: Role) => void }) {
  const [method, setMethod] = useState<'desc' | 'import' | 'quick'>('desc');
  const [draft, setDraft] = useState(() => newRole());
  const [files, setFiles] = useState<File[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const { roles, saveRole } = useLibrary(useShallow((s) => ({ roles: s.roles, saveRole: s.saveRole })));
  const notify = useUI((s) => s.notify);

  const createFromDesc = () => {
    if (!draft.desc.trim()) return notify('请先描述角色特征');
    const r = { ...draft, name: draft.name.trim() || '新角色', createdAt: Date.now() };
    saveRole(r);
    onCreated(r);
    generateRoleAssets(r.id);
  };
  const createFromImport = async () => {
    if (!files.length) return notify('请选择至少一张人物参考图');
    if (!authorized) return notify('请先确认拥有该素材及人物形象的合法使用授权');
    setBusy(true);
    try {
      const [avatar, full] = await Promise.all(files.slice(0, 2).map((f) => putMedia(f, 'image', f.name)));
      const r = { ...draft, name: draft.name.trim() || '导入角色', assets: { avatar, ...(full ? { full } : {}) }, createdAt: Date.now() };
      saveRole(r);
      onCreated(r);
    } finally {
      setBusy(false);
    }
  };
  const copyFrom = (src: Role) => {
    const r = newRole({ name: `${src.name} 副本`, desc: src.desc, attrs: { ...src.attrs }, voice: { ...src.voice }, assets: { ...src.assets } });
    saveRole(r);
    onCreated(r);
  };
  const attrs = (keys: RoleAttrKey[]) => (
    <div className="fields">
      {keys.map((k) => (
        <AttrSelect key={k} k={k} role={draft} disabled={false} onChange={(v) => setDraft({ ...draft, attrs: { ...draft.attrs, [k]: v } })} />
      ))}
    </div>
  );

  return (
    <div className="role-editor">
      <h3>创建新角色</h3>
      <p className="muted">通过描述、导入或已有角色创建个人角色</p>
      <div className="seg create-tabs">
        <button className={method === 'desc' ? 'on' : ''} onClick={() => setMethod('desc')}>
          人物描述生成
        </button>
        <button className={method === 'import' ? 'on' : ''} onClick={() => setMethod('import')}>
          导入已有角色
        </button>
        <button className={method === 'quick' ? 'on' : ''} onClick={() => setMethod('quick')}>
          基于已有角色快速生成
        </button>
      </div>

      {method !== 'quick' && (
        <label className="field wide">
          <span>角色名称</span>
          <input className="role-name small" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="请输入角色名称" />
        </label>
      )}

      {method === 'desc' && (
        <>
          <label className="field wide">
            <span>描述你的角色特征</span>
            <textarea
              value={draft.desc}
              onChange={(e) => setDraft({ ...draft, desc: e.target.value })}
              placeholder="例如：现代东亚年轻女性，短发，蓝白印花长裙，冷静自信"
              maxLength={200}
            />
          </label>
          {attrs(['gender', 'age', 'region', 'era', 'body', 'hair', 'outfit', 'look'])}
          <button className="primary-btn" onClick={createFromDesc}>
            生成角色
          </button>
        </>
      )}

      {method === 'import' && (
        <>
          <p className="muted small">上传已获授权的人物参考图（1–2 张，第一张建议为清晰正脸），可补充描述后创建角色。</p>
          <label className="upload-btn">
            <Icon name="upload" size={14} />
            {files.length ? `已选择 ${files.length} 张图片` : '选择本地图片'}
            <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 2))} />
          </label>
          <label className="field wide">
            <span>可选：补充角色外貌、服装或气质描述</span>
            <textarea value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} maxLength={200} />
          </label>
          {attrs(['gender', 'age', 'region', 'era'])}
          <label className="lib-check">
            <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
            我确认拥有该素材及人物形象的合法使用授权
          </label>
          <button className="primary-btn" disabled={busy} onClick={createFromImport}>
            {busy ? '导入中…' : '导入并创建'}
          </button>
        </>
      )}

      {method === 'quick' && (
        <>
          <p className="muted small">复制我的角色或官方角色，再独立修改。</p>
          <div className="quick-roles">
            {[...roles, ...OFFICIAL_ROLES].map((r) => (
              <button key={r.id} className="role-card" onClick={() => copyFrom(r)}>
                <RoleAvatar role={r} />
                <span className="role-card-text">
                  <b>{r.name}</b>
                  <small>{r.official ? '官方 · ' : ''}{roleMeta(r)}</small>
                </span>
                <span className="muted small">基于此创建</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function CharacterStudio() {
  const { studio, set } = useUI(useShallow((s) => ({ studio: s.studio, set: s.set })));
  const roles = useLibrary((s) => s.roles);
  const saveRole = useLibrary((s) => s.saveRole);
  const [tab, setTab] = useState<'mine' | 'official'>('mine');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Partial<Record<RoleAttrKey, string>>>({});
  const selectedId = studio?.roleId;

  useEffect(() => {
    if (selectedId && OFFICIAL_ROLES.some((r) => r.id === selectedId)) setTab('official');
  }, [selectedId]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (tab === 'mine' ? roles : OFFICIAL_ROLES).filter(
      (r) => (!k || r.name.toLowerCase().includes(k) || r.desc.toLowerCase().includes(k)) && Object.entries(filters).every(([fk, fv]) => !fv || r.attrs[fk as RoleAttrKey] === fv),
    );
  }, [tab, roles, q, filters]);

  if (!studio) return null;
  const close = () => set({ studio: null });
  const open = (roleId?: string) => set({ studio: { ...studio, roleId } });
  const selected = [...roles, ...OFFICIAL_ROLES].find((r) => r.id === selectedId);
  const copy = (src: Role) => {
    const r = newRole({ name: `${src.name} 副本`, desc: src.desc, attrs: { ...src.attrs }, voice: { ...src.voice }, assets: { ...src.assets } });
    saveRole(r);
    setTab('mine');
    open(r.id);
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="studio" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="studio-side">
          <header>
            <div>
              <h3>角色造型室</h3>
              <small className="muted">创建、管理并复用角色的造型与音色</small>
            </div>
          </header>
          <div className="seg">
            <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
              我的角色库
            </button>
            <button className={tab === 'official' ? 'on' : ''} onClick={() => setTab('official')}>
              官方角色库
            </button>
          </div>
          <div className="lib-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索角色名称或描述" />
          </div>
          <div className="role-filters">
            {(['gender', 'age', 'era'] as const).map((k) => (
              <select key={k} className="pp-select" value={filters[k] ?? ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}>
                <option value="">{ROLE_ATTR_LABEL[k]}</option>
                {ROLE_OPTIONS[k].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ))}
          </div>
          <button className={`role-card create ${selectedId === 'new' ? 'on' : ''}`} onClick={() => open('new')}>
            <span className="role-avatar role-initial">
              <Icon name="plus" />
            </span>
            <span className="role-card-text">
              <b>创建新角色</b>
              <small>描述生成 / 导入 / 基于已有角色</small>
            </span>
          </button>
          <div className="role-list">
            {list.length === 0 && <p className="empty">{tab === 'mine' ? '暂无我的角色' : '暂无角色'}</p>}
            {list.map((r) => (
              <button key={r.id} className={`role-card ${selectedId === r.id ? 'on' : ''}`} onClick={() => open(r.id)}>
                <RoleAvatar role={r} />
                <span className="role-card-text">
                  <b>{r.name}</b>
                  <small>{r.status === 'generating' ? `生成中 ${Math.round((r.progress ?? 0) * 100)}%` : roleMeta(r)}</small>
                </span>
              </button>
            ))}
          </div>
          <small className="muted">共 {list.length} 个角色</small>
        </aside>
        <main className="studio-main">
          <button className="icon-btn studio-close" onClick={close} aria-label="关闭">
            <Icon name="x" />
          </button>
          {selectedId === 'new' ? (
            <CreateRole
              onCreated={(r) => {
                setTab('mine');
                open(r.id);
              }}
            />
          ) : selected ? (
            <RoleEditor key={selected.id} role={selected} onCopy={copy} />
          ) : (
            <div className="studio-empty">
              <Icon name="smile" size={40} />
              <p>选择左侧角色查看详情，或创建一个新角色</p>
              <button className="primary-btn" onClick={() => open('new')}>
                创建新角色
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
