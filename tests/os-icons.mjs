// The machine icons: each system's probe words pick the right icon, and every icon named has its file.
import { ICONS, distroIcon } from '../src/machine-agents/os-icons.js';
import { existsSync } from 'fs';

let failed = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${got}, want ${want}`}`);
  if (!ok) failed++;
};

check('Pop!_OS by its ID, ahead of the Ubuntu and Debian it is like', distroIcon('pop ubuntu debian Linux'), 'popos');
check('Debian', distroIcon('debian  Linux'), 'debian');
check('Omarchy by its folder, ahead of the Arch under it', distroIcon('omarchy arch  Linux'), 'omarchy');
check('Arch', distroIcon('arch  Linux'), 'archlinux');
check('Fedora Asahi Remix', distroIcon('fedora-asahi-remix fedora Linux'), 'asahilinux');
check('a distro without an icon takes its family\'s', distroIcon('mydistro ubuntu debian Linux'), 'ubuntu');
check('FreeBSD by its kernel (no os-release)', distroIcon('  FreeBSD'), 'freebsd');
check('an unknown Linux is Tux', distroIcon('mydistro  Linux'), 'linux');
check('no answer at all is Tux', distroIcon(''), 'linux');

const files = new URL('../src/machine-agents/os/', import.meta.url);
for (const name of new Set([...Object.values(ICONS), 'windows', 'apple', 'linux']))
  check(`os/${name}.svg is there`, existsSync(new URL(`${name}.svg`, files)), true);

process.exit(failed ? 1 : 0);
