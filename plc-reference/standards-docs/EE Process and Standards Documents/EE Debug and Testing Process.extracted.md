## Introduction
This is a general flow of how machine debug should be conducted and approximately in what order. Items might be skipped and/or partially completed to come back to later, or worked on concurrently with other items as the situation dictates. Some items may not be applicable for every machine.

- Initial Machine Inspection
☐ Power Supply
- Verify the machine is receiving proper voltage (verify with electrician).
- Check for any blown fuses or tripped breakers.
☐Machine Orientation Fit and Finish (verify with ME and/or builder)
- Ensure the machine is correctly positioned and aligned on the floor).
- Confirm all leveling feet are properly adjusted.
- Evaluate alignment, leveling, and fit of all stations.
- Pay special attention to stations that interact with each other or are collision hazards.
- Check all belt tension.

- Control System Initialization

☐Power Up Control Devices
- Load firmware.
- Set IP addresses.
- Load programs.
- Check communications
☐Commission Safety
- Check all input circuits for functionality. Make sure to toggle each device separately.
- Check output circuits for functionality and confirm safety works as intended.
- Bypass circuits as necessary ensuring that the DANGER signage is prominently posted.
- Any mounted Estop buttons must be functional, no bypasses allowed.
☐Check IO and Pneumatics
- Toggle all IO and verify it functions and is read/written correctly from PLC tags.
- Check for NO and NC inputs and polarity of outputs.
- Put air on the machine and check for leaks.
- Adjust pressure and flow controls as appropriate optimizing for cycle time and smooth operation.
☐Motion System Verification
- Tune servos.
- Home servos.
- Ensure proper scaling and motion polarity.
- Check for coupling issues, vibration, and interferences.
- Set torque limits to 50% as an initial value. If you get torque faults during debug, investigate and increase as necessary. Once the machine is running in full auto and meeting cycle, set this value approximately 20% over the max actual value.
☐Machine Controls Setup
- Calibrate applicable devices.
- Input starting setup parameters into the machine. Examples:
- Servo motion parameters like speed, accel and decel.
- Motion axis defined positions.
- Verify all motion permissives. (Example: z axis is retracted before x axis motion is allowed)
- Programmable sensor setup.
- IO link or analog data configuration.
- Known recipe parameters for the part that will be run first.
☐HMI Testing
- Verify screens are accessible.
- Check all tag connections are properly made.
- Check that buttons perform the desired outcome.
☐Test All Manual Functions Via the HMI
- Make sure to set servo speeds to start out slow.
☐Test Machine Operations with Manual Functions
- Where possible, test any machine operations with manual functions to verify the mechanics function as intended.
- Make any adjustments mechanical or electrical if issues are discovered.
☐Test Machine Subsystem Operations with Automatic Functions
- Set speeds slow.
- Test subsystems separately using a “single step” and “dry run” style approach (if possible) to verify the sequence.
- Once a subsystem passes the single step approach, test the system using a “full auto, dry run” approach. Limit the machine to one subsystem at a time (or the smallest multiple if they need to work together).
- After “full auto” is passed on a subsystem, slowly increase the speed until at least the point where the machine will meet cycle time or better.
- After dry run functionality is proven out. Restart the process with real parts.
- Perform fault checkout.
- Make sure all messages are configured and useful.
- Note any high occurrence or particularly disruptive faults and diagnose root causes, provide proactive fixes, or pursue design change when appropriate.
- Add retry logic, automatic recovery, or automatic reject to increase machine uptime
- Make any adjustments mechanical or electrical if issues are discovered.
- As part of this process, define a set of “slow speed” setpoints for automatic mode along with the “running speed” setpoints. This makes toggling between fast and slow easy.
☐Test Full Machine Operations with Automatic Functions
- Use the same approach for testing subsystems to now test the full machine operation.
- Full safety system operation must be in place once core machine functions are proven out.
- Verify any required performance metrics are being calculated and displayed correctly.
- Setup remote access if applicable.
- Check for overlooked safety hazards.
- Remove unused tags, debug bits, AFI instructions, or temporary code.
☐Apply machine labels (Electrician Executes, Engineer Checks)
- Machine labels
- LOTO labels
- Disconnect and voltage info/warning labels
- Pinch point labels
- Laser light warning labels
- Any other applicable labels
☐Update Electrical and Mechanical Documentation.
- Update panel layout to match actual layout.
- Update drawings to match redlined version.
- Update BOM to match actual machine.
- Add any calibration procedures.
- Take backups of all software in “as shipped” condition.
