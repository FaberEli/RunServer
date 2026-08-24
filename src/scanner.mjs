// Scans all registered projects, returning only the installed ones with their status.
// UI never shows "not installed" entries — per project requirement.
import { listProjects } from './registry.mjs';
import { getDefaultManager } from './manager.mjs';

export async function scan() {
  const projects = await listProjects();
  const manager = getDefaultManager();
  const results = await Promise.all(projects.map(async (p) => {
    const detection = await p.detect();
    if (!detection.installed) return null; // not installed → not shown
    const spec = p.service ? await p.service() : null;
    const status = spec ? await manager.status(p.id) : { running: false, backend: manager.constructor.name };
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      homepage: p.homepage,
      version: detection.version,
      note: detection.note,
      canStart: !!spec,
      ui: p.ui || {},
      status,
    };
  }));
  return results.filter(Boolean);
}
