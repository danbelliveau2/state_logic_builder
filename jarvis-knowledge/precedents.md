# SDC Naming Precedents (auto-harvested)

> REAL names SDC has actually shipped — templates, Jason-verified builds,
> standard-following examples, and real app projects. These are the baseline:
> MATCH the pattern; never invent a style. Regenerate with
> `node scripts/harvestPrecedents.cjs`.

## Station / PLC program names (S{nn}_{PascalName})
S00_IndexerSP, S01_PartLoad, S03_PartLoad, S04_PartVerify, S05_ServoPNP, S18_RejectUnload, S19_GoodUnload

## Routine names
Logic, R00_Main, R01_Inputs, R20_Alarms, R02_StateTransitions, R02_Logic, R03_StateLogic, R01_Logic, EnableInFalse, R01_ProductionData, R02_ShiftData, R03_Outputs, R03_StackLight, R04_IndexerServo, R10_CalcDialStationNestNums, R10_Global, R15_EIPMonitor, R02_NestIndicators

## State machine / station display names (as engineers say them)
Dial_Indexer, Barrel_Verify, CoreLoad, Dial_Index, GoodPart_Unload1, GoodPart_Unload2, Heater, Location_Verify, Magnet_Feed, Magnet_Pick, Magnet_Shuttle, MagnetDial, Part_Load, Part_Locate, Reject_1_Unload, Reject2_Unload, RejectPart_Unload, Robot_Load

## Device names, by type (app projects)
- ServoAxis: Dial_Indexer, Horizontal_Axis, Magnet_Dial, Part_Locate Part_Push, PNP_XAxis, PNP_ZAxis, PNPRotate, PNPXAxis, PNPZAxis, Vertical_Axis
- PneumaticLinearActuator: Head_Opener_Cylinder, Bend Tool, Hold_Down, Horizontal_Shuttle, Magnet_Shuttle Hold_Down, Magnet_Shuttle Horizontal_Shuttle, Magnet_Shuttle Top_Retainer, Magnet_Shuttle Vertical_Shuttle, Part_Locate Vertical_Cylinder, Pick_Slide
- PneumaticRotaryActuator: Pick_Rotary
- PneumaticGripper: Part_Gripper, Heater Gripper, LinkGripper, Part_Locate Part_Gripper
- PneumaticVacGenerator: Magnet_Vacuum
- DigitalSensor: Escapement Part Present, Magnet_Presence, Magnet_Present, Part_Present_Sensor, PartSensor, Stack_Check
- VisionSystem: Barrel_Verify Camera, Location_Verify Camera, StamperVision, Temperature_Verify Camera, WireFeed_Verify Camera
- Robot: Load_Robot, Robot

## Signals / SM outputs (p_ pattern)
AllStationsReady, IndentComplete, BendComplete, Clear_Stamper, ClearForBend, Feed_Station_Complete, Index_Complete, IndexComplete, Link_Upright, Magnet_Presented, Magnet_Taken, Part_Gripped, PickReady, PNP_In_Pos_InvertStamp, PNP_In_Pos_Stamp, PNP_In_Pos_TabBend

## Tag bases with real examples
- i_ (inputs): i_PartPresent, i_XAxisExtended, i_XAxisRetracted, i_ZAxisRetracted, i_CycleStart, i_CycleStop, i_EmptyNest, i_FaultReset, i_ProbeA, i_VacOn, i_HandCrank, i_MainAirPressure
- q_ (outputs): q_AlarmActive, q_WarningActive, q_ActuatorsSafe, q_StationComplete, q_AutoMode, q_AutoStopped, q_StartOK, q_Pause, q_CloseGripper, q_OpenGripper, q_CycleStartLatch, q_CycleStopped
- p_ (SM outputs/signals): p_CycleTime, p_Active, p_History, p_ProgramID, p_Data, p_CurrentPopupNum, p_CurrentScreenNum, p_CurrentShift, p_NestQty, p_NoMachineFaults
- HMI_: HMI_Momentary, HMI_LocalManualOverride, HMI_MomentaryOnPrevScan, HMI_Toggle, HMI_ClearTopAlarms, HMI_IndexerAxis, HMI_ModeSelect, HMI_ResetAllShift, HMI_ResetCurrentShift, HMI_ResetPartCounts
- servo axes (a{NN}_S{station}{name}): a01_Indexer, a03_S01PNPXAxis, a04_S01PNPZAxis, a01_Cam, a02_Dial, a02_ShotPin, a01_ProcessConveyor
