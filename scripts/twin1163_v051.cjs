'use strict';
// v0.5.1: Jason's corrected copy of 0.5 becomes the delivery; one twin leftover fixed
// (Downstream Status .STATE[52] operand comment still read "Stop Drive Open Gripper"; Upstream says "Open Gripper").
const fs = require('fs');
const src = 'C:/1163 AI Code/_1163_Haemonetics.L5X';
const out = 'X:/Electrical Dept/SDC Engineer/Deliveries/1163/1163_Haemonetics.L5X';
let x = fs.readFileSync(src, 'utf8');
const re = /(<Program Name="L2_S01_TubeFeedDownstream"[\s\S]*?<Comment Operand="\.STATE\[52\]">\r?\n<!\[CDATA\[)Stop Drive Open Gripper(\]\]>)/;
if (!re.test(x)) { console.error('Downstream STATE[52] comment not found'); process.exit(1); }
x = x.replace(re, '$1Open Gripper$2');
const n = (x.match(/<!\[CDATA\[Stop Drive Open Gripper\]\]>/g) || []).length;
if (n !== 0) { console.error('leftover count ' + n); process.exit(1); }
fs.writeFileSync(out, x);
console.log('written ' + out + ' (' + x.length + ' chars)');
