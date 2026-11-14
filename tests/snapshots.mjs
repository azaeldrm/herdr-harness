import { newestSnapshots } from '../layouts/harns/mods/machine-sidebar/snapshots.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};
const snap = (address, percent, updatedAt, tool = 'claude') => JSON.stringify({ address, tool, percent, updatedAt });

check('one per terminal, the newest', newestSnapshots([snap('t1', 40, 1), snap('t1', 55, 2, 'pi'), snap('t2', 72, 1)]),
  { t1: JSON.parse(snap('t1', 55, 2, 'pi')), t2: JSON.parse(snap('t2', 72, 1)) });
check('0% is a reading', Object.keys(newestSnapshots([snap('t1', 0, 1)])), ['t1']);
check('unknown, unreadable or half-written ones are left out', newestSnapshots([snap('t1', null, 1), '', '{"address":', 'null', '{"percent": 5}']), {});
process.exit(failed ? 1 : 0);
