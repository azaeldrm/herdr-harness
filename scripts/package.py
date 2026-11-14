"""Builds every share folder's mods/ from src/: each listing gets a copy of the mods it ships, with the shared code and
art they need copied in. src/ is the only place to edit; a listing's mods/ is generated (and committed, since herdr.dev
and an agent installing a listing read it from the repository).

    python scripts/package.py           write them
    python scripts/package.py --check   fail if any is stale (npm test runs this)
"""
import json
import re
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

ICONS = SHARED / 'icons'


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')


IMPORT = re.compile(r"""(?:from\s*|import\s*\(\s*)["'](\.{1,2}/[^"']+\.js)["']""")


def share_imports(dest):
    """Copies in each file of src/shared that the mod imports but doesn't have (`./layout.js`, `../hash.js` from a
    subfolder: always the mod's own top folder), then what those import, until nothing is missing. So a mod carries
    exactly the shared code it uses."""
    while True:
        wanted = set()
        for js in dest.rglob('*.js'):
            if 'vendor' in js.relative_to(dest).parts:
                continue
            for rel in IMPORT.findall(js.read_text(encoding='utf-8')):
                target = (js.parent / rel).resolve()
                if not target.exists() and target.parent == dest.resolve() and (SHARED / target.name).is_file():
                    wanted.add(target.name)
        if not wanted:
            return
        for name in wanted:
            shutil.copy2(SHARED / name, dest / name)


def icon_names(template, available):
    """The icons an icon path's name can be: `pin` is itself; `chevron-${open ? "down" : "right"}` is each choice its
    expression spells out; a name an expression gives without spelling it (`${glyph}`) can be any icon."""
    choices = ['']
    for literal, expression in re.findall(r'([^$]*)(?:\$\{([^}]*)\})?', template):
        options = re.findall(r'"([a-z0-9-]*)"|\'([a-z0-9-]*)\'', expression) if expression else []
        if expression and not options:
            pattern = re.compile(''.join('.+' if part.startswith('${') else re.escape(part)
                                         for part in re.split(r'(\$\{[^}]*\})', template)) + '$')
            return {icon for icon in available if pattern.match(icon)}
        options = [a or b for a, b in options] if options else ['']
        choices = [c + literal + o for c in choices for o in options]
    return set(choices)


def share_icons(name, dest):
    """Copies into the mod's icons/ the icons of src/shared/icons it loads (`mods/<name>/icons/<icon>.svg`): the ones
    it names, each choice where it picks one as it runs, and all of them where it builds a name it doesn't spell out
    (`${glyph}`, or the folder kept in a constant and named elsewhere)."""
    folder = f'mods/{name}/icons'
    available = {p.stem for p in ICONS.glob('*.svg')}
    named = set()
    for js in dest.rglob('*.js'):
        if 'vendor' in js.relative_to(dest).parts:
            continue
        text = js.read_text(encoding='utf-8')
        for at in re.finditer(re.escape(folder), text):
            path = re.match(r'/((?:[^\n`"\'$]|\$\{[^}]*\})+?)\.svg', text[at.end():])
            named |= icon_names(path.group(1), available) if path else available
    icons = [ICONS / f'{icon}.svg' for icon in sorted(named)]
    for icon in icons:
        if not icon.is_file():
            sys.exit(f'{name} loads {folder}/{icon.name}, which src/shared/icons does not have')
        (dest / 'icons').mkdir(exist_ok=True)
        shutil.copy2(icon, dest / 'icons' / icon.name)


def build_mod(name, dest):
    """One mod as it ships: its src/ folder, the shared code it imports, and what it takes from src/shared besides."""
    shutil.copytree(SRC / name, dest, ignore=SKIP)
    share_imports(dest)
    share_icons(name, dest)
    if name == 'machine-agents':
        # It draws its machines' stats icons and rings from its own stats/ folder, and reads Claude's and Pi's context
        # with the relay's own Python (context-relay.py's collect()), embedded as text.
        shutil.copytree(SHARED / 'rings', dest / 'stats' / 'rings')
        for icon in ('cpu.svg', 'ram.svg', 'gpu.svg', 'board.svg', 'usage.svg'):
            shutil.copy2(SHARED / icon, dest / 'stats' / icon)
        probe = (REPO / 'scripts' / 'context-relay.py').read_text(encoding='utf-8')
        write(dest / 'context-probe.js', 'export const contextProbe = ' + json.dumps(probe) + ';\n')


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
