


Servo Motor and Drive Selection Guideline


Rev: 02
Last Revised: Tuesday, July 7, 2025


Contents

1.	Introduction	3
2.	Motor Selection	3
2.1.	Application Requirements	3
2.2.	Motor Sizing	3
2.3.	TLP Motors	3
2.4.	VPL Motors	3
2.5.	Encoder Type	4
2.6.	Holding Brake	4
2.7.	Motor Voltage Requirement	4
3.	Cable Selection	4
4.	Drive Selection	6
4.1.	Kinetix 5300 Drives (with TLP Motors)	6
4.2.	Kinetix 5500 Drives (with VPL Motors)	6
5.	PLC Selection	6
6.	Engineering Design Tips	6
7.	Standard AC Motors	6


# Introduction
This guideline outlines the standard selection process for Rockwell Automation's servo motors and drives, with emphasis on using TLP motors with Kinetix 5300 drives and VPL motors with Kinetix 5500 drives.

# Motor Selection
## Application Requirements
Load Inertia and Torque Requirements
Speed Profile and Duty Cycle
Environmental Conditions
Safety and Compliance Requirements

## Motor Sizing
Use Rockwell's "Motion Analyzer" tool for motor sizing. Software provides the options for configured motor/drive selection along with option for motor cable selection.

Considerations:
Peak and continuous torque
Required inertia matching (stay below 10:1 load to motor inertia ratio)
Form factor constraints

## TLP Motors
TLP motors are suitable for simple pick-and-place or point-to-point applications that do not require high-end features such as electronic gearing or camming. They are cost-effective and come in small sizes starting from 50W.

Considerations:
Battery-powered encoder—position lost if battery dies and power is cycled
Requires separate motor power and encoder cables
Lower performance compared to VPL motors

Recommended Applications:
SDC standard PNP
Ball screw or belt drive applications
Simple rotary axes (e.g., gripper 0 to 180 degrees)
SDC indexing ring (shot pin axis)

## VPL Motors
VPL motors are suitable for complex motion control applications beyond simple point-to-point motion. They offer superior performance and features like CIP Safety and software STO but have higher cost.

Recommended Applications:
SDC Chassis: CAM and dial axes
SDC Indexing ring: main drive axis
SDC Terminal inserter (Ref. job 998)
Standard Indexing application (Ref. job 1058)
Servo press
High-speed, coordinated motion

## Encoder Type
SDC uses multiturn absolute as standard.
Example VPL part number w/multiturn:  VPL-B0753F-PJ12AA
Example TLP part number w/multiturn:  TLP-A070-040-DJA32A

## Holding Brake
Required for any application with a vertical load.

Exception – SDC standard PNP vertical axis does not require holding brake for standard applications (ref. job 1058 as example).  Calculation should be done for heavy payloads.

## Motor Voltage Requirement
Select the voltage class (240V or 480V) based on customer power supply. Typical motor voltage ratings are 240V (1 or 3 phase), or 480V (3 phase).

Note – If many motors with 240V class are required for the machine then a step-down transformer from 480V to 240 V can be used (Ref. job 1058).

# Cable Selection
TLP motors require separate power and feedback cables from Allen Bradley.

TLP Flex Cables Example
TLP Power: 2090-CTPW-MADF-18F10
TLP Feedback: 2090-CTFB-MADD-CFF10


VPL motors use single hybrid cables from Allen Bradley and Lutze, preferably from Lutze.


High-flex cables are required where the motor is in motion e.g. the vertical axis of the standard SDC PNP

# Drive Selection
## Kinetix 5300 Drives (with TLP Motors)
Supports 120/240/480V AC, 1 or 3 phase
CIP Motion support via Studio 5000
Handles rollover and complex motion
Recommended for all TLP applications

## Kinetix 5500 Drives (with VPL Motors)
Supports 240/480V AC, 1 or 3 phase
Full CIP Motion and CIP Safety
Power sharing for multi-axis configurations
Recommended for all VPL applications

# PLC Selection
CIP Motion-enabled PLCs are required for both Kinetix 5300 and 5500 drives.

CompactLogix options:
5069-L310ERM(S2): 4 Axis, 24 EIP Nodes
5069-L320ERM(S2): 8 Axis, 40 EIP Nodes
5069-L330ERM(S2): 16 Axis, 60 EIP Nodes

For >16 axes, ControlLogix Options:
1756-L81E(S): 100+ Axis, 100 EIP Nodes
1756-L82E(S): 100+ Axis, 175 EIP Nodes
1756-L83E(S): 100+ Axis, 250 EIP Nodes

# Engineering Design Tips
Minimize variation: Use as few motor/drive types as possible on a given machine.
Use existing drive sizes: If one drive size is already used, reuse it for new axes where possible.
Leverage drive power sharing (5500 only): Reduce components and wiring effort in multi-axis designs.
Always consult with electrical engineering before deviating from default recommendations.

# Standard AC Motors
Use standard 3-phase 240/480V motors for any non-servo application such as conveyors etc.

