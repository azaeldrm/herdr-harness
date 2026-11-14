import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('install', Path(__file__).parents[1] / 'scripts/install.py')
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


class RetireTests(unittest.TestCase):
    def test_retired_mods_go_and_the_rest_stay(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            for name in ('machine-stats', 'harness-pane', 'machine-sidebar', 'mine'):
                (home / 'mods' / name).mkdir(parents=True)
            self.assertEqual(sorted(install.retire(home)), ['harness-pane', 'machine-stats'])
            self.assertEqual(sorted(p.name for p in (home / 'mods').iterdir()), ['machine-sidebar', 'mine'])
            self.assertEqual(install.retire(home), [])

    def test_a_renamed_mods_old_copy_and_its_caches_go(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / 'mods' / 'machine-agents').mkdir(parents=True)
            (home / 'cache' / 'herdr-chat' / 'diagrams').mkdir(parents=True)
            (home / 'cache' / 'herdr-chat' / 'sent').mkdir(parents=True)
            self.assertEqual(install.retire(home), ['machine-agents'])
            self.assertEqual(sorted(p.name for p in (home / 'cache' / 'herdr-chat').iterdir()), ['sent'])


class CarryOverTests(unittest.TestCase):
    def test_saved_state_and_keys_follow_a_renamed_mod(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / 'data' / 'machine-agents').mkdir(parents=True)
            (home / 'data' / 'machine-agents' / 'pins').write_text('["t1"]')
            (home / 'keys.json').write_text(json.dumps({
                'global': {'ctrl-t': 'tab.new'},
                'layout:harns': {'alt-shift-down': 'machine-agents.next-machine', 'alt-right': {'action': 'layout.select', 'args': {}}}}))
            moved, rebound = install.carry_over(home, home / 'keys.backup.json')
            self.assertEqual(moved, ['machine-agents -> machine-sidebar'])
            self.assertEqual((home / 'data' / 'machine-sidebar' / 'pins').read_text(), '["t1"]')
            self.assertEqual(rebound, ['machine-agents.next-machine'])
            keys = json.loads((home / 'keys.json').read_text())
            self.assertEqual(keys['layout:harns']['alt-shift-down'], 'machine-sidebar.next-machine')
            self.assertEqual(keys['layout:harns']['alt-right']['action'], 'layout.select')
            self.assertEqual(keys['global'], {'ctrl-t': 'tab.new'})
            self.assertTrue((home / 'keys.backup.json').exists())
            self.assertEqual(install.carry_over(home, home / 'second.json'), ([], []))
            self.assertFalse((home / 'second.json').exists())

    def test_the_new_name_keeps_its_own_state(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            for name, pins in (('machine-agents', 'old'), ('machine-sidebar', 'new')):
                (home / 'data' / name).mkdir(parents=True)
                (home / 'data' / name / 'pins').write_text(pins)
            self.assertEqual(install.carry_over(home, home / 'backup.json'), ([], []))
            self.assertEqual((home / 'data' / 'machine-sidebar' / 'pins').read_text(), 'new')


class MergeKeysTests(unittest.TestCase):
    OURS = Path(__file__).parents[1] / 'layouts/harns/layouts/harns.keys.json'

    def test_missing_keys_are_added_and_the_rest_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keys = root / 'keys.json'
            keys.write_text(json.dumps({'global': {'alt-left': 'pane.go:left'}, 'layout:harns': {'alt-left': 'mine'}}))
            added = install.merge_keys(self.OURS, keys, root / 'backup.json')
            data = json.loads(keys.read_text())
            self.assertNotIn('alt-left', added)
            self.assertEqual(data['layout:harns']['alt-left'], 'mine')
            self.assertEqual(data['layout:harns']['alt-right']['args']['child'], 'terminal-panel')
            self.assertEqual(data['layout:harns']['alt-shift-down'], 'machine-sidebar.next-machine')
            self.assertEqual(data['global'], {'alt-left': 'pane.go:left'})
            self.assertTrue((root / 'backup.json').exists())

    def test_a_second_run_changes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keys = root / 'keys.json'
            keys.write_text(json.dumps({'global': {}}))
            install.merge_keys(self.OURS, keys, root / 'first.json')
            before = keys.read_text()
            self.assertEqual(install.merge_keys(self.OURS, keys, root / 'second.json'), [])
            self.assertEqual(keys.read_text(), before)
            self.assertFalse((root / 'second.json').exists())

    def test_no_keys_file_is_left_for_herdr_to_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertIsNone(install.merge_keys(self.OURS, root / 'keys.json', root / 'backup.json'))
            self.assertFalse((root / 'keys.json').exists())


class BackupTests(unittest.TestCase):
    def test_the_same_layout_with_other_line_endings_is_not_backed_up(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'installed.json').write_bytes(b'{\r\n  "id": "root"\r\n}\r\n')
            (root / 'new.json').write_bytes(b'{\n  "id": "root"\n}\n')
            self.assertFalse(install.back_up_if_changed(root / 'installed.json', root / 'new.json', root / 'backup.json'))
            self.assertFalse((root / 'backup.json').exists())

    def test_a_changed_layout_is_backed_up(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'installed.json').write_text('{"id": "mine"}\n')
            (root / 'new.json').write_text('{"id": "root"}\n')
            self.assertTrue(install.back_up_if_changed(root / 'installed.json', root / 'new.json', root / 'backup.json'))
            self.assertEqual((root / 'backup.json').read_text(), '{"id": "mine"}\n')


if __name__ == '__main__':
    unittest.main()
