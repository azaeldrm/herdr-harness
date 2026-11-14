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
            for name in ('machine-stats', 'harness-pane', 'machine-agents', 'mine'):
                (home / 'mods' / name).mkdir(parents=True)
            self.assertEqual(sorted(install.retire(home)), ['harness-pane', 'machine-stats'])
            self.assertEqual(sorted(p.name for p in (home / 'mods').iterdir()), ['machine-agents', 'mine'])
            self.assertEqual(install.retire(home), [])


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
            self.assertEqual(data['layout:harns']['alt-shift-down'], 'machine-agents.next-machine')
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
