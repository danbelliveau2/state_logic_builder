SDC Automation — State Logic Builder / JARVIS
JARVIS’s Questions for the Controls Leads
These are the questions JARVIS (the AI controls engineer in the State Logic Builder) has accumulated while working. Answer in your own words, as you would to a sharp new senior hire — partial answers welcome, "it depends, here’s on what" is a great answer. Every answer becomes permanent knowledge JARVIS applies on all future machines.
Answered by: _______Jason Perry_____________    Date: ____8/20/26________
# Servo motion concepts
1. Mode selection judgment: given a new motion requirement, how do you decide between electronic gearing, point-to-point (MAM), and blended point-to-point? Is gearing strictly for continuously-synchronized axes (follower tied to a master), or do we also use it where a chassis/cam would have been used mechanically? A decision tree in your words is what I'm after.
Point to point motion is used when a servo axis needs to move from point A to point B with a defined motion profile.  Blending is used to round corners when two or more axes are used to control a mechanism.  Gearing is used when a slave needs to follow the position of a master, for example, when a servo controlled mechanism is tracking parts down a conveyor belt.  To replicate a mechanical cam, the MAPC electronic camming instruction is used.


2. Electronic gearing mechanics at SDC: how are gear ratios established and tuned in software — fixed ratio computed from mechanics, or tuned empirically per machine? And what instruction set do we actually standardize on — MAG for direct ratios, MAPC for position cam profiles, something else? What does the surrounding rung structure look like (engage/disengage sequencing, ratio staging, fault handling)?
Fixed ratio computed from mechanics.  The statements for use of MAG and MAPC are correct.  The MAG and MAPC are triggered as part of the state sequence logic.


3. Do we use camming (MAPC/MATC) or registration inputs (MAR) anywhere in current standards — and if so, for what class of application? If a job needs a nonlinear master/slave profile, is that an SDC-supported pattern or do we push the mechanics/vendor to solve it another way?
The MAPC instruction is used for electronic camming.  This is used as standard for our SDC chassis.  A servo driven cam rotates 360 degrees, with a servo driven dial indexing one nest per one revolution of the cam cycle.  The MAPC is used to index the dial in a defined angle range of the cam.  MAR is not part of our standard.  It is used as needed for high speed registration applications.


4. The standard axis module (the ~22-rung per-axis block): which rungs are pure boilerplate that never change, and which are the per-application ones? I read the staging rung, the wideband transition thresholds, and the permissive derivation as the application-dependent set — what else varies, and what should NEVER be touched per application?
Rungs 0,1, 3-12, and 16-20 are boilerplate.  These should never change.  All that would potentially change is the axis name if the station has multiple axes.  The remaining rungs have consistent logic, but the motion triggers for manual mode and auto mode are application dependent.


5. Blending threshold judgment: when you pick the wideband (InPosWide) distance that lets the next axis start early, what are you actually computing — worst-case clearance geometry plus margin, or a tuned-on-the-machine value? And is there a class of corners you refuse to blend on principle even when the geometry technically clears?
The worst-case clearance geometry plus margin.  When the geometry allows for blending, there is no reason not to implement.


# Vision system concepts
6. Trigger and acquisition mechanics, per camera family we actually buy (Cognex/Keyence/other): how does the PLC trigger — hardwired output, EtherNet/IP assembly bit, or explicit message? And is 'result ready' one handshake or two (acquisition complete vs. evaluation complete)? I want to model the handshake correctly per family instead of assuming the legacy four-wire q_Trigger/i_TrigRdy/i_ResultReady/i_InspPass shape everywhere.
Our standard vision system is Keyence.  In general, the trigger is via Ethernet IP.  I some high speed applications, it is necessary to hardwire the trigger.  The sequence steps for a Keyence camera are the following:  1. Wait for demand, 2. Check trigger ready, 3. Trigger Camera, 4. Wait for results, 5. Store results, 6. Acknowledge results


7. When does a vision application send coordinates versus just pass/fail? What's the judgment — is it purely 'a downstream motion needs correction', or are there cases where we take coordinates anyway (drift monitoring, SPC)? And when coordinates ARE sent, who consumes them — servo target offset, robot frame shift, or operator display only?
The vision system will send coordinates to the PLC instead of pass/fail when the application requires vision guidance for a servo system or robot.  The vision system will be returning an offset, or the actual coordinates that the servo or robot must move to.  Simple pass/fail results are used for most verification stations, for example, verifying part presence.


8. Where does vision result data live, by convention? Part tracking gets the boolean (and numerics like X_Offset in Molex), but what about the raw job outputs — do we keep a per-camera or per-job UDT, copy from the input assembly into named tags, or read on demand? What's the naming/structure you'd want a new hire to follow?
We use a standard UDT for inputs and outputs.  This has not yet been added to the standard template.


9. Motion overlap during exposure: what's the rule for what may move while the camera is exposing? Dial locked (shot pin / IndexComplete) before imaging a dial-mounted part is obvious — but do we ever image during motion (flying trigger), and how do you choose the settle time before the trigger versus the legacy fixed 50 ms dwell?
Yes, we have applications that require imaging during motion.  Our SDC Flex Feeder uses vision Fanuc robot vision guidance.  We have a current application where a tile is moving down a conveyor and triggered when a sensor is broken.  The debounce time on this sensor is 0 ms for speed.  There is a trigger delay time then entered into the camera configuration.


10. State structure per vision mode: the legacy convention compiled every inspection into 4 sub-states (verify trigger ready → settle dwell → trigger → check results). Does that skeleton hold for job-select and coordinate-feedback applications, or do those genuinely need different/extra states (job load + acknowledge, offset transfer + accept)? What's the state anatomy you'd draw for each mode?
See the answer for question 6.


11. Retry vs. route vs. fault on a failed inspection: when is a fail just 'record FAILURE to part tracking and let the reject station sort it' versus 'retry the trigger (bounded by search timeout)' versus 'fault the station'? Is the driver the process (can a retry change the answer?), the part cost, or line policy — and who sets the retry count?
We use consecutive failures for all inspections types (sensors, vision, ect.)  Our standard HMI allows the operator to change the consecutive failures set point.  For most verify stations we do not retry the camera.  For cameras controlling a process, like verifying a box close station has functioned properly, a retry may be added.


# Standards draft review
12. Jason's finding first: he saw an action commanded in the wrong state (Z move in the gripper-close state) in the generated PnP. Which rung exactly? The agent's self-checks compare code against the diagram — this case becomes a permanent automated check.

See below


13. What's the acceptance test for generated code — what makes you trust it enough to run on a machine, beyond importing clean?
Engineering audit of each line of code


14. Wideband policy: which transitions may early-advance, in one rule? (Current guess: only when the next motion can't collide with the settling axis.)
It depends on any collisions that can occur.


15. Manual servo speeds: manual/jog rungs read Accel[0]/Decel[0] (shared with auto) in the template. Intentional, or should manual have its own indices?
Intentional


16. Init-with-part: templates re-enter mid-sequence when a part is already gripped at power-up (124 + GripperClosed). What's the general rule for choosing the re-entry state on any new station?
In general, the station logic should initialize to a known location, then check if a part is gripped.  If a part is gripped, the next step will be to move to the place sequence.  If a part is not gripped, the next step will be to move to the pick sequence.


17. Fault vs warning: the rule for which conditions fault (stop) vs warn (q_Pause)? "Waiting for upstream" = warning — what else?
A warning is a condition where the machine continues to run, but the operator is alerted to a condition that may eventually cause the machine to stop.  Examples of warnings are low level of parts in feeder hoppers, low fluid level, if applicable, and equipment starved conditions like “Waiting For Upstream.”


18. q_ActuatorsSafe: the precise definition per station type. All actuators home? Or a defined safe subset per application?
Defined safe subset per application


19. Homing: when torque-home (AOI_TorqueHome) vs MAH? Who decides, and what marks a station as needing homing before auto?
Homing is the first step of setting up a servo axis.  AOI_TorqueHome is most used on linear axes where a mechanical hard stop is design into the system as the homing reference.  Could also be used on rotary axes if applicable.  MAH is used for axes with no mechanical hard stop.  A good example would be an indexing dial.


20. HMI_Toggle vs Tracking OpStatus: V4.2 sources Lockout/DryRun/SS from \Tracking...OpStatus. Is HMI_Toggle officially dead in new programs?
No, HMI_Toggle is used for any toggle on/off buttons required for the station.


21. Where should the agent ask vs. decide? Before generating, it asks a short list (devices, transitions, timeouts, handshakes). What must ALWAYS be asked, and what may it default?
This will be defined as the code generator evolves.  Very difficult question to answer right now.


# Station SDC Servo PNP — compile of Test_Project
22. What Z height (mm from Retract = 0) clears the pick nest, the place nest, and any surrounding fixtures, so the horizontal axis may start moving while Z is still rising? That value becomes the AOI_RangeCheck wide deadband on ZAxisRetract (the rounded-corner threshold and the X-axis permissive) — the template default of 5 mm is almost certainly too tight.
This will be application dependent


