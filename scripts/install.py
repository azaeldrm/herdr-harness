import json, os, re, shutil, subprocess, sys, time
from pathlib import Path

LAYOUT = 'harns'
# The harns listing's share folder: what this installs (its mods/ built from src/ by scripts/package.py).
SHARE = Path('layouts') / LAYOUT
CHAT = 'herdr-chat'
# Mods older harns installs added that harns no longer has: removed from the Herdr home. machine-stats and
# machine-metrics became code built into the mods that use them, machine-new-menu became part of machine-agents, and
# harness-pane went unused.
RETIRED = ['harness-pane', 'machine-stats', 'machine-metrics', 'machine-new-menu']


def fail(message):
    print(f'error: {message}', file=sys.stderr)
    sys.exit(1)


def find_app():
    app = shutil.which('herdr-app')
    if not app and os.name == 'nt' and os.environ.get('LOCALAPPDATA'):
        candidate = Path(os.environ['LOCALAPPDATA']) / 'Programs' / 'herdr-app' / 'herdr-app.exe'
        if candidate.exists():
            app = str(candidate)
    if not app:
        fail('herdr-app was not found. Install the Herdr app first.')
    return app


def herdr_home():
    configured = os.environ.get('HERDR_APP_HOME')
    return Path(configured) if configured else Path.home() / '.config' / 'herdr-app'


def same_folder(repo, home):
    try:
        return home.exists() and os.path.samefile(repo, home)
    except OSError:
        return False


def copy_tree(source, target):
    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, dirs_exist_ok=True)


def merge_programs(ours_path, theirs_path):
    ours = json.loads(ours_path.read_text(encoding='utf-8-sig'))
    if not theirs_path.exists():
        shutil.copy2(ours_path, theirs_path)
        return
    theirs = json.loads(theirs_path.read_text(encoding='utf-8-sig'))
    programs = theirs.get('programs')
    if not isinstance(programs, dict):
        programs = theirs['programs'] = {}
    for name, fields in ours.get('programs', {}).items():
        entry = programs.get(name)
        if not isinstance(entry, dict):
            entry = programs[name] = {}
        entry.update(fields)
    temp = theirs_path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(theirs, indent=2) + '\n', encoding='utf-8')
    temp.replace(theirs_path)


def merge_keys(ours_path, theirs_path, backup):
    """Adds the layout's keys to keys.json's layout section, each only where that keystroke isn't bound there yet. Returns
    the keystrokes added, or None when keys.json doesn't exist (Herdr writes it on its first start)."""
    if not theirs_path.exists():
        return None
    theirs = json.loads(theirs_path.read_text(encoding='utf-8-sig'))
    section = theirs.get(f'layout:{LAYOUT}')
    if not isinstance(section, dict):
        section = theirs[f'layout:{LAYOUT}'] = {}
    ours = json.loads(ours_path.read_text(encoding='utf-8-sig'))
    added = [key for key in ours if key not in section]
    if not added:
        return added
    shutil.copy2(theirs_path, backup)
    for key in added:
        section[key] = ours[key]
    temp = theirs_path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(theirs, indent=2) + '\n', encoding='utf-8')
    temp.replace(theirs_path)
    return added


def back_up_if_changed(target, new, backup):
    """Keeps a copy of `target` as `backup` before `new` replaces it, only when their contents differ."""
    if not target.exists():
        return False
    if target.read_bytes().replace(b'\r\n', b'\n') == new.read_bytes().replace(b'\r\n', b'\n'):
        return False
    shutil.copy2(target, backup)
    return True


def retire(home):
    """Removes the mods older harns installs added that harns no longer has. Returns the ones removed."""
    removed = [name for name in RETIRED if (home / 'mods' / name).is_dir()]
    for name in removed:
        shutil.rmtree(home / 'mods' / name)
    return removed


def main():
    switch = '--no-switch' not in sys.argv[1:]
    relays = '--no-relays' not in sys.argv[1:]
    chat = '--no-chat' not in sys.argv[1:]
    repo = Path(__file__).resolve().parent.parent
    share = repo / SHARE
    home = herdr_home()
    app = find_app()

    if subprocess.run([sys.executable, str(repo / 'scripts' / 'package.py')]).returncode != 0:
        fail('Building the share folders failed (scripts/package.py).')
    # herdr-chat is one of the listing's mods; --no-chat leaves whatever copy is installed as it is.
    mods = sorted(p.name for p in (share / 'mods').iterdir() if p.is_dir() and (chat or p.name != CHAT))

    if not same_folder(repo, home):
        stamp = time.strftime('%Y%m%d-%H%M%S')
        for mod in mods:
            copy_tree(share / 'mods' / mod, home / 'mods' / mod)
        removed = retire(home)
        if removed:
            print(f'Removed mods harns no longer uses: {", ".join(removed)}')
        (home / 'themes').mkdir(parents=True, exist_ok=True)
        shutil.copy2(share / 'themes' / 'harness.json', home / 'themes' / 'harness.json')
        copy_tree(share / 'brand-assets', home / 'brand-assets')

        layouts = home / 'layouts'
        layouts.mkdir(parents=True, exist_ok=True)
        layout_target = layouts / f'{LAYOUT}.json'
        back_up_if_changed(layout_target, share / 'layouts' / f'{LAYOUT}.json',
                           layouts / f'{LAYOUT}.json.before-install-{stamp}')
        # Its picture in Herdr's layout picker (the layout's `preview`); an older install's screenshot goes.
        shutil.copy2(share / 'layouts' / f'{LAYOUT}.svg', layouts / f'{LAYOUT}.svg')
        (layouts / f'{LAYOUT}.png').unlink(missing_ok=True)
        shutil.copy2(share / 'layouts' / f'{LAYOUT}.json', layout_target)

        merge_programs(share / 'programs.json', home / 'programs.json')

        added = merge_keys(share / 'layouts' / f'{LAYOUT}.keys.json', home / 'keys.json', home / f'keys.json.before-install-{stamp}')
        if added is None:
            print(f'note: {home / "keys.json"} does not exist yet. Open Herdr once, then run this again for the layout\'s keys.')
        elif added:
            print(f'Added the layout\'s keys to keys.json: {", ".join(added)}')

    checked = mods + ([CHAT] if CHAT not in mods and (home / 'mods' / CHAT).is_dir() else [])
    for mod in checked:
        result = subprocess.run([app, 'check', str(home / 'mods' / mod)], capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stdout + result.stderr, file=sys.stderr)
            fail(f'herdr-app check failed for mods/{mod}')
    print(f'Checked {len(checked)} mods in {home / "mods"}')

    if relays and subprocess.run([sys.executable, str(repo / 'scripts' / 'install-context.py')]).returncode != 0:
        fail('Installing the relays failed (scripts/install-context.py). --no-relays skips them.')

    layout = (share / 'layouts' / f'{LAYOUT}.json').read_text(encoding='utf-8')
    needed = sorted(set(re.findall(r'"mod":\s*"([^"]+)"', layout)))
    missing = [mod for mod in needed if not (home / 'mods' / mod).is_dir()]
    if missing:
        where = f' {CHAT} is installed without --no-chat.' if CHAT in missing else ''
        if any(mod != CHAT for mod in missing):
            where += ' The others are Herdr\'s own: open Herdr once so it writes them.'
        print('warning: the layout also uses mods that are not installed: ' + ', '.join(missing) + '.' + where +
              ' Install them, then run this again. Not switching, or the layout would show errors in their place.',
              file=sys.stderr)

    if switch and not missing:
        if subprocess.run([app, 'do', 'layout.switch', '--name', LAYOUT], stdout=subprocess.DEVNULL).returncode != 0:
            fail(f'Switching to the {LAYOUT} layout failed.')
        print(f'Switched to {LAYOUT}. ctrl-shift-l switches back.')

    status = subprocess.run([app, 'status'], capture_output=True, text=True)
    print(status.stdout.strip() or status.stderr.strip())


if __name__ == '__main__':
    main()
