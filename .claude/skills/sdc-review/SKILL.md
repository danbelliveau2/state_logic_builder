---
name: sdc-review
description: Review a built L5X against the SDC standard and the CE's rulings — standards and devices only, every finding backed by the quoted rung, adversarially verified, then fixed. Use before sending code to the CE or when asked to check the code.
---

Scope: does the code follow the SDC standard and use the right devices. Never judge sequence intent; never redesign.

1. Sources, in order: the job's NAMES CONTRACT (`X:\Electrical Dept\SDC Engineer\Deliveries\<job>\build-inputs\build\NAMES_CONTRACT.md`), the CE's `## Engineer additions`, `X:\Electrical Dept\SDC Engineer\Playbook\PLAYBOOK.md` §7, the example programs the contract names.
2. Auditors by program family (listeners · state machines · servo/heat/services). A finding must quote the rung text verbatim and the example rung it contradicts. "I would do it differently" is not a finding.
3. One skeptic per finding, prompted to refute. Only confirmed findings are fixed.
4. One fixer per program with confirmed findings; minimal edits; the shape checker must print 0 before it returns. Twins regenerate by script.
5. Estimate cost from the expected finding count (about $2.50 per finding for the skeptic step) and say it before running.
6. Re-assemble, re-validate, re-deliver; the cover note's revision history gets a row.
