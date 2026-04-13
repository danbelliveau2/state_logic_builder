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

/** Check if the project API server is available. */
export async function isServerAvailable() {
  try {
    const res = await fetch(API_BASE, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
