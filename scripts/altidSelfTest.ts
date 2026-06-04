// Node-only dev harness: compile via tsconfig.altid.json, then run with node.
declare const process: { exit(code: number): void };

import { runSelfTest } from '../src/altid/selfTest';

const result = runSelfTest();
for (const c of result.checks) {
  const mark = c.pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${c.name}${c.detail && !c.pass ? '  -> ' + c.detail : ''}`);
}
console.log('\n' + (result.pass ? 'ALL CHECKS PASSED ✅' : 'SELF-TEST FAILED ❌'));
process.exit(result.pass ? 0 : 1);
