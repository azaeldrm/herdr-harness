import { look, changedHosts, machinesChanged, hostOf, endedApps } from '../layouts/harns/mods/harns-status/turns.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};
const ready = [{ name: null, layout: 'ready' }, { name: 'server', layout: 'ready' }];
const at = (list, machines = ready) => look(list.map(([address, status]) => ({ address, status })), machines);
const hosts = (before, now) => [...changedHosts(before, now)].sort();

check('addresses name their machine', [hostOf('t5'), hostOf('server/t5')], [null, 'server']);
check('the first look reads every ready machine', hosts(null, at([['t1', 'working']], [...ready, { name: 'off', layout: 'unavailable' }])), [null, 'server'].sort());
const before = at([['t1', 'working'], ['server/t5', 'working'], ['server/t6', 'idle']]);
check('nothing changed: nothing to read', hosts(before, before), []);
check('a turn ends on server: read server only', hosts(before, at([['t1', 'working'], ['server/t5', 'done'], ['server/t6', 'idle']])), ['server']);
check('still working, or done turning idle: no read', hosts(before, at([['t1', 'working'], ['server/t5', 'working'], ['server/t6', 'done']])), []);
check('an agent starts on this computer', hosts(before, at([['t1', 'working'], ['t2', 'idle'], ['server/t5', 'working'], ['server/t6', 'idle']])), [null]);
check('an agent goes away on server', hosts(before, at([['t1', 'working'], ['server/t5', 'working']])), ['server']);
check('a machine comes online', hosts(at([['t1', 'working']], [{ name: null, layout: 'ready' }, { name: 'server', layout: 'loading' }]), at([['t1', 'working']])), ['server']);
check('machine states: unchanged, then one lost', [machinesChanged(before, before), machinesChanged(before, at([], [{ name: null, layout: 'ready' }, { name: 'server', layout: 'unavailable' }]))], [false, true]);
const agent = (address, status, app) => ({ address, status, app });
const working = look([agent('t1', 'working', 'claude-code'), agent('h/t2', 'working', 'codex'), agent('t3', 'working', 'pi'), agent('t4', 'idle', 'codex')], []);
const later = look([agent('t1', 'done', 'claude-code'), agent('h/t2', 'working', 'codex'), agent('t3', 'blocked', 'pi'), agent('t4', 'idle', 'codex')], []);
check('the apps of agents that stopped working, and only theirs', [...endedApps(working, later)].sort(), ['claude-code', 'pi']);
check('a first look ends no turns', endedApps(null, later).size, 0);
process.exit(failed ? 1 : 0);
