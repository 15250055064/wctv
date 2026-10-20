import { create } from 'zustand';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  /** Archive id of an image used as the project's cover. */
  cover?: string;
}

interface ProjectState {
  /** Current project = its folder name under the archive. Null until loaded or without the local server. */
  id: string | null;
  list: ProjectSummary[];
  /** Bumped every time a project is (re)loaded, so the canvas can refit its view. */
  generation: number;
}

export const useProject = create<ProjectState>()(() => ({ id: null, list: [], generation: 0 }));

export const currentProjectId = () => useProject.getState().id;
