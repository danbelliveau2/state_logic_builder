/**
 * engineContext.js — ONE context assembly for EVERY model call in the
 * create-station flow (Dan, 2026-08-28: agents have the knowledge "at their
 * fingertips but don't actually use it" unless the call STRUCTURALLY carries
 * it). A pass built on buildEngineContext cannot forget the knowledge — the
 * block rides the system prompt by construction.
 *
 * Usage: system = [taskText, buildEngineContext(['meKnowledge','precedents',
 * 'concepts:station-archetypes'])].join('\n')
 */

const fs = require('fs');
const path = require('path');

const CONCEPTS_DIR = path.join(__dirname, '..', '..', '..', 'jarvis-knowledge', 'concepts');

function readOr(fn) { try { return fn(); } catch { return ''; } }

const SOURCES = {
  meKnowledge: () => {
    const { loadMeKnowledge } = require('./meKnowledge');
    const t = readOr(loadMeKnowledge);
    return t ? '# Standing SDC knowledge (meKnowledge — laws and learned facts)\n' + t : '';
  },
  precedents: () => {
    const { precedentsBlock } = require('./precedents');
    return readOr(precedentsBlock).trim();
  },
  allConcepts: () => {
    const { loadConcepts } = require('./meKnowledge');
    const t = readOr(loadConcepts);
    return t ? '# SDC concept notes (all)\n' + t : '';
  },
};

/** 'concepts:<file>' loads one jarvis-knowledge/concepts/<file>.md. */
function conceptBlock(name) {
  const t = readOr(() => fs.readFileSync(path.join(CONCEPTS_DIR, `${name}.md`), 'utf8')).trim();
  return t ? `# SDC concept notes — ${name}\n${t}` : '';
}

/**
 * @param {string[]} include  e.g. ['meKnowledge','precedents',
 *   'concepts:station-archetypes','concepts:multi-state-machine']
 * @returns {string} one prompt block ('' only if every source is empty)
 */
function buildEngineContext(include = ['meKnowledge', 'precedents']) {
  const parts = [];
  for (const key of include) {
    if (key.startsWith('concepts:')) parts.push(conceptBlock(key.slice(9)));
    else if (SOURCES[key]) parts.push(SOURCES[key]());
    else parts.push(''); // unknown key: silent skip (never throws a call away)
  }
  const body = parts.filter(Boolean).join('\n\n');
  return body ? '\n\n' + body : '';
}

module.exports = { buildEngineContext };
