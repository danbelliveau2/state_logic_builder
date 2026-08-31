


PLC Software Standardization Guide


Rev: 02
Last Revised: Wednesday, May 6, 2026


Contents

1. Introduction	4
2. Maintenance of Standard Software	4
3. Program Structure	5
4. Program Naming Convention	6
5. Subroutine Naming Convention	6
6. Tag Naming Convention	6
7. Tag Structure	7
8. Input/Output Parameters	7
9. Network Device Naming Convention	7
10. CIP Motion Axis Naming Convention	8
11. Alarm Handler	8
12. State Logic	9
13. Machine Reset Pushbutton Light	9
14. Cycle Start	9
15. Cycle Stop	9
16. Code Stuck in Run Mode Condition	10
17. Light Stack Functionality	10
18. Inputs Routine Programming	10
19. State Transitions Routine Programming	11
20. State Logic Routine Programming	11
21. Alarm Routine Programming	12
22. Debug programming standards	12
23. Verify Station Programming	12
24. Machine Cycle Time	13
25. Station Cycle Time	13
26. Production Data	13
27. Failure Types	14
28. Station Data	15
29. Nest Data	15
30. Document Change Summary	16


# Introduction
The goal of this document is to provide general PLC programming guidelines for SDC’s Controls Engineers. All supporting documentation and software can be found in the following directory:  X:\Electrical Dept\Standards - Software.

Overall goals:
- Reduce Code Complexity by Breaking Down Large Problems: Break complex systems into smaller, manageable, and logically separated components to improve understanding, development, and maintenance.

- Write Code That Reads Like Natural Language: Use clear, descriptive names and straightforward logic to make code self-explanatory and easy for others to read and understand. Use rung comments to clarify ambiguity and define functionality of small blocks of code or individual lines as required.

- Prioritize Ease of Debugging: Structure code in a way that simplifies troubleshooting and makes changes on the fly easy to make.

- Design for Modularity and Reuse: Develop reusable, self-contained code modules to minimize duplication effort, reduce errors, and accelerate future development. Avoid bloated one-size-fits all modules meant to handle many specific use cases. Focus on creating common frameworks with plug-and-play content that handles only essential functionality.

- Standardize Practices to Reduce Reliance on Individual Contributors: Establish consistent methods, templates, and patterns so output quality doesn’t depend heavily on who wrote the code.

- Balance Performance and Maintainability: Optimize code to execute efficiently without sacrificing readability or structure. Avoid over-engineering or unnecessary complexity.

- Minimize Code Bloat: Keep code lean by eliminating redundancy, unused logic and tags, and excessive abstraction. Favor simplicity and clarity wherever possible.

# Maintenance of Standard Software
It is important that the standard software components be maintained properly. The PLC standardization team will be responsible for maintaining the Standardization directory. For clarity and consistency, it is requested that the Standardization directory be considered read-only by the Controls Engineering team. Requests for changes to standard software components will require a review process.

Reasons for change request:
- Software does not function correctly
- Customer change request
- Controls Engineer identifies improvement

Change request procedure:
- Controls Engineer emails change request to the Controls Engineering Manager, copying PLC standardization team.
- Controls Engineer provides detail and reason for request in email.
Example:
- Software item – Alarm Handler AOI
- Problem identified – Alarm count reset not working.
- Solution – Engineer provides logic.
- PLC standardization team reviews change request.
- If the Controls Engineer is working on a project in the Machine Testing phase, the PLC standardization team will validate the change on this machine.
- If not working on a project in the Machine Testing phase, the PLC standardization team will validate the change once the project has advanced into this phase.
- New version only released after successful validation.

Temporary, project specific modifications to standard software components required to advance the project during the Machine Testing and Installation phases do not require the formal review process.  These changes must only occur on the respective machine programmable devices, not in the Standardization directory.
- Project specific changes to standard software components should be documented.
- At the end of the Machine Testing or Installation phase, the CE must communicate the changes to The Controls Engineering Manager, copying the PLC standardization team.

# Program Structure
Goal: Break down the PLC code into simple, understandable pieces that can be easily debugged.

Programs must be organized in the main task to follow the part or process from upstream to downstream.
A Supervisor program must be included. This program controls the mode switching of the machine. The minimum required states of the Supervisor are as follows:
Safety Stopped (Emergency Stop or Guard Door)
Manual Mode
Auto Idle
Auto Running
Cycle Stopping
Cycle Stopped
More than one Supervisor may be required depending on machine breakdown.
Each station or linear process must have its own program.
Complicated stations should be broken down into simpler multiple programs.
Asynchronous sequences should be separated into multiple programs.
Each program must have no more than one state machine.
Each program should contain the following routines:
Main – Used only to call subroutines.
Inputs – On/off delay timers for station sensors, used to provide local logical inputs, such as mode select, single step, and fault reset.
State Transitions – Station sequential logic and State Engine AOI.
State Logic (Outputs) – Station output control, for example, pneumatic valves.
State Logic (Servo) – Dedicated servo control. One routine per
Alarms – All alarms for the respective program.
Example program structure in the main task:
Main
Supervisor
S01_PartLoad
S02_PartVerify
Remaining Station State Machines – Upstream to Downstream
Production Data
HMI
Alarms

# Program Naming Convention
- Must have a prefix that includes station number or station name. An indexing machine must have the station number prefix.
- Must be descriptive of the operations in that program.
- Example indexing machine station 1: S01_PartLoad
- Example indexing machine station 2: S02_PartVerify
- Example non indexing machine process: P01_WireFeed

# Subroutine Naming Convention
- Must have a prefix “Rxx” so they can be arranged to follow the flow of logic.
- Must be descriptive of the operations in that subroutine.
- The number of subroutines should be balanced based upon the number of devices controlled within.
- R00_Main
- R01_Inputs
- R02_StateTransitions
- R03_StateLogic
- R04_StateLogicServo
- R20_Alarms

# Tag Naming Convention
- Must use the PascalCase format, which is a programming naming convention where each word in a variable name or identifier is capitalized, including the first word. Words are concatenated without any spaces or other separators.
- Projects using Allen Bradley PLC’s, or non Allen Bradley PLC’s that automatically convert data types, do not require prefixes for data type identification.
- Projects using non Allen Bradley PLC’s that cannot automatically convert data types do require prefixes for data type identification.  Example – Schneider Electric PacDrive Codesys processor.
- Tag data types can be found by following the link to the IEC 61131-3 standard:  https://product-help.schneider-electric.com/Machine%20Expert/V1.1/en/LibDevSummary/topics/varnames.htm
- Tag data types are located after the prefix and before the name of the tag.
- Project scope-related prefixes must be used for all PLC’s:
- g_ (global/controller)
- p_ (public parameter)
- i_ (input parameter)
- q_ (output parameter)
- iq_ (input/output parameter)
- Local program tags will have no prefixes.
- Standard examples with no data type prefixes (AB or non AB with data type conversion):
- BOOL public parameter – p_XAxisExtended
- TIMER local – XAxisExtendedDebounce
- REAL global – g_XAxisDeceleration
- Standard examples with data type prefixes (non AB without data type conversion):
- BOOL public parameter – p_bXAxisExtended
- TIMER local – tXAxisExtendedDebounce
- REAL global – g_rXAxisDeceleration
- AOI’s do not require any prefix or data type indicator.  The backing tag should be descriptive of the operation.
- For non Allen Bradley PLC’s that cannot automatically convert data types, the individual members of a user defined data type should include the data type prefix.

# Tag Structure
- Avoid unnecessary use of controller tags. Instead use local tags or parameters where possible.  It is recommended that controller tags should be used only for supplying values of “global” interest to other program organization units.
- The default should be to use local tags or parameters for each program. Local tags should only be used within a program. Parameters must be used for physical inputs and outputs, as well as program handshakes.
- Alias type tags should be limited due to the inability to change these tags without a download.
- InOut type tags should not be used unless necessary. i.e. AOIs, CIP axis connection.

# Input/Output Parameters
- Input and Output parameters must be used for physical digital and analog IO points. They may be used for programming handshakes as well.
- Example for Allen Bradley PLC – Two axis pneumatic PNP with gripper, three input parameters and six output parameters:
- Three input parameters (proximity sensors):
- i_XAxisExtended
- i_XAxisRetracted
- i_ZAxisRetracted
- Six output parameters (solenoid valves):
- q_ExtendXAxis
- q_RetractXAxis
- q_ExtendZAxis
- q_RetractZAxis
- q_CloseGripper
- q_OpenGripper

# Network Device Naming Convention
- Should use the following prefixes:
- cam – Camera or barcode scanner
- gd – Generic 3rd party device (Telesis Laser)
- io – Any type of i/o block (AB Point I/O)
- rob – Robot
- sd – Servo drive
- vb – Valve bank
- fd – Variable frequency drive
- A number should follow the prefix. Number should increase by one until the total device count is reached. Example – if there are 10 servo drives, the devices would be named sd01_XXX through sd10_XXX.
- The remaining description should include the station number or station name:
- Servo drive 1, indexer: sd01_Indexer
- Servo drive 2, station 1 PNP X Axis: sd02_S01PNPXAxis
- Valve bank 1, box erector sub assembly: vb01_BoxErector

# CIP Motion Axis Naming Convention
- Should use the following prefix:  a – CIP motion axis.
- A number should follow the prefix.  Number should increase by one until the total device count is reached.  Example – if there are 10 servo axes, the devices would be named a01_XXX through a10_XXX.
- The remaining description should include the station number or station name:
- Axis 1, indexer: a01_Indexer
- Axis 2, station 1 PNP X Axis: a02_S01PNPXAxis

# Alarm Handler
- Each project must use the SDC alarm handler.
- The Alarms program and HMI program must be imported to a new project. The standard programs can be found in the SDC X drive. Import the HMI program first.
- Each Supervisor program requires one Alarms program and one HMI program.
- One instance of the CPU_TimeDate_wJulian AOI must be included in the project. This AOI populates the controller tag “CPUDateTime” which is a required input for each instance of the ProgramAlarmHandler. The standard AOI can be imported from the SDC X drive.
- Each alarm subroutine must contain the ProgramAlarmHandler AOI, version 3.0 a, as shown below. The standard AOI can be imported from the SDC X drive.


- Alarm messages should be descriptive and reference the machine station number.
- Example – S01 Part Load: Waiting For X Axis To Extend
- Example – S01 Part Load: Z Axis Servo Amplifier Is Faulted
- Alarm messages should alert the operator of any action required.
- Example – S20 Box Close: Box Jam Detected, Remove Box From Machine

# State Logic
- The standard SDC method of sequential programming is state logic.
- Each state machine must use the SDC standard state engine AOI, State_Engine_128Max, as shown below. The standard AOI can be imported from the SDC X drive.


# Machine Reset Pushbutton Light
- Hardware: Illuminated blue pushbutton, flush, 24VDC, with one normally open contact.
- Light functionality:
- Flash 500ms On / 500ms Off when machine in Safety Stop and ready for reset (all safety devices in safe state).
- On solid when all safety devices in safe state.
- Off in all other scenarios.

# Cycle Start
- Hardware: Illuminated green pushbutton, flush, 24VDC, with one normally open contact.
- The machine cycle must only be started when the Supervisor is in automatic mode and all startup conditions are met.
- Example auto mode startup conditions:
- Cognex camera online
- Telesis Laser ready
- Servo axis enabled and homed
- No machine faults
- The HMI must include a list of startup conditions with on/off status.
- A two second time delay must be used between the cycle start button push and the start of the machine cycle. This alerts the operator to the fact that the machine is starting.
- Light functionality:
- Flash 500ms On / 500ms Off when machine not running, Supervisor in Auto Idle, and all preconditions are met.
- Flash 250ms On / 250ms Off when machine is starting (two second timer accumulating).
- On solid when machine is running.
- The alarm horn must be on when the machine is starting (two second timer accumulating).
- When the machine cycle starts, all stations should auto initialize.
- Once station auto initialization is complete, no other action must be required to trigger the first machine cycle.

# Cycle Stop
- Hardware: Non-illuminated red pushbutton, extended, with one normally closed contact.
- The cycle stop button is only active when the machine is running.
- Sequence of events when cycle stop is pressed and there are no active faults:
- All stations complete their current sequence.
- All stations complete at a known position (controlled stop).
- Supervisor moves into Cycle Stop.
- Sequence of events when a fault occurs:
- The faulted station state machine moves into the fault state.
- All stations that are not faulted complete their current sequence.
- All stations that are not faulted complete at a known position (controlled stop).
- Supervisor moves into Cycle Stop.

# Code Stuck in Run Mode Condition
- To prevent a scenario where a state machine gets stuck in a state preventing the Supervisor from entering Cycle Stopped, the following logic should be used.
- When a cycle stop is pressed with the machine running, a ten second timer will start to allow any machine to come to a controlled stop. Note – some machines may require longer than a ten second timer.
- Once the ten second timer expires, the Supervisor will move from Cycle Stopping to Cycle Stopped. This will force all station state machines to Cycle Stopped.

# Light Stack Functionality
- The standard SDC light stack configuration is the following:
- Alarm Horn
- Red Light
- Amber Light
- Green Light
- Alarm Horn functionality:
- On when cycle start timer is accumulating.
- On 1s / Off 1s when machine fault occurs, a total of three on/off cycles.
- On for 100ms every 10 seconds if a warning is active when the machine is in Auto Running.
- Off in all other scenarios.
- Red Light functionality:
- On solid during safety stop condition (guard door open or Emergency stop pressed).
- On 500ms / Off 500ms when machine is faulted and not safety stopped.
- Off when no active fault or safety stop condition.
- Amber Light functionality:
- On 500ms / Off 500ms when machine warning is active in Auto Idle & Auto Running.
- On solid when machine is in manual mode.
- Off when no active warning.
- Green Light functionality:
- On solid when machine is in Auto Running.
- Flash 500ms On / 500ms Off when machine not running, Supervisor in Auto Idle, and all preconditions are met.
- Flash 250ms On / 250ms Off when machine is starting (two second timer accumulating).
- Off in all other scenarios.
# Inputs Routine Programming
- The inputs routine shall contain the following items. More items may be added if they relate to inputs to the state machine and/or contain information about how decisions need to be made.
- Action delays without explicit sensor input
- The most common example is a solenoid moving an actuator to the extend position where there is no extend sensor input
- The timer must only be triggered when the following is true
- The output for the action is on
- The output for the reverse action is off
- The input for the reverse action is off
- Debounced inputs
- Local logical inputs. This allows for something other than the machine supervisor to control the state machine creating more flexibility, especially during debug. These are the standard set of inputs that most state machines should have.
- Manual Mode
- Safety OK
- Fault Reset
- Cycle Running
- Cycle Stopping
- Cycle Stopped
- Initialized
- Lockout
- Dry Run
- Single Step
- Manual HMI momentary button clear instruction
- Other “inputs” to the program that the state machine will used to make decisions.

# State Transitions Routine Programming
- Every state transitions routine shall have the following standard states:
- State 0 – Safety Stop
- State 1 – Manual Mode
- State 2 – Auto Mode Idle Not Ready
- State 3 – Auto Mode Idle Ready
- State 4 – Start of Sequence, Step 1 (name should be specific to the state machine)
- State 99 – Lockout
- State 100 – Start of initialization sequence
- State 124 – Initialization Complete
- The state transition sequence should be separated by 3 states per step in the initial code. This allows for easier modifications or insertions of additional states during debug.
- Only one state transition is allowed per rung with all the conditions that cause transition into that state in series and parallel instructions placed in front of the transition.
- All actions performed in a state, except safety stop and cycle time logic in the software standard project, are to be performed in the State Logic routine(s)
- State transitions shall be organized to follow the flow of the machine.
- The number of state transitions shall be optimized to reduce the number of transitions without introducing convolution.

# State Logic Routine Programming
- The State Logic routine shall contain all the logic executed in any given state.
- Logic not based on the current state is permitted.
- The use of coils is preferred over the use of latches as long as it does not overly complicate the logic.
- Latches are permitted, but the unlatch instruction must be in the preceding or following rung wherever possible.
- Generally there should be one routine for state logic however it is permitted to separate state logic routines into multiple routines as necessary.
- Very long routines may be split out
- Specialized routines may be split out (the servo routine is a specialized routine that is always split out on a per axis basis)

# Alarm Routine Programming
- Alarms for a state machine that is locked out should not trigger when the cycle is running
- Alarms for discrete actions such as a cylinder not retracting shall be configured to look at the state of the output and the input, not the current state transition.
- Warnings and retries shall be used where applicable to reduce machine stoppages.

# Debug programming standards
- In order to enable personnel other than the programmer to debug/optimize the machine, all machines shall be equipped with the following as applicable:
- Lockout logic to prevent a station from executing in auto mode
- Bypass logic to prevent rejects
- Single step per station and per machine cycle
- Dry run to operate all non-locked out functions without parts
- Manual override to auto per station to operate one station in auto with the rest of the machine in manual mode
- Debug trigger bits to clear part data, simulate signals etc.
- These functions shall be programmed locally for each state machine. Their effects can then be triggered by a local HMI button bit, or controlled by a global HMI button or supervisor state.
- These functions shall be available on the HMI as part of the standard SDC package. Some functions may be on a “debug” screen as applicable and may be hidden or eliminated when the machine is ready for runoff.
- Additionally, the HMI should contain the following:
- Global machine settings (avoid hard coded values)
- Offsets for key robot positions
- Alarm settings such as rejects in a row threshold
- Debug bits and temporary code shall be clearly indicated.
- Use a global LINT for the debug bits in a project and call it g_Debug.
- Remove all instances of this tag, any temporary code, and any general unused tags when the machine is ready for FAT.


# Verify Station Programming
- All assembly machines have verification stations. The verification station is typically one station downstream from the assembly action. For example, if part 1 is loaded at station 1, the verify is typically located at station 2.
- A consecutive failures counter is required for each verify station. The default count preset should be three. The counter preset should be settable per station on the HMI.
- When the consecutive failures count is reached, the verify station must fault, with a fault message displaying “Station XX Verify: Consecutive Failures.”
- The consecutive failures counter should be reset in the following scenarios:
- When consecutive failure’s fault is set
- When verification passes
- The verification sensor must be set up so that an ON condition is passing and an OFF condition is failing.
- The OFF condition must be detected after each cycle. If the sensor is stuck ON, the verify station must fault, with a fault message displaying “Station XX Verify: Sensor stuck in ON state.”

# Machine Cycle Time
- The cycle time for one, 25, and 100 machine cycles should be calculated in the PLC and displayed on the Main HMI screen using the following logic. The MovingAverage AOI can be imported from the X drive. Note – one, 25, and 100 were selected as a guideline.


# Station Cycle Time
- The cycle time for each active machine station should be displayed on the Station Cycle Time HMI screen using the following logic.


# Production Data
- Every assembly machine must calculate and display production and shift data. The required data is shown below in the SDC standard HMI production screen.


- Data field descriptions:
- Total – Total parts machine has produced (good + reject)
- Good – Good parts machine has produced
- Reject – Reject parts machine has produced
- Faults – Total machine faults
- Good % – (Good parts / Total parts) *100
- Reject % – (Reject parts / Total parts) * 100
- Elapsed Time (min) – Total elapsed time in minutes
- Runtime (min) – Total machine runtime (cycle running) in minutes
- Downtime (min) – Total machine downtime in minutes
- Runtime Efficiency % – (Runtime / Elapsed time) *100
- Cycle Efficiency % – Component of the OEE calculation; measure of how closely the machine is tracking the cycle time
- OEE % – Good % * Runtime Efficiency % * Cycle Efficiency
- A standard program that calculates production and shift data is located in the X drive.

# Failure Types
- Assembly machines with verify stations (example sensor or vision system) must calculate and display counts per failure type code. The failure type codes should be formatted to include station number and failure number. Failure numbers should start at 1.
- Example – Failure type code 11: Station 1, failure number 1
- Example – Failure type code 205: Station 20, failure number 5
- Failure type counts must be tallied for production and shift data.
- The failure type code should be included in the nest part tracking. This information is important for customers sorting rejects and doing rework.
- Below is an example from a machine in which a vision inspection was located at station 15. There were six failure codes.


# Station Data
- Every assembly machine must calculate and display the following station data:
- Attempts – Total station cycles
- Good – Good parts station has produced
- Reject – Reject parts station has produced
- Efficiency – (Good / Attempts) * 100
- The following control must be provided for each verification station:
- Bypass – Station runs each machine cycle with the verification result bypassed.  Function selected by toggle button.
- Example – Vision inspection station: Camera will still trigger with the result ignored. The part tracking success bit will always be set.
- The following control must be provided for all stations.:
- Lockout – Station will not run (part tracking ignored). Function selected by toggle button.
- If a station is locked out, the success bit must be set.
- If a station is Bypassed or Locked Out, a warning message must be displayed by the Alarm Handler.
- Example – S01 Coil Load: Station Bypass Is Active
- Example – S20 Labeler: Station Is Locked Out

# Nest Data
- Every assembly machine must calculate and display the following nest data. This is the overall data for the nest; it should only be updated when a part is unloaded from nest.
- Attempts – Total count of unloads from nest
- Good – Good parts nest has produced
- Reject – Reject parts nest has produced
- Efficiency – (Good / Attempts) * 100
- The following controls must be provided for each station:
- Lockout – Nest will not be loaded with any parts.  If the lockout is turned on with a part present, the nest should finish being processed by the machine.

# Document Change Summary
| Rev | Effective Date | Author(s) | Description of Change |
|---|---|---|---|
| 02 | 5/6/2026 | Jason Perry, / Tim Wilmot | Contact person changed, minor verbiage changes, added sections 18 - 22 |
