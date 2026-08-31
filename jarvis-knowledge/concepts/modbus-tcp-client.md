# Modbus Tcp Client — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)


## Modbus TCP Client AOI (Rockwell, v2.02.00) — integration rules (2026-08-30)

When a station/machine needs to poll or write to a third-party Modbus TCP device (e.g. a vendor PLC, VFD, or sensor package that only speaks Modbus), SDC uses Rockwell's pre-built Modbus TCP Client AOI rather than hand-rolling MSG instructions.

**Implementation rule (hard constraint):** the AOI rung must be added via *Import Rungs* only. Copy/paste or dragging the instruction in from the toolbar silently strips the pre-configured Message instruction parameters, leaving a non-functional AOI. Any rename of tags/prefix must happen during the import's Find/Replace step — never rename tags after the rung is placed.

**Task placement:** runs in a Periodic task, 10ms recommended (slower reduces controller load but reduces polling performance; faster increases load).

**Function code coverage:** 01 Read Coils, 02 Read Discrete Inputs, 05 Write Single Coil, 15 Write Multiple Coils (bit-level, 0xxxx/1xxxx addresses); 03 Read Holding Registers, 04 Read Input Registers, 06 Write Single Holding Register, 16 Write Multiple Holding Registers (word-level, 3xxxx/4xxxx addresses). Address range 0-65535 local/server, up to 256 coils or 120 registers per transaction. Protocol is big-endian (MSB first).

**Transaction config per data point:** PollInterval (ms, min 80ms — anything faster silently falls back to 1000ms), TransType (function code), Station ID/UID (usually 0, unless the specific server requires it — values 128-255 must be entered in hex), BeginAddress (remote Modbus address), Count, LocalAddress (offset into the AOI's local `_Data` array), and an `.Enabled` bit that must be set to actually start polling.

**Health monitoring — always wire these to alarms/HMI when integrating a Modbus device:** Sts_EN (client enabled), Sts_Connected (TCP handshake accepted — NOT proof of active data exchange, check individual transactions for that), Sts_Faulted (a Message instruction faulted), Sts_Overlap (a transaction didn't finish before its next poll trigger — usually means PollInterval is a bit too aggressive, system still works), Sts_Overload (chronic overlap — system will NOT work reliably, PollInterval must be relaxed). Per-transaction TransStatus: 0=success, 1=in process, 2=retry, -1=exception; TransComplete pulses when a transaction lands and must be cleared by user logic before the next request.

**Multi-instance / multi-device stations:** one AOI instance per remote Modbus server. Each instance needs its own backing tags and Message tags, but the `_Data` structure holding actual coil/register values can be shared across instances if useful. Memory: ~93KB for the first instance, ~20KB each additional — worth checking on CompactLogix controllers with small (384KB) memory budgets before stacking many Modbus-connected devices onto one controller.

**Redundancy note:** in a ControlLogix redundant chassis, expect at least a 5-second loss of Modbus comms after a controller switchover — factor into fault-tolerance expectations for any Modbus-dependent handshake.

_Source: Modbus TCP Client - AOI based code for ControlLogix v 2.02.00.pdf (network: Standards - Software), ingested 2026-08-30 by the inbox librarian._
