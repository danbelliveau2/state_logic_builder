// Tag-balance / well-formedness check for L5X section fragments.
// Strips CDATA and comments, walks tags with a stack, reports unclosed tags (the header is expected to leave
// RSLogix5000Content + Controller open), plus ASCII, Use= and duplicate-name checks.
const fs = require('fs');
const path = require('path');
const dir = 'C:\\SDC-StateLogic\\generated\\1160\\build\\controller';
const files = ['00_header.xml', 'DataTypes.xml', 'Modules.xml', 'AddOnInstructionDefinitions.xml', 'ControllerTags.xml', 'Tasks.xml', 'ParameterConnections.xml'];
let bad = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const raw = fs.readFileSync(p, 'utf8');
  const nonAscii = [...raw].filter((c) => c.charCodeAt(0) > 127).length;
  let s = raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '<!CDATA>').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/, '');
  const stack = [];
  const errs = [];
  // attribute values are quoted and may legally contain '>' (e.g. ActuatorType="&lt;none>")
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"]*")*)\s*(\/?)>/g;
  let m; let count = 0;
  while ((m = re.exec(s))) {
    const [, close, name, attrs, selfClose] = m;
    if (name === '!CDATA') continue;
    count++;
    if (close) {
      const top = stack.pop();
      if (top !== name) { errs.push(`mismatch: </${name}> closes <${top}> near offset ${m.index}`); if (errs.length > 5) break; }
    } else if (!selfClose) {
      stack.push(name);
      // attribute sanity: every attr must be name="value"
      const a = attrs.trim();
      if (a && !/^(\s*[A-Za-z_][\w.:-]*="[^"]*")*\s*$/.test(a.replace(/\n/g, ' '))) errs.push(`odd attributes on <${name}>: ${a.slice(0, 80)}`);
    }
  }
  const useCount = (raw.match(/\bUse="/g) || []).length;
  const tagNames = [...raw.matchAll(/<Tag Name="([^"]+)"/g)].map((x) => x[1]);
  const dupTags = tagNames.filter((n, i) => tagNames.indexOf(n) !== i);
  const modNames = [...raw.matchAll(/<Module Name="([^"]+)"/g)].map((x) => x[1]);
  const dupMods = modNames.filter((n, i) => modNames.indexOf(n) !== i);
  const ok = errs.length === 0 && (f === '00_header.xml' ? stack.join(',') === 'RSLogix5000Content,Controller' : stack.length === 0) && dupTags.length === 0 && dupMods.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f.padEnd(32)} tags=${count} open=[${stack.join(',')}] nonAscii=${nonAscii} Use=${useCount} dupTags=${dupTags.length} dupModules=${dupMods.length}${errs.length ? '\n   ' + errs.join('\n   ') : ''}`);
}
process.exit(bad ? 1 : 0);
