const fs = require('fs');
const B = "X:\\Electrical Dept\\SDC Engineer\\Deliveries\\1158\\build-inputs\\build\\1158_baseline_from_Matt.L5X";
const T = "X:\\Electrical Dept\\SDC Engineer\\Templates\\SoftwareStandardizationNew.L5X";

let xml = fs.readFileSync(B, 'utf8');
const tpl = fs.readFileSync(T, 'utf8');

function extractBlock(src, openMarkerRegex, closeTag) {
  const m = openMarkerRegex.exec(src);
  if (!m) throw new Error('open marker not found: ' + openMarkerRegex);
  const start = m.index;
  const end = src.indexOf(closeTag, start) + closeTag.length;
  return src.slice(start, end);
}

// 1) DataTypes: Fanuc_Robot_Control, Fanuc_Robot_Status, ROBOT_INPUT2_T, ROBOT_OUTPUT2_T
const dataTypeNames = ['Fanuc_Robot_Control', 'Fanuc_Robot_Status', 'ROBOT_INPUT2_T', 'ROBOT_OUTPUT2_T'];
let dtInsert = '';
for (const name of dataTypeNames) {
  if (xml.includes(`<DataType Name="${name}"`)) { console.log('DataType', name, 'already present, skip'); continue; }
  const block = extractBlock(tpl, new RegExp(`<DataType Name="${name}"[^>]*>`), '</DataType>');
  dtInsert += block + '\n';
  console.log('queued DataType', name, block.length, 'chars');
}
if (dtInsert) {
  xml = xml.replace('</DataTypes>', dtInsert + '</DataTypes>');
}

// 2) AOI definitions: AOI_Fanuc_IN, AOI_Fanuc_OUT
const aoiNames = ['AOI_Fanuc_IN', 'AOI_Fanuc_OUT'];
let aoiInsert = '';
for (const name of aoiNames) {
  if (xml.includes(`<AddOnInstructionDefinition Name="${name}"`)) { console.log('AOI', name, 'already present, skip'); continue; }
  const block = extractBlock(tpl, new RegExp(`<AddOnInstructionDefinition Name="${name}"[^>]*>`), '</AddOnInstructionDefinition>');
  aoiInsert += block + '\n';
  console.log('queued AOI', name, block.length, 'chars');
}
if (aoiInsert) {
  xml = xml.replace('</AddOnInstructionDefinitions>', aoiInsert + '</AddOnInstructionDefinitions>');
}

// 3) Six controller-scope tags for the robot module I/O, inserted into the FIRST <Tags>...</Tags> (controller scope)
const newTags = `<Tag Name="r01_FlexFeederStatus" Class="Standard" TagType="Base" DataType="Fanuc_Robot_Status" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>
<Tag Name="r01_FlexFeederControl" Class="Standard" TagType="Base" DataType="Fanuc_Robot_Control" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>
<Tag Name="r01_FlexFeederEDAIn" Class="Standard" TagType="Base" DataType="ROBOT_OUTPUT2_T" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>
<Tag Name="r01_FlexFeederEDAOut" Class="Standard" TagType="Base" DataType="ROBOT_INPUT2_T" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>
<Tag Name="r01_FlexFeeder_IN" Class="Standard" TagType="Base" DataType="AOI_Fanuc_IN" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>
<Tag Name="r01_FlexFeeder_OUT" Class="Standard" TagType="Base" DataType="AOI_Fanuc_OUT" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>
`;
if (xml.includes('r01_FlexFeederStatus')) {
  console.log('controller tags already present, skip');
} else {
  const firstTagsOpen = xml.indexOf('<Tags>');
  const firstTagsClose = xml.indexOf('</Tags>', firstTagsOpen);
  xml = xml.slice(0, firstTagsClose) + newTags + xml.slice(firstTagsClose);
  console.log('inserted 6 controller-scope tags');
}

// 4) Four ParameterConnections
const newConns = `<ParameterConnection EndPoint1="\\D01_FlexFeeder.q_RobotControl" EndPoint2="r01_FlexFeederControl"/>
<ParameterConnection EndPoint1="\\D01_FlexFeeder.q_RobotEDAOut" EndPoint2="r01_FlexFeederEDAOut"/>
<ParameterConnection EndPoint1="r01_FlexFeederEDAIn" EndPoint2="\\D01_FlexFeeder.i_RobotEDAIn"/>
<ParameterConnection EndPoint1="r01_FlexFeederStatus" EndPoint2="\\D01_FlexFeeder.i_RobotStatus"/>
`;
if (xml.includes('r01_FlexFeederControl" EndPoint2') || xml.includes('EndPoint2="r01_FlexFeederControl"')) {
  console.log('ParameterConnections already present, skip');
} else {
  xml = xml.replace('</ParameterConnections>', newConns + '</ParameterConnections>');
  console.log('inserted 4 ParameterConnections');
}

fs.writeFileSync(B, xml);
console.log('done');
