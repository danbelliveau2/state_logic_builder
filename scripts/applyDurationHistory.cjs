#!/usr/bin/env node
'use strict';
/**
 * applyDurationHistory.cjs — bring an L5X to State_Engine_128Max 5.1 (Jason verified it in Studio, 2026-11-13):
 *   StateDuration DINT[128] in StateLogicStatus  ->  CurrentStateDuration DINT
 *   new AOI InOut StateDurationHistory DINT[] (caller-sized, shifted with StateHistoryArray, ms per visit)
 *   every program: StateDurationHistory DINT[10] tag beside StateHistory; AOI call gets it as the 5th argument
 *
 *   node scripts/applyDurationHistory.cjs --in <file.L5X> [--out <file.L5X>] [--check]
 *   --check  report only (exit 1 when the file is still on 5.0)
 *
 *   const { upgrade, isCurrent } = require('./applyDurationHistory.cjs');   // applyStateEngine.cjs chains it
 *
 * Surgical: the AOI keeps its header identity (CreatedBy / EditedBy); only revision, date, note, one parameter,
 * one local tag, localStatus default data and the ST lines change. Works on a controller file, a program export,
 * an AOI export (no programs) or the UDT export (no AOI). Every count is asserted before anything is returned.
 */
const fs = require('fs');

const AOI_RE = /<AddOnInstructionDefinition [^>]*Name="State_Engine_128Max"[^>]*>[\s\S]*?<\/AddOnInstructionDefinition>/;
const UDT_MEMBER_OLD = /<Member Name="StateDuration" DataType="DINT" Dimension="128" Radix="Decimal" Hidden="false" ExternalAccess="Read\/Write">\s*<Description>\s*<!\[CDATA\[[^\]]*\]\]>\s*<\/Description>\s*<\/Member>/;
const STATUS_L5K_TAIL = /\],0,0,\[[0,\s]+\]\]/;          // ...],0,0,[0,0,...0]]  -> ...],0,0,0]
const STATUS_DEC = /<ArrayMember Name="StateDuration" DataType="DINT" Dimensions="128" Radix="Decimal">[\s\S]*?<\/ArrayMember>/;
const CURRENT_DEC = '<DataValueMember Name="CurrentStateDuration" DataType="DINT" Radix="Decimal" Value="0"/>';
const ENGINE_L5K_TAIL = /\],0,0,\[[0,\s]+\]\],0\]/;
const CALL_OLD = 'State_Engine_128Max(StateEngine,Control,Status,StateHistory);';
const CALL_NEW = 'State_Engine_128Max(StateEngine,Control,Status,StateHistory,StateDurationHistory);';
const REV_NOTE_50 = '-5.0 added integrated state history array (variable length) 1/14/23 D.G.';
const REV_NOTE_51 = '-5.1 StateDuration[128] replaced by CurrentStateDuration and a variable-length StateDurationHistory (ms per visit, shifted with the state history) 11/13/26';

const g = (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
const count = (s, re) => (s.match(g(re)) || []).length;

/** true when the file already carries 5.1 (AOI with the new parameter, or a UDT with CurrentStateDuration) */
function isCurrent(xml) {
  const aoi = (xml.match(AOI_RE) || [])[0];
  if (aoi) return /Name="StateDurationHistory"/.test(aoi);
  return /<Member Name="CurrentStateDuration"/.test(xml);
}

/** Upgrade one L5X string. Returns { xml, report } or throws with the failed assertion. */
function upgrade(src) {
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const L = (lines) => lines.join(EOL);
  const fail = (m) => { throw new Error('applyDurationHistory: ' + m); };
  const rep1 = (s, from, to, what) => {
    const n = typeof from === 'string' ? s.split(from).length - 1 : count(s, from);
    if (n !== 1) fail(`${what}: expected 1 match, got ${n}`);
    return s.replace(from, to);
  };
  let x = src;
  const report = { aoi: 'absent', udt: 'absent', statusTags: 0, engineTags: 0, historyTags: 0, calls: 0 };

  // ── 1. AOI definition ──────────────────────────────────────────────────────
  const aoi0 = (src.match(AOI_RE) || [])[0];
  if (aoi0) {
    if (/Name="StateDurationHistory"/.test(aoi0)) fail('AOI already carries StateDurationHistory');
    let aoi = aoi0;
    aoi = rep1(aoi, 'Revision="5.0"', 'Revision="5.1"', 'AOI revision');
    aoi = rep1(aoi, /EditedDate="[^"]*"/, `EditedDate="${new Date().toISOString()}"`, 'AOI EditedDate');
    aoi = rep1(aoi, REV_NOTE_50, REV_NOTE_50 + EOL + REV_NOTE_51, 'AOI revision note');
    aoi = rep1(aoi, '</Parameters>', L([
      '<Parameter Name="StateDurationHistory" TagType="Base" DataType="DINT" Dimensions="1" Usage="InOut" Radix="Decimal" Required="true" Visible="true" Constant="false">',
      '<Description>',
      '<![CDATA[State duration history (ms)]]>',
      '</Description>',
      '</Parameter>',
      '</Parameters>']), 'AOI parameters');
    aoi = rep1(aoi, '</LocalTags>', L([
      '<LocalTag Name="DurationArraySize" DataType="SINT" Radix="Decimal" ExternalAccess="None">',
      '<Description>',
      '<![CDATA[Size of state duration history array]]>',
      '</Description>',
      '<DefaultData Format="L5K">',
      '<![CDATA[0]]>',
      '</DefaultData>',
      '<DefaultData Format="Decorated">',
      '<DataValue DataType="SINT" Radix="Decimal" Value="0"/>',
      '</DefaultData>',
      '</LocalTag>',
      '</LocalTags>']), 'AOI local tags');
    aoi = rep1(aoi, STATUS_L5K_TAIL, '],0,0,0]', 'localStatus L5K');
    aoi = rep1(aoi, STATUS_DEC, CURRENT_DEC, 'localStatus decorated');

    // ST routine: edit the line list, renumber
    const ST_RE = /<STContent>([\s\S]*?)<\/STContent>/;
    const stm = aoi.match(ST_RE);
    if (!stm) fail('AOI has no STContent');
    const LINE_RE = /<Line Number="\d+">\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Line>/g;
    const lines = [...stm[1].matchAll(LINE_RE)].map((m) => m[1]);
    if (lines.length < 50) fail('ST: fewer lines than expected: ' + lines.length);
    const idx = (needle) => { const i = lines.findIndex((l) => l.trim() === needle.trim()); if (i < 0) fail('ST line not found: ' + needle); return i; };
    let i;
    i = idx('SIZE(StateHistoryArray,0,HistoryArraySize);');
    lines.splice(i + 1, 0, 'SIZE(StateDurationHistory,0,DurationArraySize);');
    i = idx('\tlocalStatus.StateDuration[StateLogicControl.StateReg]:=StateDurationTimer.ACC;');
    lines[i] = '\tlocalStatus.CurrentStateDuration := StateDurationTimer.ACC;';
    i = idx('\tStateHistoryArray[0] := StateReg_Prev;');
    lines.splice(i + 1, 0,
      '',
      '\t//Shift state duration history the same way; index i of both arrays is the same visit',
      '\tif DurationArraySize > 1 then',
      '\t\tfor i := DurationArraySize-1 to 1 by -1 do',
      '\t\t\tStateDurationHistory[i] := StateDurationHistory[i-1];',
      '\t\tend_for;',
      '\tend_if;',
      '\tStateDurationHistory[0] := StateDurationTimer.ACC;',
      '\tlocalStatus.CurrentStateDuration := 0;');
    const stXml = EOL + lines.map((l, n) => `<Line Number="${n}">${EOL}<![CDATA[${l}]]>${EOL}</Line>`).join(EOL) + EOL;
    aoi = aoi.replace(ST_RE, `<STContent>${stXml}</STContent>`);
    if (/StateDuration\[StateLogicControl/.test(aoi)) fail('ST still writes StateDuration[]');
    x = x.replace(AOI_RE, () => aoi);
    report.aoi = '5.0 -> 5.1';
    // an AOI export names the revision in its file header too
    x = x.replace(/TargetType="AddOnInstructionDefinition" TargetClass="Standard" TargetRevision="5\.0 ?"/, 'TargetType="AddOnInstructionDefinition" TargetClass="Standard" TargetRevision="5.1 "');
  }

  // ── 2. UDT ─────────────────────────────────────────────────────────────────
  if (UDT_MEMBER_OLD.test(x)) {
    x = rep1(x, UDT_MEMBER_OLD, L([
      '<Member Name="CurrentStateDuration" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">',
      '<Description>',
      '<![CDATA[Time In Current State (ms)]]>',
      '</Description>',
      '</Member>']), 'UDT member');
    report.udt = 'replaced';
  } else if (/<Member Name="CurrentStateDuration"/.test(x)) report.udt = 'current';
  // ── 3. every StateLogicStatus tag ──────────────────────────────────────────
  x = x.replace(/<Tag Name="[^"]+" TagType="Base" DataType="StateLogicStatus"[^>]*>[\s\S]*?<\/Tag>/g, (tag) => {
    if (count(tag, STATUS_L5K_TAIL) !== 1) fail('Status tag L5K: expected 1 array tail in ' + tag.split('\n')[0]);
    if (count(tag, STATUS_DEC) !== 1) fail('Status tag decorated: expected 1 StateDuration ArrayMember in ' + tag.split('\n')[0]);
    report.statusTags++;
    return tag.replace(STATUS_L5K_TAIL, '],0,0,0]').replace(STATUS_DEC, CURRENT_DEC);
  });

  // ── 4. every State_Engine_128Max instance tag (localStatus + HistoryArraySize [+ DurationArraySize]) ──
  x = x.replace(/<Tag Name="[^"]+" TagType="Base" DataType="State_Engine_128Max"[^>]*>[\s\S]*?<\/Tag>/g, (tag) => {
    if (count(tag, ENGINE_L5K_TAIL) !== 1) fail('StateEngine tag L5K: expected 1 localStatus array tail in ' + tag.split('\n')[0]);
    report.engineTags++;
    return tag.replace(ENGINE_L5K_TAIL, '],0,0,0],0,0]');
  });

  // ── 5. StateDurationHistory tag after every StateHistory tag ───────────────
  x = x.replace(/<Tag Name="StateHistory" TagType="Base" DataType="SINT" Dimensions="10"[^>]*>[\s\S]*?<\/Tag>/g, (tag) => {
    report.historyTags++;
    const dur = tag
      .replace('<Tag Name="StateHistory" TagType="Base" DataType="SINT"', '<Tag Name="StateDurationHistory" TagType="Base" DataType="DINT"')
      .replace('<Array DataType="SINT"', '<Array DataType="DINT"');
    return tag + EOL + dur;
  });

  // ── 6. AOI call rungs ──────────────────────────────────────────────────────
  report.calls = x.split(CALL_OLD).length - 1;
  x = x.split(CALL_OLD).join(CALL_NEW);

  // ── 7. assert ──────────────────────────────────────────────────────────────
  const { statusTags, engineTags, historyTags, calls } = report;
  if (!(statusTags === engineTags && engineTags === historyTags && historyTags === calls)) fail(`counts differ: Status ${statusTags}, StateEngine ${engineTags}, StateHistory ${historyTags}, AOI calls ${calls}`);
  if (/<Programs/.test(x) && statusTags === 0) fail('file has programs but no StateLogicStatus tag was rewritten');
  if (!aoi0 && report.udt === 'absent' && statusTags === 0) fail('nothing to upgrade: no State_Engine_128Max AOI, StateLogicStatus UDT or Status tag in this file');
  const stale = count(x, /Name="StateDuration"|StateDuration\[StateLogicControl/);
  if (stale) fail('stale StateDuration references left: ' + stale);
  if (count(x, /<Tag Name="StateDurationHistory" /) !== historyTags) fail('StateDurationHistory tag count');
  if (count(x, /State_Engine_128Max\(StateEngine,Control,Status,StateHistory\)/)) fail('4-arg AOI call left');
  return { xml: x, report };
}

module.exports = { upgrade, isCurrent, AOI_RE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const IN = argOf('in', '');
  const OUT = argOf('out', IN);
  const CHECK = argv.includes('--check');
  if (!IN) { console.error('usage: node scripts/applyDurationHistory.cjs --in <file.L5X> [--out <file.L5X>] [--check]'); process.exit(2); }
  const src = fs.readFileSync(IN, 'utf8');
  const cur = isCurrent(src);
  if (CHECK) { console.log(cur ? 'current (5.1)' : 'behind (5.0): StateDuration[128]'); process.exit(cur ? 0 : 1); }
  if (cur) { console.log('already current (5.1), nothing written'); process.exit(0); }
  let r;
  try { r = upgrade(src); } catch (e) { console.error('FAIL ' + e.message); process.exit(1); }
  fs.writeFileSync(OUT, r.xml);
  const p = r.report;
  console.log(`${OUT}\n  AOI ${p.aoi}; UDT ${p.udt}; ${p.statusTags} Status tags, ${p.engineTags} StateEngine tags, ${p.historyTags} StateDurationHistory tags added, ${p.calls} AOI calls widened`);
  console.log(`  size ${(src.length / 1024).toFixed(0)} KB -> ${(r.xml.length / 1024).toFixed(0)} KB`);
}
