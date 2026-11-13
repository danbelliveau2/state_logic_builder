#!/usr/bin/env node
'use strict';
/**
 * applyDurationHistory.cjs — bring an L5X to State_Engine_128Max 5.1:
 *   StateDuration DINT[128] in StateLogicStatus  ->  CurrentStateDuration DINT
 *   new AOI InOut StateDurationHistory DINT[] (caller-sized, shifted with StateHistoryArray, ms per visit)
 *   every program: StateDurationHistory DINT[10] tag beside StateHistory; AOI call gets it as the 5th argument
 *
 *   node scripts/applyDurationHistory.cjs --in <file.L5X> [--out <file.L5X>] [--check]
 *   --check  report only (exit 1 when the file is still on 5.0)
 *
 * Surgical: the AOI keeps its header identity (CreatedBy / EditedBy); only revision, date, note, one parameter,
 * one local tag, localStatus default data and the ST lines change. Every count is asserted before writing.
 */
const fs = require('fs');

const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const IN = argOf('in', '');
const OUT = argOf('out', IN);
const CHECK = argv.includes('--check');
if (!IN) { console.error('usage: node scripts/applyDurationHistory.cjs --in <file.L5X> [--out <file.L5X>] [--check]'); process.exit(2); }

const src = fs.readFileSync(IN, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const fail = (m) => { console.error('FAIL ' + m); process.exit(1); };
const count = (s, re) => (s.match(re) || []).length;

const AOI_RE = /<AddOnInstructionDefinition [^>]*Name="State_Engine_128Max"[^>]*>[\s\S]*?<\/AddOnInstructionDefinition>/;
const aoi0 = (src.match(AOI_RE) || [])[0];
if (!aoi0) fail('no State_Engine_128Max AOI in ' + IN);
const already = /Name="StateDurationHistory"/.test(aoi0);
if (CHECK) { console.log(already ? 'current (5.1)' : 'behind (5.0): StateDuration[128]'); process.exit(already ? 0 : 1); }
if (already) fail('AOI already carries StateDurationHistory');

let x = src;
const L = (lines) => lines.join(EOL);

// ── 1. AOI definition ────────────────────────────────────────────────────────
let aoi = aoi0;
const rep1 = (s, from, to, what) => {
  const n = typeof from === 'string' ? s.split(from).length - 1 : count(s, new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g'));
  if (n !== 1) fail(`${what}: expected 1 match, got ${n}`);
  return s.replace(from, to);
};
aoi = rep1(aoi, 'Revision="5.0"', 'Revision="5.1"', 'AOI revision');
aoi = rep1(aoi, /EditedDate="[^"]*"/, `EditedDate="${new Date().toISOString()}"`, 'AOI EditedDate');
aoi = rep1(aoi, '-5.0 added integrated state history array (variable length) 1/14/23 D.G.',
  '-5.0 added integrated state history array (variable length) 1/14/23 D.G.' + EOL
  + '-5.1 StateDuration[128] replaced by CurrentStateDuration and a variable-length StateDurationHistory (ms per visit, shifted with the state history) 11/13/26',
  'AOI revision note');
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

// StateLogicStatus default data (localStatus local tag): L5K tail and decorated member
const STATUS_L5K_TAIL = /\],0,0,\[[0,\s]+\]\]/g;          // ...],0,0,[0,0,...0]]  -> ...],0,0,0]
const STATUS_DEC = /<ArrayMember Name="StateDuration" DataType="DINT" Dimensions="128" Radix="Decimal">[\s\S]*?<\/ArrayMember>/g;
const CURRENT_DEC = '<DataValueMember Name="CurrentStateDuration" DataType="DINT" Radix="Decimal" Value="0"/>';
if (count(aoi, STATUS_L5K_TAIL) !== 1) fail('localStatus L5K: expected 1 StateDuration array');
aoi = aoi.replace(STATUS_L5K_TAIL, '],0,0,0]');
if (count(aoi, STATUS_DEC) !== 1) fail('localStatus decorated: expected 1 StateDuration ArrayMember');
aoi = aoi.replace(STATUS_DEC, CURRENT_DEC);

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
x = x.replace(AOI_RE, aoi);

// ── 2. UDT ───────────────────────────────────────────────────────────────────
const UDT_MEMBER = /<Member Name="StateDuration" DataType="DINT" Dimension="128" Radix="Decimal" Hidden="false" ExternalAccess="Read\/Write">\s*<Description>\s*<!\[CDATA\[[^\]]*\]\]>\s*<\/Description>\s*<\/Member>/;
if (count(x, new RegExp(UDT_MEMBER.source, 'g')) !== 1) fail('UDT: expected 1 StateDuration member');
x = x.replace(UDT_MEMBER, L([
  '<Member Name="CurrentStateDuration" DataType="DINT" Dimension="0" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write">',
  '<Description>',
  '<![CDATA[Time In Current State (ms)]]>',
  '</Description>',
  '</Member>']));

// ── 3. every StateLogicStatus tag ────────────────────────────────────────────
const STATUS_TAG_RE = /<Tag Name="[^"]+" TagType="Base" DataType="StateLogicStatus"[^>]*>[\s\S]*?<\/Tag>/g;
let nStatus = 0;
x = x.replace(STATUS_TAG_RE, (tag) => {
  nStatus++;
  if (count(tag, STATUS_L5K_TAIL) !== 1) fail('Status tag L5K: expected 1 array tail');
  if (count(tag, STATUS_DEC) !== 1) fail('Status tag decorated: expected 1 StateDuration ArrayMember');
  return tag.replace(STATUS_L5K_TAIL, '],0,0,0]').replace(STATUS_DEC, CURRENT_DEC);
});

// ── 4. every State_Engine_128Max instance tag (localStatus + HistoryArraySize [+ DurationArraySize]) ──
const ENGINE_TAG_RE = /<Tag Name="[^"]+" TagType="Base" DataType="State_Engine_128Max"[^>]*>[\s\S]*?<\/Tag>/g;
const ENGINE_L5K_TAIL = /\],0,0,\[[0,\s]+\]\],0\]/;
let nEngine = 0;
x = x.replace(ENGINE_TAG_RE, (tag) => {
  nEngine++;
  if (count(tag, new RegExp(ENGINE_L5K_TAIL.source, 'g')) !== 1) fail('StateEngine tag L5K: expected 1 localStatus array tail');
  return tag.replace(ENGINE_L5K_TAIL, '],0,0,0],0,0]');
});

// ── 5. StateDurationHistory tag after every StateHistory tag ─────────────────
const HIST_TAG_RE = /<Tag Name="StateHistory" TagType="Base" DataType="SINT" Dimensions="10"[^>]*>[\s\S]*?<\/Tag>/g;
let nHist = 0;
x = x.replace(HIST_TAG_RE, (tag) => {
  nHist++;
  const dur = tag
    .replace('<Tag Name="StateHistory" TagType="Base" DataType="SINT"', '<Tag Name="StateDurationHistory" TagType="Base" DataType="DINT"')
    .replace('<Array DataType="SINT"', '<Array DataType="DINT"')
    .replace(/<Element Index="(\[\d+\])" Value="0"\/>/g, '<Element Index="$1" Value="0"/>');
  return tag + EOL + dur;
});

// ── 6. AOI call rungs ────────────────────────────────────────────────────────
const CALL_OLD = 'State_Engine_128Max(StateEngine,Control,Status,StateHistory);';
const CALL_NEW = 'State_Engine_128Max(StateEngine,Control,Status,StateHistory,StateDurationHistory);';
const nCalls = x.split(CALL_OLD).length - 1;
x = x.split(CALL_OLD).join(CALL_NEW);

// ── 7. assert ────────────────────────────────────────────────────────────────
if (!(nStatus && nStatus === nEngine && nEngine === nHist && nHist === nCalls)) fail(`counts differ: Status ${nStatus}, StateEngine ${nEngine}, StateHistory ${nHist}, AOI calls ${nCalls}`);
const stale = count(x, /Name="StateDuration"|StateDuration\[StateLogicControl|Dimension="128" Radix="Decimal" Hidden="false" ExternalAccess="Read\/Write">\s*<Description>\s*<!\[CDATA\[Duration/g);
if (stale) fail('stale StateDuration references left: ' + stale);
if (count(x, /<Tag Name="StateDurationHistory" /g) !== nHist) fail('StateDurationHistory tag count');
if (count(x, /State_Engine_128Max\(StateEngine,Control,Status,StateHistory\)/g)) fail('4-arg AOI call left');

fs.writeFileSync(OUT, x);
console.log(`${OUT}${EOL}  AOI 5.0 -> 5.1; UDT member replaced; ${nStatus} Status tags, ${nEngine} StateEngine tags, ${nHist} StateDurationHistory tags added, ${nCalls} AOI calls widened`);
console.log(`  size ${(src.length / 1024).toFixed(0)} KB -> ${(x.length / 1024).toFixed(0)} KB`);
