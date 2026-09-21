// Job 1160 -- controller shell builder (Controller, Modules, Axes, Tracking UDT widening, Tasks, ParameterConnections)
// Sources: generated/1160/ref/ChassisStandard (base), SoftwareStandardization (Kinetix 5300 module + axis body, generic ETHERNET-MODULE shape),
//          MidBaseLoad_v1_4_1 (AOI_TorqueHome), _1028_Diamond (5069-L320ERMS2 Local shape, 5069-IY4 block, 5069-OF4 block, Keyence DL-EP1 generic shape).
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\SDC-StateLogic\\generated\\1160';
const REF = path.join(ROOT, 'ref');
const OUT = path.join(ROOT, 'build', 'controller');
const SCRATCH = __dirname;
const DIAMOND = 'C:\\SDC-StateLogic\\plc-reference\\training-material\\Examples NOT Following SDC Standard\\_1028_Diamond_041024.L5X';

fs.mkdirSync(OUT, { recursive: true });
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const lines = (s) => s.split(/\r?\n/);
const wr = (name, content) => {
  // ASCII-only guard for everything we author (template pieces are passed through untouched)
  fs.writeFileSync(path.join(OUT, name), content, 'utf8');
  console.log('wrote', name, content.length, 'bytes');
};

// ---------------------------------------------------------------- 00_header.xml
{
  const tpl = lines(rd(path.join(REF, 'ChassisStandard', '00_header.xml')));
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${days[now.getDay()]} ${mons[now.getMonth()]} ${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())} ${now.getFullYear()}`;
  const hdr = tpl.join('\n')
    .replace('TargetName="ChassisStandard"', 'TargetName="SDC_1160_YSiteAssembly"')
    .replace(/ExportDate="[^"]*"/, `ExportDate="${stamp}"`)
    .replace('<Controller Use="Target" Name="ChassisStandard" ProcessorType="5069-L310ERMS2"', '<Controller Use="Target" Name="SDC_1160_YSiteAssembly" ProcessorType="5069-L320ERMS2"')
    .replace(/ProjectCreationDate="[^"]*"/, `ProjectCreationDate="${stamp}"`)
    .replace(/LastModifiedDate="[^"]*"/, `LastModifiedDate="${stamp}"`)
    .replace(/DataExchangeId="\{[^}]*\}"/, 'DataExchangeId="{7A1160C0-5D3E-4B7B-9E2A-1160C0DE0001}"');
  if (!hdr.includes('SDC_1160_YSiteAssembly') || !hdr.includes('5069-L320ERMS2')) throw new Error('header substitution failed');
  wr('00_header.xml', hdr.trimEnd() + '\n');
}

// ---------------------------------------------------------------- DataTypes.xml (two-up Tracking widening)
{
  let dt = rd(path.join(REF, 'ChassisStandard', 'DataTypes.xml'));
  const oldPartStatus =
`<Member Name="PartStatus" DataType="Tracking_Part_Assy_Stat" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write">
<Description>
<![CDATA[Assembly Status From All Stations For The Part In The Nest]]>
</Description>
</Member>`;
  const newPartStatus =
`<Member Name="PartStatusRT" DataType="Tracking_Part_Assy_Stat" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write">
<Description>
<![CDATA[Assembly Status From All Stations For The Part In The RIGHT Nest (two-up)]]>
</Description>
</Member>
<Member Name="PartStatusLT" DataType="Tracking_Part_Assy_Stat" Dimension="0" Radix="NullType" Hidden="false" ExternalAccess="Read/Write">
<Description>
<![CDATA[Assembly Status From All Stations For The Part In The LEFT Nest (two-up)]]>
</Description>
</Member>`;
  if (dt.split(oldPartStatus).length !== 2) throw new Error('Tracking_Nest.PartStatus member not found exactly once');
  dt = dt.replace(oldPartStatus, newPartStatus);

  const oldLockout =
`<Member Name="ZZZZZZZZZZTracking_N0" DataType="SINT" Dimension="0" Radix="Decimal" Hidden="true" ExternalAccess="Read/Write"/>
<Member Name="Lockout" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZTracking_N0" BitNumber="0" ExternalAccess="Read/Write"/>`;
  const newLockout = oldLockout +
`
<Member Name="LockoutRT" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZTracking_N0" BitNumber="1" ExternalAccess="Read/Write">
<Description>
<![CDATA[Right Nest Lockout (two-up)]]>
</Description>
</Member>
<Member Name="LockoutLT" DataType="BIT" Dimension="0" Radix="Decimal" Hidden="false" Target="ZZZZZZZZZZTracking_N0" BitNumber="2" ExternalAccess="Read/Write">
<Description>
<![CDATA[Left Nest Lockout (two-up)]]>
</Description>
</Member>`;
  if (dt.split(oldLockout).length !== 2) throw new Error('Tracking_Nest_Op_Status.Lockout member not found exactly once');
  dt = dt.replace(oldLockout, newLockout);
  wr('DataTypes.xml', dt.trimEnd() + '\n');
}

// ---------------------------------------------------------------- AddOnInstructionDefinitions.xml (template + AOI_TorqueHome)
{
  const aoi = rd(path.join(REF, 'ChassisStandard', 'AddOnInstructionDefinitions.xml'));
  const th = rd(path.join(SCRATCH, 'aoi_torquehome.xml')).trimEnd();
  if (!/^<AddOnInstructionDefinition Name="AOI_TorqueHome"/.test(th) || !/<\/AddOnInstructionDefinition>$/.test(th)) throw new Error('AOI_TorqueHome extract malformed');
  if (/Use="/.test(th)) throw new Error('AOI_TorqueHome carries Use= attributes');
  const marker = '<AddOnInstructionDefinition Name="Chassis_CamPos_Check"';
  const idx = aoi.indexOf(marker);
  if (idx < 0) throw new Error('Chassis_CamPos_Check marker not found');
  const merged = aoi.slice(0, idx) + th + '\n' + aoi.slice(idx);
  const names = [...merged.matchAll(/<AddOnInstructionDefinition Name="([^"]+)"/g)].map((m) => m[1]);
  console.log('AOIs:', names.join(', '));
  wr('AddOnInstructionDefinitions.xml', merged.trimEnd() + '\n');
}

// ---------------------------------------------------------------- Modules.xml
const dropDxid = (s) => s.replace(/\s*DataExchangeId="\{[^}]*\}"/g, '');

function genericEthernetModule({ name, ip, desc, fmt, inPoint, outPoint, cfgInst, inBytes, outBytes }) {
  // shape copied from SoftwareStandardization vb01_MainMachine / Diamond KeyenceProbes (generic ETHERNET-MODULE)
  const isInt = fmt === 'INT';
  const commMethod = isInt ? '536870915' : '536870916';
  const elemType = isInt ? 'INT' : 'SINT';
  const inDim = isInt ? inBytes / 2 : inBytes;
  const outDim = isInt ? outBytes / 2 : outBytes;
  if (!Number.isInteger(inDim) || !Number.isInteger(outDim)) throw new Error('INT format needs even byte counts: ' + name);
  const zeros400 = (() => {
    const rows = [];
    for (let i = 0; i < 400; i += 80) rows.push(Array(Math.min(80, 400 - i)).fill('0').join(','));
    return rows.join('\n\t\t,');
  })();
  const cfgDecor = Array.from({ length: 400 }, (_, i) => `<Element Index="[${i}]" Value="16#00"/>`).join('\n');
  const arr = (dim) => Array.from({ length: dim }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n');
  const l5kZeros = (dim) => '[[' + Array(dim).fill('0').join(',') + ']]';
  return `<Module Name="${name}" CatalogNumber="ETHERNET-MODULE" Vendor="1" ProductType="0" ProductCode="18" Major="1" Minor="1" ParentModule="Local" ParentModPortId="3" Inhibited="false" MajorFault="false"
>
<Description>
<![CDATA[${desc}]]>
</Description>
<EKey State="Disabled"/>
<Ports>
<Port Id="2" Address="${ip}" Type="Ethernet" Upstream="true"/>
</Ports>
<Communications CommMethod="${commMethod}" PrimCxnInputSize="${inBytes}" PrimCxnOutputSize="${outBytes}">
<ConfigTag ConfigSize="0" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
<![CDATA[[4,${cfgInst},[${zeros400}]]]]>
</Data>
<Data Format="Decorated">
<Structure DataType="AB:ETHERNET_MODULE:C:0">
<ArrayMember Name="Data" DataType="SINT" Dimensions="400" Radix="Hex">
${cfgDecor}
</ArrayMember>
</Structure>
</Data>
</ConfigTag>
<Connections>
<Connection Name="Standard" RPI="10000" Type="Output" InputCxnPoint="${inPoint}" OutputCxnPoint="${outPoint}" OutputSize="${outBytes}" InputSize="${inBytes}" EventID="0" ProgrammaticallySendEventTrigger="false" Unicast="true">
<InputTag ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="Decorated">
<Structure DataType="AB:ETHERNET_MODULE_${elemType}_${inBytes}Bytes:I:0">
<ArrayMember Name="Data" DataType="${elemType}" Dimensions="${inDim}" Radix="Decimal">
${arr(inDim)}
</ArrayMember>
</Structure>
</Data>
</InputTag>
<OutputTag ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="L5K">
<![CDATA[${l5kZeros(outDim)}]]>
</Data>
<Data Format="Decorated">
<Structure DataType="AB:ETHERNET_MODULE_${elemType}_${outBytes}Bytes:O:0">
<ArrayMember Name="Data" DataType="${elemType}" Dimensions="${outDim}" Radix="Decimal">
${arr(outDim)}
</ArrayMember>
</Structure>
</Data>
</OutputTag>
</Connection>
</Connections>
</Communications>
</Module>`;
}

// Generic EtherNet/IP nodes per the NAMES CONTRACT (IPs binding; assembly instances/sizes = vendor defaults, confirm against EDS)
const GENERIC_NODES = [
  { name: 'vb01_UpperValveBank', ip: '192.168.1.21', desc: 'SMC EX600-SEN7 upper valve bank: 16-station SY3000 (32 valve outputs) + 3x EX600-DXPC (24 inputs). Assembly 100/150 cfg 105, sizes 4/4 bytes - confirm against SMC EDS/configurator', fmt: 'SINT', inPoint: 100, outPoint: 150, cfgInst: 105, inBytes: 4, outBytes: 4 },
  { name: 'vb02_TableValveBank', ip: '192.168.1.22', desc: 'SMC EX600-SEN7 table valve bank: 10-station SY3000 (20 valve outputs) + 2x EX600-DXPC (16 inputs). Assembly 100/150 cfg 105, sizes 2/4 bytes - confirm against SMC EDS/configurator', fmt: 'SINT', inPoint: 100, outPoint: 150, cfgInst: 105, inBytes: 2, outBytes: 4 },
  { name: 'cam01_RightBranchInspect', ip: '192.168.1.31', desc: 'Keyence IV4-G120 S03 Right Branch hole patency camera. Assembly 100/101 cfg 1, sizes 40/8 bytes INT - confirm against Keyence IV4 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 40, outBytes: 8 },
  { name: 'cam02_RightTrunkInspect', ip: '192.168.1.32', desc: 'Keyence IV4-G120 S03 Right Trunk hole patency camera. Assembly 100/101 cfg 1, sizes 40/8 bytes INT - confirm against Keyence IV4 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 40, outBytes: 8 },
  { name: 'cam03_LeftBranchInspect', ip: '192.168.1.33', desc: 'Keyence IV4-G120 S03 Left Branch hole patency camera. Assembly 100/101 cfg 1, sizes 40/8 bytes INT - confirm against Keyence IV4 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 40, outBytes: 8 },
  { name: 'cam04_LeftTrunkInspect', ip: '192.168.1.34', desc: 'Keyence IV4-G120 S03 Left Trunk hole patency camera. Assembly 100/101 cfg 1, sizes 40/8 bytes INT - confirm against Keyence IV4 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 40, outBytes: 8 },
  { name: 'cam05_RightCutterPresent', ip: '192.168.1.35', desc: 'Keyence IV4-G120 S07 Right Cutter (needle tip) present camera. Assembly 100/101 cfg 1, sizes 40/8 bytes INT - confirm against Keyence IV4 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 40, outBytes: 8 },
  { name: 'cam06_LeftCutterPresent', ip: '192.168.1.36', desc: 'Keyence IV4-G120 S07 Left Cutter (needle tip) present camera. Assembly 100/101 cfg 1, sizes 40/8 bytes INT - confirm against Keyence IV4 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 40, outBytes: 8 },
  { name: 'vs01_OpticalCheck', ip: '192.168.1.41', desc: 'Keyence VS-G2200 S12 Optical Check vision controller (4 cameras, RT/LT top + profile). Assembly 100/101 cfg 1, sizes 128/64 bytes INT - confirm against Keyence VS EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 128, outBytes: 64 },
  { name: 'dm01_PhysicalCheck', ip: '192.168.1.51', desc: 'Keyence DL-EP1 S13 Physical Check GT2 contact sensor pair (RT/LT differential measurement). Assembly 100/101 cfg 1, sizes 168/10 bytes INT - shape from shipped job 1028 KeyenceProbes, confirm against Keyence DL-EP1 EDS', fmt: 'INT', inPoint: 100, outPoint: 101, cfgInst: 1, inBytes: 168, outBytes: 10 },
];

function of8Module() {
  // 5069-OF8 in the 5069-OF4 shape (job 1028 AOUT2) widened to 8 channels; no shape for an OF8 exists in any reference.
  const chCfg = (n, disabled) => `<StructureMember Name="Ch0${n}" DataType="AB:5000_AO_Channel:C:0">
<DataValueMember Name="Range" DataType="SINT" Radix="Decimal" Value="2"/>
<DataValueMember Name="AlarmDisable" DataType="BOOL" Value="0"/>
<DataValueMember Name="LimitAlarmLatchEn" DataType="BOOL" Value="0"/>
<DataValueMember Name="RampAlarmLatchEn" DataType="BOOL" Value="0"/>
<DataValueMember Name="NoLoadEn" DataType="BOOL" Value="0"/>
<DataValueMember Name="Disable" DataType="BOOL" Value="${disabled ? 1 : 0}"/>
<DataValueMember Name="FaultMode" DataType="BOOL" Value="1"/>
<DataValueMember Name="ProgMode" DataType="BOOL" Value="1"/>
<DataValueMember Name="ProgramToFaultEn" DataType="BOOL" Value="0"/>
<DataValueMember Name="RampInRun" DataType="BOOL" Value="0"/>
<DataValueMember Name="RampToProg" DataType="BOOL" Value="0"/>
<DataValueMember Name="RampToFault" DataType="BOOL" Value="0"/>
<DataValueMember Name="HoldForInit" DataType="BOOL" Value="0"/>
<DataValueMember Name="FaultValueStateDuration" DataType="SINT" Radix="Decimal" Value="0"/>
<DataValueMember Name="MaxRampRate" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="LowSignal" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="HighSignal" DataType="REAL" Radix="Float" Value="10.0"/>
<DataValueMember Name="LowEngineering" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="HighEngineering" DataType="REAL" Radix="Float" Value="100.0"/>
<DataValueMember Name="LowLimit" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="HighLimit" DataType="REAL" Radix="Float" Value="100.0"/>
<DataValueMember Name="Offset" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="FaultValue" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="ProgValue" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="FaultFinalState" DataType="REAL" Radix="Float" Value="0.0"/>
</StructureMember>`;
  const chIn = (n) => `<StructureMember Name="Ch0${n}" DataType="CHANNEL_AO_DIAG:I:0">
<DataValueMember Name="Fault" DataType="BOOL" Value="0"/>
<DataValueMember Name="Uncertain" DataType="BOOL" Value="0"/>
<DataValueMember Name="NoLoad" DataType="BOOL" Value="0"/>
<DataValueMember Name="ShortCircuit" DataType="BOOL" Value="0"/>
<DataValueMember Name="OverTemperature" DataType="BOOL" Value="0"/>
<DataValueMember Name="FieldPowerOff" DataType="BOOL" Value="0"/>
<DataValueMember Name="InHold" DataType="BOOL" Value="0"/>
<DataValueMember Name="NotANumber" DataType="BOOL" Value="0"/>
<DataValueMember Name="Underrange" DataType="BOOL" Value="0"/>
<DataValueMember Name="Overrange" DataType="BOOL" Value="0"/>
<DataValueMember Name="LLimitAlarm" DataType="BOOL" Value="0"/>
<DataValueMember Name="HLimitAlarm" DataType="BOOL" Value="0"/>
<DataValueMember Name="RampAlarm" DataType="BOOL" Value="0"/>
<DataValueMember Name="CalFault" DataType="BOOL" Value="0"/>
<DataValueMember Name="Calibrating" DataType="BOOL" Value="0"/>
<DataValueMember Name="Data" DataType="REAL" Radix="Float" Value="0.0"/>
<DataValueMember Name="RollingTimestamp" DataType="INT" Radix="Decimal" Value="0"/>
</StructureMember>`;
  const chOut = (n) => `<StructureMember Name="Ch0${n}" DataType="CHANNEL_AO:O:0">
<DataValueMember Name="LLimitAlarmUnlatch" DataType="BOOL" Value="0"/>
<DataValueMember Name="HLimitAlarmUnlatch" DataType="BOOL" Value="0"/>
<DataValueMember Name="RampAlarmUnlatch" DataType="BOOL" Value="0"/>
<DataValueMember Name="Data" DataType="REAL" Radix="Float" Value="0.0"/>
</StructureMember>`;
  const chans = [0, 1, 2, 3, 4, 5, 6, 7];
  const used = [0, 1, 2, 3, 4]; // OUT0..OUT4 on the schematic (feeder speeds)
  const eu = used.map((n) => `<EngineeringUnit Operand=".CH0${n}.DATA">
<![CDATA[%]]>
</EngineeringUnit>`).join('\n');
  return `<Module Name="AOUT1" CatalogNumber="5069-OF8/A" Vendor="1" ProductType="115" ProductCode="321" Major="2" Minor="1" ParentModule="Local" ParentModPortId="1" Inhibited="false" MajorFault="false"
 SafetyEnabled="false" AutoDiagsEnabled="true">
<Description>
<![CDATA[Analog outputs, voltage mode: OUT0 Y-Site Body Right Bowl speed, OUT1 Left Bowl speed, OUT2 Linear Track speed, OUT3 Septum Bowl speed, OUT4 Septum Linear Track speed. On the schematic, not on the ETO BOM - flag. Shape widened from a 5069-OF4 reference: CE to confirm/re-declare from the 5069-OF8 profile.]]>
</Description>
<EKey State="CompatibleModule"/>
<Ports>
<Port Id="1" Address="6" Type="5069" Upstream="true"/>
</Ports>
<Communications>
<ConfigTag ConfigSize="384" ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="Decorated">
<Structure DataType="AB:5000_AO8:C:0">
${chans.map((n) => chCfg(n, !used.includes(n))).join('\n')}
</Structure>
</Data>
</ConfigTag>
<Connections>
<Connection Name="OutputData" RPI="80000" Type="StandardDataDriven" OutputSize="64" InputSize="100" EventID="0" ProgrammaticallySendEventTrigger="false" Priority="Scheduled" InputConnectionType="Multicast" InputProductionTrigger="Cyclic"
 InputTagSuffix="I" OutputTagSuffix="O">
<InputTag ExternalAccess="Read/Write" OpcUaAccess="None">
<Data Format="Decorated">
<Structure DataType="AB:5000_AO8:I:0">
<DataValueMember Name="RunMode" DataType="BOOL" Value="0"/>
<DataValueMember Name="ConnectionFaulted" DataType="BOOL" Value="0"/>
<DataValueMember Name="DiagnosticActive" DataType="BOOL" Value="0"/>
<DataValueMember Name="DiagnosticSequenceCount" DataType="SINT" Radix="Decimal" Value="0"/>
${chans.map(chIn).join('\n')}
</Structure>
</Data>
</InputTag>
<OutputTag ExternalAccess="Read/Write" OpcUaAccess="None">
<EngineeringUnits>
${eu}
</EngineeringUnits>
<Data Format="Decorated">
<Structure DataType="AB:5000_AO8:O:0">
${chans.map(chOut).join('\n')}
</Structure>
</Data>
</OutputTag>
</Connection>
</Connections>
</Communications>
</Module>`;
}

{
  const tpl = lines(rd(path.join(REF, 'ChassisStandard', 'Modules.xml')));
  // sanity anchors (1-based line numbers from the reference index)
  if (!tpl[0].startsWith('<Modules>')) throw new Error('Modules root');
  if (!tpl[1].startsWith('<Module Name="Local" CatalogNumber="5069-L310ERMS2"')) throw new Error('Local anchor');
  if (!tpl[920].startsWith('</Module>') || !tpl[921].startsWith('<Module Name="sd01_Cam"')) throw new Error('DOUT1/sd01 anchor');
  const last = tpl.length - 1;
  let endIdx = last; while (!tpl[endIdx].startsWith('</Modules>')) endIdx--;

  // Local retyped to 5069-L320ERMS2 (ProductCode 222, bus 17 per the 5069-L320ERMS2 shape in job 1028)
  const localBlock = tpl.slice(0, 16).join('\n')
    .replace('CatalogNumber="5069-L310ERMS2" Vendor="1" ProductType="14" ProductCode="221"', 'CatalogNumber="5069-L320ERMS2" Vendor="1" ProductType="14" ProductCode="222"')
    .replace('<Bus Size="9"/>', '<Bus Size="17"/>');
  if (!localBlock.includes('5069-L320ERMS2') || !localBlock.includes('ProductCode="222"') || !localBlock.includes('Bus Size="17"')) throw new Error('Local retype failed');

  const slots1to4 = tpl.slice(16, 921).join('\n'); // SIN1, SOUT1, DIN1, DOUT1 verbatim

  // AIN1 5069-IY4 verbatim from job 1028 (slot 6 there) -> slot 5 here
  let ain1 = dropDxid(rd(path.join(SCRATCH, 'diamond_ain1.xml'))).trimEnd();
  if (!ain1.startsWith('<Module Name="AIN1" CatalogNumber="5069-IY4/A"')) throw new Error('AIN1 anchor');
  if (ain1.split('<Port Id="1" Address="6" Type="5069" Upstream="true"/>').length !== 2) throw new Error('AIN1 port');
  ain1 = ain1.replace('<Port Id="1" Address="6" Type="5069" Upstream="true"/>', '<Port Id="1" Address="5" Type="5069" Upstream="true"/>');
  ain1 = ain1.replace('<EKey State="CompatibleModule"/>', `<Description>
<![CDATA[Analog/RTD inputs: IN0 S08 Right Y Air Temperature (RTD-831), IN1 S08 Right Y Air Temperature Safety (over-temp), IN2 S10 Left Y Air Temperature, IN3 S10 Left Y Air Temperature Safety. Channel config copied from a shipped 5069-IY4 - CE to set the RTD input type/range per the schematic.]]>
</Description>
<EKey State="CompatibleModule"/>`);

  const aout1 = of8Module();

  // template drives sd01_Cam / sd02_Dial verbatim, IPs moved to the contract's 192.168.1.x plan
  let drives = tpl.slice(921, endIdx).join('\n');
  if (drives.split('Address="10.1.60.20"').length !== 2 || drives.split('Address="10.1.60.21"').length !== 2) throw new Error('drive IP anchors');
  drives = drives.replace('Address="10.1.60.20"', 'Address="192.168.1.11"').replace('Address="10.1.60.21"', 'Address="192.168.1.12"');

  // Kinetix 5300 sd03/sd04 from the SoftwareStandardization sd03_S01PNPXAxis block (2198-C1004-ERS)
  const ss = lines(rd(path.join(REF, 'SoftwareStandardization', 'Modules.xml')));
  if (!ss[406].startsWith('<Module Name="sd03_S01PNPXAxis" CatalogNumber="2198-C1004-ERS"') || !ss[455].startsWith('</Module>')) throw new Error('sd03 anchor');
  const k5300 = dropDxid(ss.slice(406, 456).join('\n'));
  const mkDrive = (name, ip, desc) => k5300
    .replace('<Module Name="sd03_S01PNPXAxis"', `<Module Name="${name}"`)
    .replace('<EKey State="CompatibleModule"/>', `<Description>
<![CDATA[${desc}]]>
</Description>
<EKey State="CompatibleModule"/>`)
    .replace('Address="10.1.60.22"', `Address="${ip}"`);
  const sd03 = mkDrive('sd03_S09ZAxis', '192.168.1.13', 'Kinetix 5300 2198-C1004-ERS, S09 Right Port Close Z Axis (TLP-A046-010-DJA14S, hardwired STO). Drive config copied from a shipped 2198-C1004-ERS - CE to confirm.');
  const sd04 = mkDrive('sd04_S11ZAxis', '192.168.1.14', 'Kinetix 5300 2198-C1004-ERS, S11 Left Port Close Z Axis (TLP-A046-010-DJA14S, hardwired STO). Drive config copied from a shipped 2198-C1004-ERS - CE to confirm.');
  if (!sd03.includes('sd03_S09ZAxis') || !sd03.includes('192.168.1.13') || !sd04.includes('192.168.1.14')) throw new Error('sd03/sd04 substitution');

  const generics = GENERIC_NODES.map(genericEthernetModule).join('\n');

  const out = [localBlock, slots1to4, ain1, aout1, drives, sd03, sd04, generics, '</Modules>'].join('\n') + '\n';
  wr('Modules.xml', out);
  console.log('modules:', [...out.matchAll(/<Module Name="([^"]+)"/g)].map((m) => m[1]).join(', '));
}

// ---------------------------------------------------------------- ControllerTags.xml
{
  const tpl = lines(rd(path.join(REF, 'ChassisStandard', 'ControllerTags.xml')));
  const text = tpl.join('\n');
  // slice helpers by tag name
  const tagBlock = (src, name) => {
    const re = new RegExp(`<Tag Name="${name}"[\\s\\S]*?</Tag>`);
    const m = src.match(re);
    if (!m) throw new Error('tag not found: ' + name);
    return m[0];
  };
  const a01 = tagBlock(text, 'a01_Cam');
  const a02 = tagBlock(text, 'a02_Dial');
  const gTags = ['g_ActuatorDisengageAngle', 'g_ActuatorEngageAngle', 'g_CPUDateTime', 'g_MachineBasic', 'g_PresetNestPerformHigh', 'g_PresetNestPerformLow', 'g_PresetStationPerformHigh', 'g_PresetStationPerformLow', 'g_ProbeOffAngle', 'g_ProbeProcessAngle'].map((n) => tagBlock(text, n));
  const motionGroup = tagBlock(text, 'MotionGroup');

  // a03 / a04: Kinetix 5300 axis body from the verified SoftwareStandardization a04_S01PNPZAxis (2198-C1004-ERS, mm, screw), re-pointed
  const ss = rd(path.join(REF, 'SoftwareStandardization', 'ControllerTags.xml'));
  const zBody = tagBlock(ss, 'a04_S01PNPZAxis');
  const mkAxis = (name, mod, axisId) => {
    let b = zBody.replace('<Tag Name="a04_S01PNPZAxis"', `<Tag Name="${name}"`)
      .replace('MotionModule="sd04_S01PNPZAxis:Ch1"', `MotionModule="${mod}:Ch1"`)
      .replace(/AxisID="\d+"/, `AxisID="${axisId}"`);
    if (!b.includes(`MotionModule="${mod}:Ch1"`) || !b.includes('PositionUnits="mm"')) throw new Error('axis body substitution ' + name);
    // description right after the opening tag
    b = b.replace(/^(<Tag Name="[^"]+"[^>]*>)/, `$1
<Description>
<![CDATA[${name === 'a03_S09ZAxis' ? 'S09 Right Port Close' : 'S11 Left Port Close'} Z Axis - Kinetix 5300 ${mod}, position units mm, 0-150 mm, torque-level home to the hard stop at top (AOI_TorqueHome). Body copied from a verified 2198-C1004-ERS Z axis (TLP-A070-040, 10 mm/rev) - CE to select TLP-A046-010-DJA14S in the motor database and set actuator lead 5 mm/rev.]]>
</Description>`);
    return b;
  };
  const a03 = mkAxis('a03_S09ZAxis', 'sd03_S09ZAxis', '2640454801');
  const a04 = mkAxis('a04_S11ZAxis', 'sd04_S11ZAxis', '2640454802');

  // g_StationList STRING[17] (index 0 and 4 empty)
  const stations = ['', 'S01 Y-Site Load: ', 'S02 Y Verify: ', 'S03 Y-Site Inspect: ', '', 'S05 Port Load: ', 'S06 Port Verify: ', 'S07 Port Cut: ', 'S08 Right Y Heat: ', 'S09 Right Port Close: ', 'S10 Left Y Heat: ', 'S11 Left Port Close: ', 'S12 Optical Check: ', 'S13 Physical Check: ', 'S14 Good Unload: ', 'S15 Reject Unload: ', 'S16 Empty Nest Check: '];
  if (stations.length !== 17) throw new Error('station list length');
  const pad82 = (s) => { // L5K STRING literal: text then $00 fill to 82 bytes
    let out = s; for (let i = s.length; i < 82; i++) out += '$00'; return out; };
  const l5k = '[' + stations.map((s) => `[${s.length},'${pad82(s)}']`).join('\n\t\t,') + ']';
  const decor = stations.map((s, i) => `<Element Index="[${i}]">
<Structure DataType="STRING">
<DataValueMember Name="LEN" DataType="DINT" Radix="Decimal" Value="${s.length}"/>
<DataValueMember Name="DATA" DataType="STRING" Radix="ASCII">
<![CDATA['${s}']]>
</DataValueMember>
</Structure>
</Element>`).join('\n');
  const gStationList = `<Tag Name="g_StationList" Class="Standard" TagType="Base" DataType="STRING" Dimensions="17" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
<![CDATA[Station name prefixes for R20 alarm text CONCAT (index = station number; 0 and 4 unused)]]>
</Description>
<Data Format="L5K">
<![CDATA[${l5k}]]>
</Data>
<Data Format="Decorated">
<Array DataType="STRING" Dimensions="17">
${decor}
</Array>
</Data>
</Tag>`;

  // module buffer tags for every generic ETHERNET-MODULE
  const bufTag = (name, dir, fmt, bytes) => {
    const isInt = fmt === 'INT';
    const elemType = isInt ? 'INT' : 'SINT';
    const dim = isInt ? bytes / 2 : bytes;
    const io = dir === 'IN' ? 'I' : 'O';
    return `<Tag Name="${name}_${dir}" Class="Standard" TagType="Base" DataType="AB:ETHERNET_MODULE_${elemType}_${bytes}Bytes:${io}:0" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
<![CDATA[${dir === 'IN' ? 'MapInputs buffer: CPS ' + name + ':I -> ' + name + '_IN' : 'MapOutputs buffer: CPS ' + name + '_OUT -> ' + name + ':O'}]]>
</Description>
<Data Format="L5K">
<![CDATA[[[${Array(dim).fill('0').join(',')}]]]]>
</Data>
<Data Format="Decorated">
<Structure DataType="AB:ETHERNET_MODULE_${elemType}_${bytes}Bytes:${io}:0">
<ArrayMember Name="Data" DataType="${elemType}" Dimensions="${dim}" Radix="Decimal">
${Array.from({ length: dim }, (_, i) => `<Element Index="[${i}]" Value="0"/>`).join('\n')}
</ArrayMember>
</Structure>
</Data>
</Tag>`;
  };
  const buffers = [];
  for (const n of GENERIC_NODES) {
    buffers.push(bufTag(n.name, 'IN', n.fmt, n.inBytes));
    buffers.push(bufTag(n.name, 'OUT', n.fmt, n.outBytes));
  }

  // analog-card buffers requested by the MapInputs/MapOutputs builder (build/controller/EXTRA_TAGS.xml) - module-defined types of AIN1:I / AOUT1:O
  const analogBuffers = [
`<Tag Name="ain01_Temperatures_IN" Class="Standard" TagType="Base" DataType="AB:5000_AI4CJ:I:0" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
<![CDATA[MapInputs buffer for AIN1 5069-IY4 (Local slot 5) RTD channels. Ch00.Data S08 Right Air Temperature, Ch01.Data S08 Right Air Temperature Safety, Ch02.Data S10 Left Air Temperature, Ch03.Data S10 Left Air Temperature Safety. Written only by MapInputs R01_Logic; read by S08_RightYHeat / S10_LeftYHeat.]]>
</Description>
</Tag>`,
`<Tag Name="aout01_FeederSpeeds_OUT" Class="Standard" TagType="Base" DataType="AB:5000_AO8:O:0" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None">
<Description>
<![CDATA[MapOutputs buffer for AOUT1 5069-OF8 (Local slot 6) feeder speed references, voltage mode. Ch00.Data Y-Site Body Right Bowl, Ch01.Data Y-Site Body Left Bowl, Ch02.Data Y-Site Body Linear Track, Ch03.Data Septum Bowl, Ch04.Data Septum Linear Track, Ch05-Ch07 spare. Written by S01_YSiteEscapement / S05_PortLoad; copied to AOUT1:O only by MapOutputs R01_Logic. 5069-OF8 is not on the ETO BOM - gap.]]>
</Description>
</Tag>`,
  ];

  // Logix exports controller tags alphabetically (case-insensitive); keep that order
  const all = [a01, a02, a03, a04, ...analogBuffers, ...buffers, ...gTags, gStationList, motionGroup];
  const nameOf = (b) => b.match(/<Tag Name="([^"]+)"/)[1];
  all.sort((x, y) => nameOf(x).toLowerCase().localeCompare(nameOf(y).toLowerCase()));
  const out = '<Tags>\n' + all.join('\n') + '\n</Tags>\n';
  wr('ControllerTags.xml', out);
  console.log('controller tags:', all.map(nameOf).join(', '));
}

// ---------------------------------------------------------------- Tasks.xml
{
  const programs = ['Supervisor', 'Tracking', 'Chassis', 'MapInputs', 'S01_YSiteEscapement', 'S01_YSiteLoad', 'S02_YVerify', 'S03_YSiteInspect', 'S05_PortLoad', 'S06_PortVerify', 'S07_PortCut', 'S08_RightYHeat', 'S09_RightPortClose', 'S10_LeftYHeat', 'S11_LeftPortClose', 'S12_OpticalCheck', 'S13_PhysicalCheck', 'S14_GoodUnload', 'S14_BinDiverter', 'S15_RejectUnload', 'S16_EmptyNest', 'MapOutputs', 'Production', 'Alarms', 'HMI'];
  if (programs.length !== 25) throw new Error('program count ' + programs.length);
  const tasks = `<Tasks>
<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false" Class="Standard">
<ScheduledPrograms>
${programs.map((p) => `<ScheduledProgram Name="${p}"/>`).join('\n')}
</ScheduledPrograms>
</Task>
<Task Name="SafetyTask" Type="PERIODIC" Rate="20" Priority="10" Watchdog="20" DisableUpdateOutputs="false" InhibitTask="false" Class="Safety">
<ScheduledPrograms>
<ScheduledProgram Name="SafetyProgram"/>
</ScheduledPrograms>
</Task>
</Tasks>
`;
  wr('Tasks.xml', tasks);
}

// ---------------------------------------------------------------- ParameterConnections.xml
{
  const pc = `<ParameterConnections>
<ParameterConnection EndPoint1="\\Chassis.iq_CamAxis" EndPoint2="a01_Cam"/>
<ParameterConnection EndPoint1="\\Chassis.iq_DialAxis" EndPoint2="a02_Dial"/>
<ParameterConnection EndPoint1="\\S09_RightPortClose.iq_ZAxis" EndPoint2="a03_S09ZAxis"/>
<ParameterConnection EndPoint1="\\S11_LeftPortClose.iq_ZAxis" EndPoint2="a04_S11ZAxis"/>
</ParameterConnections>
`;
  wr('ParameterConnections.xml', pc);
}
console.log('done');
