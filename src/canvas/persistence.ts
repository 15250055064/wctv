import { useLibrary } from './library';
import { useProject, type ProjectSummary } from './project';
import { useCanvas } from './store';
import { useUI } from './ui';

// Each project is a folder in ~/Movies/LibCanvas holding project.libcanvas.json and its media.
// The library (characters, toolbox, favorites) is shared by all projects. localStorage stays as
// a cache for when the local server isn't running.

const canvasSnapshot = () => {
  const { name, nodes, edges, assets, history, settings } = useCanvas.getState();
  return { name, nodes, edges, assets, history, settings };
};
const librarySnapshot = () => {
  const { roles, toolbox, favorites, recent, preferences, motions } = useLibrary.getState();
  return { roles, toolbox, favorites, recent, preferences, motions };
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `请求失败（${res.status}）`);
  return body as T;
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- saving ------------------------------------------------------------------

let canvasTimer: ReturnType<typeof setTimeout> | undefined;
let pendingProject: string | null = null;
/** While a project loads, store updates come from the file, not the user: don't save them back. */
let loading = false;

async function saveCanvasNow(id: string) {
  try {
    await api(`/api/projects/${encodeURIComponent(id)}`, jsonInit('PUT', { canvas: canvasSnapshot() }));
    if (useProject.getState().id === id) useCanvas.setState({ saveStatus: 'saved' });
  } catch {
    useCanvas.setState({ saveStatus: 'failed' });
  }
}

function scheduleCanvasSave() {
  const id = useProject.getState().id;
  if (!id || loading) return;
  pendingProject = id;
  clearTimeout(canvasTimer);
  canvasTimer = setTimeout(() => {
    pendingProject = null;
    saveCanvasNow(id);
  }, 800);
}

/** Write any pending change of the current project before leaving it. */
async function flush() {
  clearTimeout(canvasTimer);
  if (pendingProject) {
    const id = pendingProject;
    pendingProject = null;
    await saveCanvasNow(id);
  }
}

let libraryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLibrarySave() {
  if (loading) return;
  clearTimeout(libraryTimer);
  libraryTimer = setTimeout(() => api('/api/library', jsonInit('PUT', librarySnapshot())).catch(() => {}), 800);
}

// ---- projects ----------------------------------------------------------------

export async function refreshProjects(): Promise<ProjectSummary[]> {
  const { projects } = await api<{ projects: ProjectSummary[] }>('/api/projects');
  useProject.setState({ list: projects });
  return projects;
}

export async function openProject(id: string) {
  await flush();
  const data = await api<{ canvas?: Record<string, unknown> & { nodes?: { data: { status?: string } }[] } }>(`/api/projects/${encodeURIComponent(id)}`);
  const canvas = data.canvas ?? {};
  // A generation interrupted by closing the app can never finish.
  const nodes = (canvas.nodes ?? []).map((n) => (n.data.status === 'running' ? { ...n, data: { ...n.data, status: 'idle', progress: 0 } } : n));
  loading = true;
  try {
    useCanvas.setState({
      name: id,
      nodes: nodes as never,
      edges: (canvas.edges as never) ?? [],
      assets: (canvas.assets as never) ?? [],
      history: (canvas.history as never) ?? [],
      ...(canvas.settings
        ? {
            settings: {
              ...useCanvas.getState().settings,
              ...(canvas.settings as object),
              // Projects saved before the minimap was on by default get it switched on once.
              ...((canvas.settings as { mapDefaulted?: boolean }).mapDefaulted ? {} : { minimap: true, mapDefaulted: true }),
            },
          }
        : {}),
      past: [],
      future: [],
      saveStatus: 'saved',
    });
    useProject.setState((s) => ({ id, generation: s.generation + 1 }));
  } finally {
    loading = false;
  }
  refreshProjects().catch(() => {});
}

export async function newProject(name = '未命名项目') {
  await flush();
  const { id } = await api<{ id: string }>('/api/projects', jsonInit('POST', { name }));
  await openProject(id);
  useUI.getState().notify(`已新建项目「${id}」`);
  return id;
}

/** Renames the project folder; the server rewrites media paths, so reload from disk afterwards. */
export async function renameCurrentProject(name: string) {
  const id = useProject.getState().id;
  const target = name.trim();
  if (!id || !target || target === id) {
    useCanvas.setState({ name: id ?? useCanvas.getState().name });
    return;
  }
  await flush();
  try {
    const { id: next } = await api<{ id: string }>(`/api/projects/${encodeURIComponent(id)}/rename`, jsonInit('POST', { name: target }));
    loading = true;
    try {
      useLibrary.setState(await api('/api/library'));
    } finally {
      loading = false;
    }
    await openProject(next);
    useUI.getState().notify(`项目已重命名为「${next}」`);
  } catch (err) {
    useCanvas.setState({ name: id });
    useUI.getState().notify(`重命名失败：${err instanceof Error ? err.message : err}`);
  }
}

// ---- boot ----------------------------------------------------------------------

export async function initServerSync() {
  let app: { lastProject: string | null };
  try {
    app = await api('/api/app');
  } catch {
    return; // no local server: keep the browser-only copy
  }
  loading = true;
  try {
    const lib = await api<Record<string, unknown>>('/api/library').catch(() => ({}));
    if (Object.keys(lib).length) useLibrary.setState(lib);
  } finally {
    loading = false;
  }
  const projects = await refreshProjects();
  const id = app.lastProject ?? projects[0]?.id ?? (await api<{ id: string }>('/api/projects', jsonInit('POST', { name: '我的项目' }))).id;
  await openProject(id);

  useCanvas.subscribe((s, p) => {
    if (s.nodes !== p.nodes || s.edges !== p.edges || s.assets !== p.assets || s.history !== p.history || s.settings !== p.settings) scheduleCanvasSave();
  });
  useLibrary.subscribe(scheduleLibrarySave);
  // The Mac app calls this before closing its window so the last edits reach the disk.
  Object.assign(window, { __libcanvasFlush: flush });
}

export interface EngineStatus {
  chatgpt: { available: boolean; loggedIn: boolean };
  claude: { available: boolean; loggedIn: boolean };
  archive: string;
}

export async function fetchEngines(): Promise<EngineStatus | null> {
  try {
    const res = await fetch('/api/engines');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
