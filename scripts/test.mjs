// Every test, on Windows, Linux or macOS: `npm test`.
// Python 3 goes by different names: python3 on Linux and macOS; on Windows, python (when the
// installer put it on PATH) or the py launcher. Windows' python3 is often the Microsoft Store
// placeholder, which exists but doesn't run, so each name is tried, not just looked up.
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const python = [['python3'], ['python'], ['py', '-3']].find(([exe, ...args]) =>
  spawnSync(exe, [...args, '-c', 'import sys; sys.exit(sys.version_info[0] != 3)']).status === 0);

// The Node tests: the machine sidebar and status bar's (usage ... os-icons), then the chat's.
const node = ['usage', 'turns', 'probes', 'snapshots', 'markdown', 'simulator', 'os-icons', 'assets',
  'sweep', 'backdrop', 'diagrams', 'copy', 'caret', 'retracted', 'runs-with', 'codex-daemon', 'previews', 'skills', 'sessions',
  'read-cue', 'fold', 'measure', 'drafts', 'focus', 'prompts', 'harnesses', 'structure'];
// The chat's Python tests run as scripts (the unittest ones are the test_*.py files).
const scripts = ['steering', 'codex-logs', 'opencode', 'session-pick', 'images', 'reader_names', 'process-tree',
  'claude-config-dir', 'codex-daemon', 'skills', 'step-row', 'prompt-keys'];

// The chat's tests that need Linux or macOS (Unix sockets, a pseudo-terminal, Unix tools): skipped on Windows, said so.
const unixOnly = new Set(['steering.py', 'images.py', 'codex-daemon.py', 'skills.py', 'step-row.py', 'sessions.mjs']);
const here = name => process.platform !== 'win32' || !unixOnly.has(name);

const steps = [
  python ? ['Python tests', python[0], [...python.slice(1), '-m', 'unittest', 'discover', '-s', 'tests']] : null,
  ...(python ? scripts.filter(t => here(`${t}.py`)).map(t => [`tests/${t}.py`, python[0], [...python.slice(1), `tests/${t}.py`]]) : []),
  ...node.filter(t => here(`${t}.mjs`)).map(t => [`tests/${t}.mjs`, process.execPath, [`tests/${t}.mjs`]]),
  ['Pele matches its pin', process.execPath, ['scripts/vendor-pele.mjs', '--check']],
].filter(Boolean);

// The tests load the listings' built mods (what ships), so those must be built from the current src/ first.
if (python && spawnSync(python[0], [...python.slice(1), 'scripts/package.py', '--check'], { cwd: repo, stdio: 'inherit' }).status !== 0) {
  console.log('\nThe tests run on the built listings: run python scripts/package.py, then npm test again.');
  process.exit(1);
}

const failed = python ? [] : ['Python tests (Python 3 not found as python3, python or py -3)'];
if (process.platform === 'win32') console.log(`Skipped on Windows (Linux and macOS only): ${[...unixOnly].map(t => `tests/${t}`).join(', ')}`);
for (const [name, exe, args] of steps) {
  console.log(`\n== ${name}`);
  if (spawnSync(exe, args, { cwd: repo, stdio: 'inherit' }).status !== 0) failed.push(name);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : '\nAll tests passed.');
process.exit(failed.length ? 1 : 0);
