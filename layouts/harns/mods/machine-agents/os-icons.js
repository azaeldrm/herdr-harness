// The icon for each system harns knows, by the words a machine's probe prints (os.js), and that probe: pure, so the
// tests can check it. Each name is a file in os/ (see os/SOURCES.md).

export const ICONS = {
  pop: 'popos', debian: 'debian', ubuntu: 'ubuntu', fedora: 'fedora', arch: 'archlinux', linuxmint: 'linuxmint',
  manjaro: 'manjaro', opensuse: 'opensuse', 'opensuse-leap': 'opensuse', 'opensuse-tumbleweed': 'opensuse', suse: 'opensuse',
  alpine: 'alpinelinux', nixos: 'nixos', centos: 'centos', rocky: 'rockylinux', almalinux: 'almalinux', rhel: 'redhat',
  raspbian: 'raspberrypi', kali: 'kalilinux', gentoo: 'gentoo', void: 'voidlinux', endeavouros: 'endeavouros',
  zorin: 'zorin', elementary: 'elementary', garuda: 'garudalinux', cachyos: 'cachyos', slackware: 'slackware',
  artix: 'artixlinux', 'fedora-asahi-remix': 'asahilinux', deepin: 'deepin', solus: 'solus',
  freebsd: 'freebsd', openbsd: 'openbsd', omarchy: 'omarchy',
};

// Prints "[omarchy] ID ID_LIKE… kernel": what distroIcon reads, most specific first.
export const PROBE = 'if [ -d "$HOME/.local/share/omarchy" ]; then printf "omarchy "; fi; ' +
  'if [ -r /etc/os-release ]; then . /etc/os-release; fi; echo "$ID $ID_LIKE $(uname -s)"';

export function distroIcon(release) {
  // The icon for the probe's words: the first with an icon, else Tux.
  const words = String(release ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.map(w => ICONS[w]).find(Boolean) ?? 'linux';
}
