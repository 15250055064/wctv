import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnectEnd,
  type XYPosition,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { isMac } from './config';
import { mediaKindOf, putMedia } from './media';
import { nodeTypes } from './nodes';
import { PreferencesPanel, SentViewer, ProjectManager, TileMenu, AssetsPanel, BottomToolbar, ContextMenu, EmptyHint, HistoryPanel, Lightbox, NodeMenu, SearchModal, ShortcutsPanel, Toast, TidyToast, TopBar, ViewControls } from './panels';
import { CharacterStudio, MaterialLibrary, ToolboxPanel } from './libraryPanels';
import { matchShortcut } from './shortcuts';
import { BreakdownModal, CropModal, DepthModal } from './videoTools';
import { MethodLibrary } from './methodPanel';
import { LocalEnginesPanel } from './localEngines';
import { HFStudioWindow } from './hfStudio';
import { ToolDialog } from './tools/ToolsUI';
import { FeatureTour } from './tour';
import { CanvasMiniMap } from './minimap';
import { useCanvas } from './store';
import { useUI } from './ui';
import { newProject } from './persistence';
import { useProject } from './project';
import { revealInFinder } from './media';
import type { CanvasNode, MediaRef } from './types';

// three.js and the 3D editor load only when a 导演台 is opened.
const DirectorEditor = lazy(() => import('../director/DirectorEditor').then((m) => ({ default: m.DirectorEditor })));

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Upload files and place one node per file, cascading from `at`. */
/** The link to download in pasted text: the text itself, or the link in an app's share text. */
function shareLink(text: string) {
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  const url = /https?:\/\/[^\s，。！]+/i.exec(text)?.[0];
  return url && text.length < 500 && /douyin\.com|xhslink\.com|xiaohongshu\.com|b23\.tv|bilibili\.com|kuaishou\.com|weibo\.com/i.test(url) ? url : null;
}

async function addFiles(files: File[], at: XYPosition) {
  const { addAsset, addMediaNode } = useCanvas.getState();
  let i = 0;
  for (const f of files) {
    const kind = mediaKindOf(f.type);
    if (!kind) {
      useUI.getState().notify(`不支持的文件类型：${f.name}`);
      continue;
    }
    const media = await putMedia(f, kind, f.name);
    addAsset(media);
    addMediaNode(media, { x: at.x + i * 40, y: at.y + i * 40 });
    i++;
  }
}

export function Editor() {
  const rf = useReactFlow<CanvasNode>();
  const { nodes, edges, settings, onNodesChange, onEdgesChange, onConnect } = useCanvas(
    useShallow((s) => ({ nodes: s.nodes, edges: s.edges, settings: s.settings, onNodesChange: s.onNodesChange, onEdgesChange: s.onEdgesChange, onConnect: s.onConnect })),
  );
  const setUI = useUI((s) => s.set);
  const directorOpen = useUI((s) => !!s.directorFor);
  const pointer = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const pressMods = useRef({ alt: false, shift: false });

  const tidy = useCallback(async () => {
    const prev = await useCanvas.getState().tidy();
    if (!prev.size) return;
    setUI({ tidyPrev: prev });
    setTimeout(() => rf.fitView({ duration: 400, padding: 0.15 }), 30);
  }, [rf, setUI]);

  const openMenuAt = useCallback(
    (x: number, y: number, from?: string) => setUI({ menu: { x, y, flow: rf.screenToFlowPosition({ x, y }), from }, ctx: null }),
    [rf, setUI],
  );

  // ---- keyboard ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sc = matchShortcut(e);
      if (!sc || (isTyping(e.target) && !sc.allowInInput)) return;
      const s = useCanvas.getState();
      const ui = useUI.getState();
      // While a library window is open, canvas shortcuts stay quiet; Esc closes it.
      if (ui.library || ui.toolbox || ui.studio || ui.search || ui.preview || ui.projects || ui.prefs || ui.sentView || ui.cropFor || ui.depthFor || ui.methodFor || ui.localEngines || ui.hfStudio || ui.tool || ui.allFeatures || ui.breakdownFor || ui.directorFor) {
        if (sc.id === 'escape') {
          ui.set({ library: null, toolbox: false, studio: null, search: false, preview: null, projects: false, prefs: false, sentView: null, cropFor: null, depthFor: null, methodFor: null, localEngines: false, hfStudio: null, tool: null, allFeatures: false, breakdownFor: null, tileMenu: null });
          e.preventDefault();
        }
        return;
      }
      const selected = s.nodes.filter((n) => n.selected).map((n) => n.id);
      const handled = (() => {
        switch (sc.id) {
          case 'new-node':
            return openMenuAt(pointer.current.x, pointer.current.y), true;
          case 'generate':
            return selected.length ? (s.run(selected), true) : false;
          case 'group':
            return s.group(selected), true;
          case 'ungroup':
            return s.ungroup(selected), true;
          case 'connect':
            return s.connectChain(selected), true;
          case 'duplicate':
            return s.duplicate(selected), true;
          case 'copy':
            return selected.length ? (s.copy(selected), true) : false;
          case 'cut':
            return selected.length ? (s.copy(selected), s.deleteNodes(selected), true) : false;
          case 'undo':
            return s.undo(), true;
          case 'redo':
            return s.redo(), true;
          case 'zoom-in':
            return rf.zoomIn({ duration: 200 }), true;
          case 'zoom-out':
            return rf.zoomOut({ duration: 200 }), true;
          case 'fit':
            return rf.fitView({ duration: 300, padding: 0.2 }), true;
          case 'zoom-100':
            return rf.zoomTo(1, { duration: 200 }), true;
          case 'tool-move':
            return s.setSettings({ tool: 'move' }), true;
          case 'tool-hand':
            return s.setSettings({ tool: 'hand' }), true;
          case 'tidy':
            return tidy(), true;
          case 'search':
            return ui.set({ search: true }), true;
          case 'select-all':
            return s.selectAll(), true;
          case 'delete': {
            const edgeSel = s.edges.some((x) => x.selected);
            if (!selected.length && !edgeSel) return false;
            if (selected.length) s.deleteNodes(selected);
            else {
              s.commit();
              useCanvas.setState({ edges: s.edges.filter((x) => !x.selected) });
            }
            return true;
          }
          case 'escape':
            if (ui.menu || ui.ctx || ui.panel || ui.preview) return ui.set({ menu: null, ctx: null, panel: null, preview: null }), true;
            return s.select([]), true;
        }
      })();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rf, openMenuAt, tidy]);

  // ---- app menu (Mac app) and project switches ------------------------------
  useEffect(() => {
    const onMenu = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === 'new-project') newProject();
      if (action === 'open-project') useUI.getState().set({ projects: true });
      if (action === 'reveal-project') revealInFinder(useProject.getState().id ?? undefined);
    };
    window.addEventListener('libcanvas-menu', onMenu);
    return () => window.removeEventListener('libcanvas-menu', onMenu);
  }, []);
  const generation = useProject((s) => s.generation);
  useEffect(() => {
    if (generation) setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }), 80);
  }, [generation, rf]);

  // ---- paste: files, links and text from the clipboard become nodes, otherwise copied nodes --
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const at = rf.screenToFlowPosition(pointer.current);
      const files = [...(e.clipboardData?.files ?? [])];
      const text = e.clipboardData?.getData('text/plain').trim() ?? '';
      e.preventDefault();
      if (files.length) addFiles(files, at);
      // A link downloads what it points to (also the link inside an app's share text); other
      // text becomes a text node.
      else if (shareLink(text)) import('./tools/ToolsUI').then((t) => t.downloadLink(shareLink(text)!, at));
      else if (text) useCanvas.getState().addNode('text', at, { data: { text } });
      else useCanvas.getState().paste(at);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [rf]);

  // ---- connections -------------------------------------------------------
  const isValidConnection: IsValidConnection<Edge> = useCallback(
    (c: Connection | Edge) => {
      if (c.source === c.target) return false;
      const { nodes: ns, edges: es } = useCanvas.getState();
      const src = ns.find((n) => n.id === c.source);
      const tgt = ns.find((n) => n.id === c.target);
      if (!src || !tgt || src.type === 'group' || tgt.type === 'group') return false;
      if (es.some((e) => e.source === c.source && e.target === c.target)) return false;
      if (tgt.type === 'video-clip' && src.type !== 'video') return false;
      return true;
    },
    [],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.fromHandle?.type !== 'source') return;
      const target = event.target as HTMLElement;
      if (!target.closest('.react-flow__pane')) return;
      const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event;
      openMenuAt(clientX, clientY, state.fromNode.id);
    },
    [openMenuAt],
  );

  // ---- drop files / assets ----------------------------------------------
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const asset = e.dataTransfer.getData('application/x-libcanvas-media');
      if (asset) return void useCanvas.getState().addMediaNode(JSON.parse(asset) as MediaRef, at);
      const files = [...e.dataTransfer.files];
      if (files.length) addFiles(files, at);
    },
    [rf],
  );

  // Edges into a running node animate, like a live pipeline.
  const viewEdges = useMemo(() => {
    const running = new Set(nodes.filter((n) => n.data.status === 'running').map((n) => n.id));
    const refs = new Set(nodes.filter((n) => n.type === 'reference').map((n) => n.id));
    return edges.map((e) => {
      const animated = running.has(e.target);
      const dashed = refs.has(e.source) || refs.has(e.target);
      return animated || dashed ? { ...e, animated, className: dashed ? 'edge-ref' : undefined } : e;
    });
  }, [nodes, edges]);

  const hand = settings.tool === 'hand';

  return (
    <div
      className={`app ${settings.showEdges ? '' : 'hide-edges'} ${hand ? 'tool-hand' : ''}`}
      onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      onPointerDownCapture={(e) => (pressMods.current = { alt: e.altKey, shift: e.shiftKey })}
      onMouseDownCapture={(e) => {
        // A double-click on the canvas adds a node; don't let it also select words under the
        // pointer (they'd show highlighted on the new node). Text fields keep word selection.
        if (e.detail > 1 && !isTyping(e.target)) {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onMouseDown={() => {
        const ui = useUI.getState();
        if (ui.menu || ui.ctx) ui.set({ menu: null, ctx: null });
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={viewEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStart={(e, _node, dragged) => {
          useCanvas.getState().commit();
          // The drag-start event can lack modifier flags, so also trust the press that began it.
          const alt = e.altKey || pressMods.current.alt;
          const shift = e.shiftKey || pressMods.current.shift;
          if (alt) useCanvas.getState().cloneInPlace(dragged.map((n) => n.id), shift);
        }}
        onDoubleClick={(e) => {
          // Double-click a link to remove it (undoable). Read from the DOM: React Flow's own
          // edge double-click doesn't fire once the first click has selected the link.
          const edge = (e.target as Element).closest('.react-flow__edge')?.getAttribute('data-id');
          if (edge) return onEdgesChange([{ type: 'remove', id: edge }]);
          if ((e.target as HTMLElement).classList.contains('react-flow__pane')) openMenuAt(e.clientX, e.clientY);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setUI({ ctx: { x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) }, menu: null });
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setUI({ ctx: { x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), nodeId: node.id }, menu: null });
        }}
        snapToGrid={settings.snap}
        snapGrid={[20, 20]}
        panOnDrag={hand ? true : [1]}
        selectionOnDrag={!hand}
        // Box selection picks up every node the box touches, not only ones fully inside it.
        selectionMode={SelectionMode.Partial}
        panOnScroll
        zoomOnScroll={false}
        zoomActivationKeyCode={isMac ? 'Meta' : 'Control'}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={isMac ? 'Meta' : 'Control'}
        minZoom={0.05}
        maxZoom={4}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'default' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#34343a" />
        {settings.minimap && <CanvasMiniMap />}
      </ReactFlow>
      <TopBar />
      <BottomToolbar />
      <ViewControls onTidy={tidy} />
      <EmptyHint />
      <NodeMenu />
      <ContextMenu onTidy={tidy} />
      <AssetsPanel />
      <HistoryPanel />
      <ShortcutsPanel />
      <SearchModal />
      <TidyToast />
      <Toast />
      <Lightbox />
      <ProjectManager />
      <PreferencesPanel />
      <SentViewer />
      <CropModal />
      <BreakdownModal />
      <DepthModal />
      <MethodLibrary />
      <LocalEnginesPanel />
      <HFStudioWindow />
      <ToolDialog />
      <FeatureTour />
      {directorOpen && (
        <Suspense fallback={null}>
          <DirectorEditor />
        </Suspense>
      )}
      <TileMenu />
      <MaterialLibrary />
      <ToolboxPanel />
      <CharacterStudio />
      <input
        id="lc-upload"
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          addFiles(files, useUI.getState().uploadAt ?? rf.screenToFlowPosition(pointer.current));
        }}
      />
    </div>
  );
}
