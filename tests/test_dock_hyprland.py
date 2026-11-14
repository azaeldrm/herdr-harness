import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('dock', Path(__file__).parents[1] / 'layouts/harns/mods/emulator/dock-hyprland.py')
dock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dock)


class StateTests(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.txt'
            path.write_text(text)
            return dock.read_state(str(path))

    def test_the_shown_emulator_and_every_other_one(self):
        state = self.read('40.5 12 225 500 1\nAndroid Emulator - a:\nAndroid Emulator - b:\n')
        self.assertEqual(state, ((40.5, 12.0, 225.0, 500.0), True, 'Android Emulator - a:', ['Android Emulator - a:', 'Android Emulator - b:']))

    def test_none_shown(self):
        self.assertEqual(self.read('0 0 0 0 0\n\nAndroid Emulator - b:\n'), ((0, 0, 0, 0), False, '', ['Android Emulator - b:']))

    def test_quit(self):
        self.assertIsNone(self.read('quit\n'))

    def test_a_half_written_file_shows_nothing(self):
        self.assertEqual(self.read('40 1'), ((0, 0, 0, 0), False, '', []))


class TitleTests(unittest.TestCase):
    def test_the_title_with_its_port_and_without_it_once_booted(self):
        self.assertTrue(dock.matches('Android Emulator - phone:5554', 'Android Emulator - phone:'))
        self.assertTrue(dock.matches('Android Emulator - phone', 'Android Emulator - phone:'))

    def test_another_device_with_a_longer_name_is_not_this_one(self):
        self.assertFalse(dock.matches('Android Emulator - phone_2', 'Android Emulator - phone:'))
        self.assertFalse(dock.matches('Android Emulator - phone_2:5556', 'Android Emulator - phone:'))
        self.assertFalse(dock.matches('Emulator', ''))


if __name__ == '__main__':
    unittest.main()
