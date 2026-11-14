// The stats and account probes, run the way each platform runs them: the Python probes on
// Linux and macOS (the machines that use them), the PowerShell probes on Windows.
import { linuxProbe, macosProbe, pythonAccountProbe, windowsProbe, windowsAccountProbe } from '../layouts/harns/mods/harns-status/probes.js';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${detail}`}`); if (!ok) failed++; };
const windows = process.platform === 'win32';

// A stand-in for `codex app-server`, in Node so it runs anywhere this test does.
const bin = mkdtempSync(join(tmpdir(), 'harness-codex-'));
writeFileSync(join(bin, 'codex.mjs'), `
import { createInterface } from 'readline';
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === 'initialize') console.log(JSON.stringify({ id: m.id, result: {} }));
  else if (m.method === 'account/rateLimits/read') {
    console.log(JSON.stringify({ method: 'some/notification', params: {} }));
    console.log(JSON.stringify({ id: m.id, result: { rateLimits: {
      primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 100 },
      secondary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: 900 } } } }));
  }
}
`);
if (windows) writeFileSync(join(bin, 'codex.cmd'), `@"${process.execPath}" "%~dp0codex.mjs" %*\r\n`);
else {
  writeFileSync(join(bin, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/codex.mjs" "$@"\n`);
  chmodSync(join(bin, 'codex'), 0o755);
}
const home = mkdtempSync(join(tmpdir(), 'harness-probe-'));

let run;
if (windows) {
  // Only Windows' own folders on PATH, so a codex installed here isn't found.
  const root = process.env.SystemRoot || 'C:\\Windows';
  const system = [`${root}\\System32`, root, `${root}\\System32\\WindowsPowerShell\\v1.0`];
  run = (script, withCodex) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { SystemRoot: root, USERPROFILE: home, PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: [withCodex ? bin : null, ...system].filter(Boolean).join(';') },
    stdio: ['ignore', 'pipe', 'ignore'] }).toString());
} else {
  // Python 3 under whichever name this system gives it.
  const python = [['python3'], ['python'], ['py', '-3']].find(([exe, ...args]) =>
    spawnSync(exe, [...args, '-c', 'import sys; sys.exit(sys.version_info[0] != 3)']).status === 0);
  if (!python) { console.log('FAIL Python 3 is needed for these probes (python3, python or py -3)'); process.exit(1); }
  const [exe, ...args] = python;
  run = (script, withCodex) => JSON.parse(execFileSync(exe, [...args, '-c', script], {
    env: { HOME: home, PATH: [withCodex ? bin : null, '/usr/bin', '/bin'].filter(Boolean).join(':'), SHELL: '/bin/false' } }).toString());
}
const accountProbe = windows ? windowsAccountProbe : pythonAccountProbe;

const out = run(accountProbe(['Claude', 'Codex']), true);
check('Codex: the account limits app-server reports, by window length',
  JSON.stringify(out.Codex) === JSON.stringify({ fiveHour: { used: 10, resetsAt: 100 }, sevenDay: { used: 3, resetsAt: 900 } }), JSON.stringify(out.Codex));
check('Claude with no login here: signed out, and no request made', out.Claude?.error === 'Signed out', JSON.stringify(out.Claude));

const none = run(accountProbe(['Codex']), false);
check('no codex anywhere: not installed', JSON.stringify(none) === JSON.stringify({ Codex: { error: 'Not installed' } }), JSON.stringify(none));
const one = run(accountProbe(['Codex']), true);
check('only the services asked for', Object.keys(one).join() === 'Codex', JSON.stringify(one));

const stats = run(windows ? windowsProbe([]) : process.platform === 'darwin' ? macosProbe([]) : linuxProbe([]), false);
check('the stats probe reads stats only', typeof stats.memory === 'number' && !('usage' in stats), JSON.stringify(stats).slice(0, 120));
process.exit(failed ? 1 : 0);
