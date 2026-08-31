


Pneumatic Standardization Selection Guide


Rev: 02
Last Revised: Thursday, July 10, 2025


Contents

1.	Introduction	3
2.	Safety Zoning	3
3.	Air Prep Unit	3
4.	Valve Selection	3
5.	Standalone Valves	4
6.	Sandwich Regulators	4
7.	Machine Mounted Regulators	4
8.	EX600 Valve Bank Configuration	4
9.	EX260 Valve Bank Configuration	5
10.	Vacuum Generators	5
11.	Tubing & Fittings	5
12.	Document Change Summary	6


# Introduction
The goal of this document is to provide general pneumatic design guidelines, as well as standard component selection.  SDC has standardized on SMC for all pneumatics.  All part numbers listed in this document are SMC unless noted otherwise.

# Safety Zoning
It is important to identify the number of safety zones on a machine as the first step of the pneumatic design process.  The majority of SDC machines will have one safety zone, requiring one air prep unit and a couple of valve banks.  Larger machines, such as HP job 1058, will have several zones, requiring multiple air prep units and many valve banks. Use 3-position center exhaust valves for safe depressurization. Consider pressure-sensing logic for interlocks. Refer to ISO 4414: Primary standard for design and safety of pneumatic systems.

# Air Prep Unit
Each machine utilizing air pressure requires an air prep unit.  The air prep unit must consist of the following items:
- Manual lockout
- Filter/Regulator Combo w/Gauge
- 24VDC Soft Start Dump Valve
- ISE40 Digital Pressure Switch, 2 PNP Outputs

The size selection of the air prep unit is determined by the total air consumption of the machine.  The Engineer must calculate the total air consumption of all pneumatic actuators, plus a 20% safety factor, to properly select.  Below are the standard part numbers for SMC air prep assemblies:
- ¼” NPT:  HHB-171052
- 3/8” NPT:  HHB-171054
- ½” NPT:  HHB-175473
- ¾” NPT:  HHB-171057
- 1” NPT:  HHB-171058

# Valve Selection
SMC offers three different sizes of valves with increasing flow capacity as the number increases:  SY3000, SY5000, and SY7000.  The Engineer must determine the appropriate size valve based upon the actuator flow demand and response time.  For the purpose of this document, the SY3000 part numbers will be presented as examples.
- SY3100-5U1-NA:  5 port, 2 position spring return solenoid valve, 24VDC w/Light & Surge Voltage Suppressor, Non-Polar
- Application examples:  Air knife, feeder bowl air supply, venturi
- SY3200-5U1-NA:  5 port, 2 position double solenoid valve, 24VDC w/Light & Surge Voltage Suppressor, Non-Polar
- Application examples:  Horizontal motion, such as PNP horizontal axis, grippers
- SY3300-5U1-NA:  5 port, 3 position center blocked solenoid valve, 24VDC w/Light & Surge Voltage Suppressor, Non-Polar
- Application examples:  Vertical motion, such as PNP vertical axis
- SY3400-5U1-NA:  5 port, 3 position center exhaust solenoid valve, 24VDC w/Light & Surge Voltage Suppressor, Non-Polar
- Application examples:  Typically used to release pressure of an actuator in an advanced safety application.  These valves were used on the HP job 1058 Tote Unstacker extraction cylinders.

# Standalone Valves
Standalone valves should be used in the following applications:
- Control of robot gripper if no internal solenoids present
- Fanuc robots can be ordered with internal solenoid valves.
- Epson robots cannot be ordered with internal solenoid valves.
- Actuator requiring high speed control with the valve wired directly to a PLC output module.

As an example, the valve part numbers listed in the Valve Selection section can be used with the following mounting base:
- SY30M-27-1-WO-01N:  SY3000 standalone valve mounting base with M12 electrical connection.

# Sandwich Regulators
Sandwich style regulators are available for the SY series of valves.  There are many options available depending on the application.  Part numbers can be configured by following this link:
https://www.smcusa.com/products/sy-interface-regulator~165305

Example part number:
- SY30M-N5-A1-NA:  SY3000 series, pressure gauge w/psi display for odd numbered station, A port regulated, for single, double, and four position.

# Machine Mounted Regulators
There are many types of machine mounted regulators available depending on the application.  Part numbers can be configured by following this link:
https://www.smcusa.com/products/ar20-d-to-ar60-d-regulator-regulator-w-backflow-function~165155

Example part number:
- AR20K-N01-Z-D:  Regulator, size 20 body, 1/8NPT, built-in gauge, 0.05 to 0.85Mpa
- AR23P-270AS:  Bracket for size 20 AR-D regulator
- AR23P-260S:  Set nut for size 20 AR-D regulator

# EX600 Valve Bank Configuration
The EX600 family is one of the two primary SDC solutions for valve banks.  The EX600 can support up to nine I/O modules and sixteen valves.  The standard part numbers for the I/O modules are listed below:
- EX600-SEN7:  Ethernet IP module with integrated two port switch.  NOTE:  This module is required.
- EX600-ED2:  Five pin M12 power connection module.  This module is required.
- EX600-DXPC:  Eight port 24VDC PNP input module with three pin M8 connections.  The total quantity of this module is based upon the I/O requirements of the machine.
- EX600-DYPB:  Four port 24VDC PNP output module with two outputs per port.  Connection type is five pin M12.  Used when controlling a vacuum generator.  The total quantity of this module is based upon the I/O requirements of the machine.
- EX600-DYPE:  Sixteen point 24VDC PNP digital output module with 25 pin DSUB connection.  Used when connecting to an expansion valve bank.  The total quantity of this module is based upon the I/O requirements of the machine.

Below is an example valve bank configuration.  This information should be sent to HH Barnum Inside Sales, who will then provide a HHB part number along with a solid model.

New Valve Bank (12 Station, 9 valves, 3 blanks with Ethernet IP and 24 digital inputs)
(1) EX600-SEN7
(1) EX600-ED2
(3) EX600-DXPC
Valves 1-3, 5-9: SY3200-5U1-NA with 6mm fittings
Valve 4: SY3100-5U1-NA with 4mm fittings
Valves 10-12: Blank

# EX260 Valve Bank Configuration
The EX260 family is used when an I/O Link solution is present on the machine.  This family supports the SY series of valves, but does not support any expansion I/O modules.  The following I/O Link master module should be used:
EX260-SIL1

Below is an example valve bank configuration.  This information should be sent to HH Barnum Inside Sales, who will then provide a HHB part number along with a solid model.

New Valve Bank (12 Station, 9 valves, 3 blanks with I/O Link)
(1) EX260-SIL1
Valves 1-3, 5-9: SY3200-5U1 with 6mm fittings
Valve 4: SY3100-5U1 with 4mm fittings
Valves 10-12: Blank

# Vacuum Generators
There are two primary SDC solutions for vacuum generators.  One is an electronic generator with an integrated vacuum switch.  The other is a venturi with a standalone vacuum switch.  The Engineer must size the vacuum generator and select the appropriate technology for the application.

The family of electronic generators used is SMC ZK2.  Below is an example part number:
ZK2G15R5CLA-06-BK:  Vacuum Generator, High Noise Reduction, Self-Holding Linked Release Valve w/Pressure Switch

The family of venturi’s used is SMC ZH.  Below is an example part number:
ZH05DSA-06-06-06:  Vacuum Generator, 0.5mm Nozzle, 6mm Sup/Vac/Exh fittings, with bracket
AN10-C06:  Silencer, 6mm One-Touch Fitting
Coval PSK100D6M8:  Vacuum Switch, M8 3 pin cable, 6mm plug-in connection

# Tubing & Fittings
• Use flexible polyurethane or nylon tubing / • Avoid excessive bends and tubing lengths / • Color-code tubing (e.g., blue = supply, black = exhaust, red = signal)

# Document Change Summary
| Rev | Effective Date | Author(s) | Description of Change |
|---|---|---|---|
| 01 | 7/2/2025 | Jagtar Singh, / Jason Perry, / Ian Milne | Initial Draft |
| 02 | 7/10/2025 | Jason Perry | -Replaced the part numbers in Section 3 (“Air Prep Unit”) / -Added the “Document Change Summary” section |
