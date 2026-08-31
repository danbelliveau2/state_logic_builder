/**
 * Project API — fetch wrapper for the server's REST endpoints.
 *
 * Endpoints:
 *   GET    /api/projects              → list all projects
 *   GET    /api/projects/:filename    → load a project
 *   POST   /api/projects/:filename    → save/overwrite a project
 *   DELETE /api/projects/:filename    → delete a project
 */

const API_BASE = '/api/projects';

/** Convert a project name to a safe filename. */
export function toFilename(name) {
  const safe = (name || 'project')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return (safe || 'project') + '.json';
}

/** List all projects on the server. Returns [{ filename, name, lastModified, smCount }]. */
export async function listProjects() {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error(`Failed to list projects: ${res.status}`);
  return res.json();
}

/** Load a project file from the server. Returns the parsed project object. */
export async function loadProject(filename) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`Failed to load project: ${res.status}`);
  return res.json();
}

/** Save a project to the server. Creates or overwrites the file. */
export async function saveProject(filename, projectData) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData, null, 2),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save project: ${res.status}`);
  }
  return res.json();
}

/** Delete a project file from the server. */
export async function deleteProjectFile(filename) {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete project: ${res.status}`);
  return res.json();
}

/**
 * Save the project as a JSON file on the user's machine (Ctrl+S in BOTH
 * shells — classic Toolbar and v2 AppV2). Moved here verbatim from
 * l5xExporter.js: save identity is plumbing and must never ride along with
 * codegen code. Electron → native dialog via IPC (path cached for direct
 * overwrite); browser → File System Access API; fallback → <a download>.
 */
export async function exportProjectJSON(project) {
  const json = JSON.stringify(project, null, 2);
  const fileName = `${project.name ?? 'project'}.json`;

  // Electron desktop app: use native dialog via IPC (avoids showSaveFilePicker
  // createWritable() bug where the file is created but written as 0 KB).
  // After the first save we cache the chosen path in localStorage so subsequent
  // saves write directly — no dialog, no "replace?" prompt.
  if (window.electronAPI?.saveFile) {
    const cacheKey = `savePath_${project.id ?? project.name}`;
    const cachedPath = localStorage.getItem(cacheKey);

    if (cachedPath) {
      // Known path — overwrite directly, no dialog
      const result = await window.electronAPI.saveFileDirect(cachedPath, json);
      if (result.success) return;
      // If direct write failed (e.g. file moved), fall through to show dialog again
      localStorage.removeItem(cacheKey);
    }

    // First save or path no longer valid — show dialog once, cache the result
    const result = await window.electronAPI.saveFile(fileName, json);
    if (result.success && result.filePath) {
      localStorage.setItem(cacheKey, result.filePath);
    }
    return;
  }

  // Browser: use File System Access API — remembers last folder between saves.
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled — do nothing
      // Any other error: fall through to legacy download below
    }
  }

  // Fallback for browsers without showSaveFilePicker
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Check if the project API server is available. */
export async function isServerAvailable() {
  try {
    const res = await fetch(API_BASE, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
