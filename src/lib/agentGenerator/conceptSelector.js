/**
 * conceptSelector.js — RELEVANCE-LOADED KNOWLEDGE (Dan, 2026-09-01: "the
 * skills model, our way"). A turn or build loads ONLY the concept modules it
 * actually touches: servo mentioned → servo-motion; pneumatic devices →
 * pneumatics; robot → robot-programming; a dial machine active → the
 * indexing/archetype patterns. Selection = device types on the active
 * machine/sheet + terms in the message. Keeps reflex prompts small AND
 * focused; the librarian keeps growing the modules per family.
 *
 * CORE modules always ride (they are the grammar, not a family):
 * general, naming-and-structure, station-archetypes.
 */

const fs = require('fs');
const path = require('path');

const CONCEPTS_DIR = path.join(__dirname, '..', '..', '..', 'jarvis-knowledge', 'concepts');

const CORE = ['general', 'naming-and-structure', 'station-archetypes'];

// module → the device-type / term triggers that load it.
const TRIGGERS = {
  'servo-motion': /servo|axis|mam|indexer|dial/i,
  'motion-model-pnp': /pick.?and.?place|pnp|servo.*(pick|place)|transition point/i,
  'pneumatics': /pneumatic|cylinder|slide|shuttle|gripper|vacuum|valve|air|escapement|finger/i,
  'robot-programming': /robot/i,
  'vision-systems': /vision|camera|inspect/i,
  'alarms': /alarm|fault|warning|timeout|recovery|starv/i,
  'coordination': /signal|handshake|partner|wait for|coordinat|between machines/i,
  'multi-state-machine': /split|machines|program per|two machines|second machine/i,
  'production-and-operator': /production|operator|shift|count|hmi|reject|cycle time/i,
  'recipe-handler': /recipe/i,
  'modbus-tcp-client': /modbus/i,
  'how-jason-writes-code': /rung|routine|l5x|codegen|generate|studio/i,
};

// Device TYPE → modules (independent of wording).
const TYPE_MODULES = [
  [/servo|axis_cip/i, ['servo-motion']],
  [/pneumatic|gripper|vac/i, ['pneumatics']],
  [/robot/i, ['robot-programming']],
  [/vision/i, ['vision-systems']],
  [/sensor/i, []],
];

/**
 * @param {object} opts { deviceTypes?: string[], text?: string, machineNames?: string[] }
 * @returns {string[]} module names (existing files only), core first.
 */
function selectConceptModules({ deviceTypes = [], text = '', machineNames = [] } = {}) {
  const picked = new Set(CORE);
  const hay = `${text} ${machineNames.join(' ')}`;
  for (const [mod, re] of Object.entries(TRIGGERS)) {
    if (re.test(hay)) picked.add(mod);
  }
  for (const t of deviceTypes) {
    for (const [re, mods] of TYPE_MODULES) {
      if (re.test(String(t))) mods.forEach((m) => picked.add(m));
    }
  }
  // Only modules that actually exist ride.
  return [...picked].filter((m) => {
    try { return fs.existsSync(path.join(CONCEPTS_DIR, `${m}.md`)); } catch { return false; }
  });
}

/** The selected modules' text, joined — for prompt injection. */
function loadSelectedConcepts(opts) {
  const mods = selectConceptModules(opts);
  const parts = [];
  for (const m of mods) {
    try {
      const body = fs.readFileSync(path.join(CONCEPTS_DIR, `${m}.md`), 'utf8').trim();
      if (body) parts.push(body);
    } catch { /* skip */ }
  }
  return { modules: mods, text: parts.join('\n\n---\n\n') };
}

/** THE SKILLS INVENTORY (Dan, 2026-09-01: "say what skills you have, what
 *  information goes into them, and we decide if you should have more or
 *  less"). One row per module: name, scope line, size, updated, triggers,
 *  attributions — the window into relevance loading. */
function skillsInventory() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(CONCEPTS_DIR).filter((f) => f.endsWith('.md') && !/^readme/i.test(f)); } catch { return out; }
  for (const f of files) {
    const mod = f.replace(/\.md$/, '');
    let body = ''; let st = null;
    try { body = fs.readFileSync(path.join(CONCEPTS_DIR, f), 'utf8'); st = fs.statSync(path.join(CONCEPTS_DIR, f)); } catch { continue; }
    const lines = body.split('\n');
    const title = (lines.find((l) => /^#\s/.test(l)) ?? mod).replace(/^#\s*/, '').trim();
    const scope = (lines.find((l) => l.trim() && !/^#/.test(l)) ?? '').trim().slice(0, 220);
    // Attributions: "(Name, date)" markers in headings — simple + honest.
    const who = [...new Set(
      [...body.matchAll(/\((Dan|Jason(?: Perry)?|CE leads?)[,)\s]/g)].map((m) => m[1])
    )].slice(0, 6);
    out.push({
      module: mod,
      title,
      scope,
      sections: (body.match(/^##\s/gm) ?? []).length,
      bytes: body.length,
      updatedAt: st ? st.mtime.toISOString() : null,
      core: CORE.includes(mod),
      triggers: TRIGGERS[mod] ? String(TRIGGERS[mod]).replace(/^\/|\/i$/g, '').split('|').slice(0, 12) : (CORE.includes(mod) ? ['(always loaded — core grammar)'] : ['(no trigger yet — loads only when core)']),
      attributions: who,
    });
  }
  out.sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0) || a.module.localeCompare(b.module));
  return out;
}

module.exports = { selectConceptModules, loadSelectedConcepts, skillsInventory, TRIGGERS, CORE };
