# SDC TECHNICAL NOTE

Engineer Name: Ivan Galvez
Date: 02/17/2026
Machine Number: 1125
Machine Name: Panduit Foil Applicator

# PROBLEM DESCRIPTION
Brief Description of Problem:
At first I was getting faults when jogging one of my servos in any direction (FoilXfer axis). Jason and I checked all the setup was identical to 949 and while doing this we noticed this parameter:


Apparently this Alignment and Offset configuration under the Commutation setup, was given by Rockwell because the original project was programmed on Studio 5000 V33 and at the time, there was no profile for the motor we used so we needed to enter these values manually.

Now, in the new project we are using Studio 5000 V37 which already has the library/profile of the motor so we don’t need to enter any extra values manually.


System/Component Affected:

Problem Symptoms:
When the Commutation parameters were changed to match the configuration of all the other servos this fault came up on the drive: /  / Kinetix 5500: FLT S04 commutation not configured
/  / Note: At first we were not getting this FLT S04 commutation not configured, at first we could not move the servo and the fault were:

/  / So we could simply not move the motor, modified the commutation parameters we started seeing the fault FLT S04 commutation not configured which was the main problem.

# SOLUTION
Brief Description of Solution: /  / Delete the drive from both IO tree and motion axis, add again the same modules with the original names and make sure the commutation is now set to:


Redownload the program to the PLC and the drive should be good back again.


Key Actions Taken:


Parts/Components Used (if applicable):


# NOTES & LESSONS LEARNED


# ADDENDUM
☐ Photos/Diagrams
☐ Code Snippets
☐ Wiring Diagrams
☐ Other: _______________
Clip and paste or reference supporting information here:

