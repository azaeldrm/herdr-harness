// Which system a machine runs, for its icon in the sidebar: Windows, macOS, or a Unix one by os-release's ID, else the
// first of its ID_LIKE with an icon, else its kernel's name (the BSDs have no os-release), else Tux. Omarchy, a setup on
// top of Arch, is told by its own folder. Each is an icon in os/ (see os/SOURCES.md).
import { platformOf, runOn } from './platforms.js';
import { PROBE, distroIcon } from './os-icons.js';

export async function osOf(machine) {
  // The icon name for a machine's system (null: this computer), or null when it couldn't be asked.
  try {
    const platform = await platformOf(machine);
    if (platform === 'windows') return 'windows';
    if (platform === 'macos') return 'apple';
    const r = await runOn(machine, ['sh', ['-c', PROBE]]);
    return r.code === 0 ? distroIcon(r.stdout) : null;
  } catch { return null; }
}
