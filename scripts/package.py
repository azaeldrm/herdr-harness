"""Builds every share folder's mods/ from src/: each listing gets a copy of the mods it ships, with the shared code and
art they need copied in. src/ is the only place to edit; a listing's mods/ is generated (and committed, since herdr.dev
and an agent installing a listing read it from the repository).

    python scripts/package.py           write them
    python scripts/package.py --check   fail if any is stale (npm test runs this)
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / 'src'
SHARED = SRC / 'shared'

# Each share folder and the mods it ships.
LISTINGS = {
    'layouts/harns': ['harness-chrome', 'harness-tabs', 'harness-settings', 'harness-files', 'harness-simulator',
                      'machine-agents', 'workspace-status-machine', 'herdr-chat'],
    'layouts/herdr-chat': ['herdr-chat'],
}

# Editor files and caches never ship.
SKIP = shutil.ignore_patterns('__pycache__', '*.pyc', 'gpui-kit.d.ts', 'jsconfig.json', '*.error')

# The working spinner (an idle agent shows its context as a bar). It has a clear margin (a 30-unit square around the
# 24): herdr turns it as a picture, and a turned square's corners reach past it, where they'd pick up whatever icon lies
# next to it.
SPINNER = ('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="-3 -3 30 30" fill="none" '
           'stroke="currentColor" stroke-width="3.2" stroke-linecap="round">'
           '<circle cx="12" cy="12" r="9.4" stroke-opacity="0.24"/><path d="M12 2.6a9.4 9.4 0 0 1 9.4 9.4"/></svg>\n')


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')


def build_mod(name, dest):
    """One mod as it ships: its src/ folder, then what it takes from src/shared."""
    shutil.copytree(SRC / name, dest, ignore=SKIP)
    if name == 'machine-agents':
        # The agents list reads machines itself (its rings, hover card and what it runs on), and draws their icons and
        # rings from its own stats/ folder.
        shutil.copy2(SHARED / 'machine-metrics.js', dest / 'machine-metrics.js')
        for file in ('turns.js', 'details.js', 'platforms.js', 'probes.js', 'gpus.js'):
            shutil.copy2(SHARED / file, dest / file)
        shutil.copytree(SHARED / 'rings', dest / 'stats' / 'rings')
        for icon in ('cpu.svg', 'ram.svg', 'gpu.svg', 'board.svg', 'usage.svg'):
            shutil.copy2(SHARED / icon, dest / 'stats' / icon)
        probe = (REPO / 'scripts' / 'context-relay.py').read_text(encoding='utf-8')
        write(dest / 'context-probe.js', 'export const contextProbe = ' + json.dumps(probe) + ';\n')
        write(dest / 'context-rings' / 'spinner.svg', SPINNER)
    if name == 'workspace-status-machine':
        # The status bar reads the focused machine's figures and the accounts' quota with the same probes.
        shutil.copy2(SHARED / 'main.js', dest / 'machine-data.js')
        for file in ('probes.js', 'platforms.js', 'gpus.js', 'usage.js', 'turns.js'):
            shutil.copy2(SHARED / file, dest / file)


def build(into):
    """Every listing's mods/ under `into` (a folder standing for the repository)."""
    for listing, mods in LISTINGS.items():
        for name in mods:
            build_mod(name, into / listing / 'mods' / name)


def files(folder):
    # A built mod's files, without the editor files and caches `herdr-app check` and Python leave (gitignored).
    junk = lambda p: p.name in ('gpui-kit.d.ts', 'jsconfig.json') or p.suffix in ('.pyc', '.error') or '__pycache__' in p.parts
    return {p.relative_to(folder).as_posix(): p for p in folder.rglob('*') if p.is_file() and not junk(p)} if folder.is_dir() else {}


def same(a, b):
    # Compared as committed: text without the line endings a checkout may add; vendored copies byte for byte.
    x, y = a.read_bytes(), b.read_bytes()
    return x == y or (b'\0' not in x[:1024] and x.replace(b'\r\n', b'\n') == y.replace(b'\r\n', b'\n'))


def main():
    check = '--check' in sys.argv[1:]
    with tempfile.TemporaryDirectory() as directory:
        fresh = Path(directory)
        build(fresh)
        stale = []
        for listing in LISTINGS:
            want, have = files(fresh / listing / 'mods'), files(REPO / listing / 'mods')
            stale += [f'{listing}/mods/{name}' for name in sorted(set(want) | set(have))
                      if name not in want or name not in have or not same(want[name], have[name])]
        if check:
            if stale:
                print('Share folders out of date with src/ (run python scripts/package.py):\n  ' + '\n  '.join(stale[:20])
                      + (f'\n  ...and {len(stale) - 20} more' if len(stale) > 20 else ''), file=sys.stderr)
                sys.exit(1)
            print(f'Share folders match src/: {", ".join(LISTINGS)}')
            return
        for listing in LISTINGS:
            target = REPO / listing / 'mods'
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(fresh / listing / 'mods', target)
        print(f'Built {", ".join(LISTINGS)}' + (f' ({len(stale)} files changed)' if stale else ' (no changes)'))


if __name__ == '__main__':
    main()
