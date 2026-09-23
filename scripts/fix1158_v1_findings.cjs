#!/usr/bin/env node
'use strict';
// One-shot mechanical fixes for the v0.1 validator findings on job 1158's five new/changed programs.
const fs = require('fs');
const path = require('path');
const DIR = 'X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build\\programs';
const BASELINE = 'X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build\\1158_baseline_from_Matt.L5X';
const TEMPLATE = 'X:\\Electrical Dept\\SDC Engineer\\Templates\\SoftwareStandardizationNew.L5X';

function stripL5K(xml, tagNames) {
  let n = 0;
  for (const name of tagNames) {
    // find each <Tag Name="X" ...>...</Tag> (non self-closing) and remove its <Data Format="L5K">...</Data> child
    const re = new RegExp(`<Tag Name="${name}"[^>]*>[\\s\\S]*?<\\/Tag>`, 'g');
    xml = xml.replace(re, (block) => {
      const stripped = block.replace(/<Data Format="L5K">[\s\S]*?<\/Data>\s*/, '');
      if (stripped !== block) n++;
      return stripped;
    });
  }
  return { xml, n };
}

// 1) D01_FlexFeeder: strip broken L5K on Alarm/AlarmList/ServoAlarm/ServoAlarmList/ProcessConveyorFault;
//    fix AOI_FanucRecipe (add definition later, controller-level); no other tag issues here.
{
  const f = path.join(DIR, 'D01_FlexFeeder.xml');
  let xml = fs.readFileSync(f, 'utf8');
  const r = stripL5K(xml, ['Alarm', 'AlarmList', 'ServoAlarm', 'ServoAlarmList', 'ProcessConveyorFault']);
  fs.writeFileSync(f, r.xml);
  console.log('D01_FlexFeeder: stripped L5K on', r.n, 'tag blocks');
}

// 2) D02S13_MetalLoad: strip broken L5K on Alarm/AlarmList/ServoAlarm/ServoAlarmList; fix g_StationList -> g_D2StationList; fix g_HMI_DryRun (drop the OR term, keep the per-station DryRun read).
{
  const f = path.join(DIR, 'D02S13_MetalLoad.xml');
  let xml = fs.readFileSync(f, 'utf8');
  const r = stripL5K(xml, ['Alarm', 'AlarmList', 'ServoAlarm', 'ServoAlarmList']);
  xml = r.xml;
  const before = xml;
  xml = xml.split('g_StationList[StaNum]').join('g_D2StationList[StaNum]');
  const renamed = (before.match(/g_StationList\[StaNum\]/g) || []).length;
  xml = xml.replace(
    '[XIC(\\D02_Tracking.p_Data.Station[StaNum].OpStatus.DryRun) ,XIC(g_HMI_DryRun) ]OTE(DryRun);',
    'XIC(\\D02_Tracking.p_Data.Station[StaNum].OpStatus.DryRun)OTE(DryRun);'
  );
  fs.writeFileSync(f, xml);
  console.log('D02S13_MetalLoad: stripped L5K on', r.n, 'tag blocks; renamed', renamed, 'g_StationList refs; dropped g_HMI_DryRun OR-term');
}

// 3) D02S01_PlasticLoad: strip broken L5K on ServoAlarm/ServoAlarmList (Alarm/AlarmList already bare); strip the invented Decorated block on EscapementRingAxisTorqueHome (declare bare, per the AOI-backing-tag ruling).
{
  const f = path.join(DIR, 'D02S01_PlasticLoad.xml');
  let xml = fs.readFileSync(f, 'utf8');
  const r = stripL5K(xml, ['ServoAlarm', 'ServoAlarmList']);
  xml = r.xml;
  const before = xml;
  xml = xml.replace(/<Tag Name="EscapementRingAxisTorqueHome"[^>]*>[\s\S]*?<\/Tag>/,
    (block) => {
      const attrs = block.match(/<Tag Name="EscapementRingAxisTorqueHome"[^>]*>/)[0].replace(/>$/, '/>');
      return attrs;
    });
  const bareD = xml !== before;
  fs.writeFileSync(f, xml);
  console.log('D02S01_PlasticLoad: stripped L5K on', r.n, 'tag blocks; EscapementRingAxisTorqueHome declared bare:', bareD);
}

// 4) Baseline file: rename every cross-reference \D01S11_SleevePress_IP -> \D01S11_SleevePress (the program itself is being renamed on splice; every OTHER program and the ParameterConnection/Task-schedule that points at the old name must follow).
{
  let xml = fs.readFileSync(BASELINE, 'utf8');
  const before = xml;
  xml = xml.split('D01S11_SleevePress_IP').join('D01S11_SleevePress');
  const count = (before.match(/D01S11_SleevePress_IP/g) || []).length;
  fs.writeFileSync(BASELINE, xml);
  console.log('baseline: renamed', count, 'occurrences of D01S11_SleevePress_IP -> D01S11_SleevePress');
}

// 5) Baseline file: add the missing AOI_FanucRecipe definition, copied verbatim from the template, into <AddOnInstructionDefinitions>.
{
  let xml = fs.readFileSync(BASELINE, 'utf8');
  if (xml.includes('<AddOnInstructionDefinition Name="AOI_FanucRecipe"')) {
    console.log('baseline: AOI_FanucRecipe already present, skipping');
  } else {
    const tpl = fs.readFileSync(TEMPLATE, 'utf8');
    const m = /<AddOnInstructionDefinition Name="AOI_FanucRecipe"[\s\S]*?<\/AddOnInstructionDefinition>/.exec(tpl);
    if (!m) throw new Error('AOI_FanucRecipe not found in template');
    const closeTag = '</AddOnInstructionDefinitions>';
    const idx = xml.indexOf(closeTag);
    if (idx < 0) throw new Error('no </AddOnInstructionDefinitions> in baseline');
    xml = xml.slice(0, idx) + m[0] + '\n' + xml.slice(idx);
    fs.writeFileSync(BASELINE, xml);
    console.log('baseline: inserted AOI_FanucRecipe definition (', m[0].length, 'chars ) from template');
  }
}

console.log('\ndone.');
