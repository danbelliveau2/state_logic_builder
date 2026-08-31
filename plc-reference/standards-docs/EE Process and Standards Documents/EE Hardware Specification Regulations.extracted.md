## Introduction
This is a list of rules and regulations that should be followed when selecting hardware for new builds. Duplicate machines or other exceptions may grandfather in old standards, but the best effort should be made to follow these procedures.

## Control Architecture
- Allen-Bradley shall be the SDC default PLC
- Projects using AB control shall use Compact Guard Logix or Guard Logix for safety functionality
## Safety
- Banner safety expansion relays shall be used for contact expansion, not Omron safety relays
- Banner safety expansion relays shall be wired in bipolar mode.
- Keyence safety PLCs shall only be used on non-AB projects, example: First Solar
- Guard door switches shall be Keyence GS-M51P.
### IO
- The SMC EX600 should be our primary platform for on machine I/O, not I/O Link.  The EX600 has an I/O Link module to handle any needs.
### DC Power Supplies
- 24VDC power supplies shall be Puls CP series.  The most common used part numbers will CP5.241 (5A), CP10.241 (10A), and CP20.241 (20A).
### Circuit Breakers
- Circuit Breakers shall be Noark
### Servo
- AB servo drives shall be 5300 or 5500 series drives. 5100 series drives can be used on a case-by-case basis. Examples include: An already purchased PLC is out of available motion axes and requires more, cost reduction for many repeated simple motion applications, repeat jobs.