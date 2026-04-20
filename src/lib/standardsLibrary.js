const STORAGE_KEY = 'sdc_standards_library';

export function getStandards() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveStandard({ name, description, category, nodes, edges, devices }) {
  const standards = getStandards();
  standards.push({
    id: crypto.randomUUID(),
    name,
    description: description || '',
    category: category || '',
    savedAt: new Date().toISOString(),
    nodes: JSON.parse(JSON.stringify(nodes ?? [])),
    edges: JSON.parse(JSON.stringify(edges ?? [])),
    devices: JSON.parse(JSON.stringify(devices ?? [])),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(standards));
}

export function deleteStandard(id) {
  const updated = getStandards().filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
