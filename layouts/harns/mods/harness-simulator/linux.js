import { exec, appHome } from "herdr";

const sh = (script, ...args) => exec("sh", ["-c", script, "harns", ...args]);
const DETACH = 'setsid "$@" > /dev/null 2>&1 < /dev/null &';

export function herdrClient(line, target) {
  // The control socket in one `ps` line, when it's one of herdr-core's ssh clients to `target`; otherwise null.
  const m = line.trim().match(/^ssh -S (\S+\/herdr-core\/ssh-[0-9a-f]+) ((?:-[oplFiJ] \S+ |-[A-Za-z]+ )*)(\S+)/);
  return m && m[3] === target ? m[1] : null;
}

async function herdrSocket(target) {
  // herdr-core's open ssh connection to `target` (the socket its clients share), or null when it has none.
  const ps = await exec("ps", ["-eo", "args="], { timeout: 5000 }).catch(() => null);
  for (const line of (ps?.stdout ?? "").split("\n")) {
    const socket = herdrClient(line, target);
    if (!socket) continue;
    const check = await exec("ssh", ["-S", socket, "-O", "check", target], { timeout: 5000 }).catch(() => null);
    if (check?.code === 0) return socket;
  }
  return null;
}

function forwarded() {
  // The forwards this mod added to herdr's connections and hasn't cancelled: they outlive the mod, so they're kept.
  try { return JSON.parse(localStorage.getItem("forwards") ?? "[]"); } catch { return []; }
}

function remember(list) {
  try { localStorage.setItem("forwards", JSON.stringify(list)); } catch {}
}

async function cancelForward(f) {
  // One forward off herdr's connection (gone already when that connection closed), and off the list.
  await exec("ssh", ["-S", f.socket, "-O", "cancel", "-R", f.spec, f.target], { timeout: 10000 }).catch(() => {});
  remember(forwarded().filter(x => x.socket !== f.socket || x.spec !== f.spec));
}

export async function linuxHost() {
  // The Simulator's Linux side: the Android SDK in ~/Android/Sdk (or ANDROID_HOME), programs started detached, tunnels
  // on herdr's own ssh connections (else OpenSSH), and on Hyprland dock-hyprland.py placing the device windows (other
  // desktops show them in their own).
  const r = await sh('printf "%s|%s|%s|%s|%s" "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$ANDROID_AVD_HOME" "$HOME" "$HYPRLAND_INSTANCE_SIGNATURE"');
  const [home, root, avds, user, hyprland] = r.stdout.split("|");
  const sdk = home || root || `${user}/Android/Sdk`;
  const cache = `${appHome()}/cache/harness-simulator`;
  const host = {
    sep: "/",
    sdk,
    adb: `${sdk}/platform-tools/adb`,
    emulator: `${sdk}/emulator/emulator`,
    avdHome: avds || `${user}/.android/avd`,
    cache,
    stateFile: `${cache}/dock-state.txt`,
    docks: Boolean(hyprland),
    noSdk: "No Android emulator found in ~/Android/Sdk. Install the SDK's emulator, or set ANDROID_HOME (RECIPE.md: Simulator setup).",

    start(program, args) { return sh(DETACH, program, ...args); },

    async closeTunnels() {
      // Tunnels a previous copy of the mod left (a reload, or a crash): its own ssh processes, found by the name SetEnv
      // gave them, and the forwards it added to herdr's connections, as forwarded() kept them.
      await exec("pkill", ["-f", "SetEnv=HARNS=harns-simulator"]).catch(() => {});
      for (const f of forwarded()) await cancelForward(f);
    },

    async closeTunnel(tunnel) {
      // A tunnel openTunnel made: a forward on herdr's connection is cancelled, an ssh of its own is ended.
      if (typeof tunnel === "object") return cancelForward(tunnel);
      return exec("kill", [String(tunnel)]).catch(() => {});
    },

    async openTunnel(target, port, local) {
      // An SSH reverse tunnel to `target`, its 127.0.0.1:<port> to this computer's <local>, or null when that port is
      // taken there or ssh can't log in. It rides herdr's own connection to `target` when there is one (no key needed),
      // as a forward on it ({ socket, target, spec }); otherwise it's an ssh of its own (its pid).
      const spec = `127.0.0.1:${port}:127.0.0.1:${local}`;
      const socket = await herdrSocket(target);
      if (socket) {
        const r = await exec("ssh", ["-S", socket, "-O", "forward", "-R", spec, target], { timeout: 10000 }).catch(() => null);
        if (r?.code !== 0) return null;
        const f = { socket, target, spec };
        remember([...forwarded().filter(x => x.socket !== socket || x.spec !== spec), f]);
        return f;
      }
      const t = await sh('setsid ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ' +
        '-o SetEnv=HARNS=harns-simulator -R "$1" "$2" > /dev/null 2>&1 < /dev/null & p=$!; sleep 2.5; ' +
        'if kill -0 "$p" 2> /dev/null; then echo "$p"; else echo exited; fi', spec, target);
      return Number(t.stdout.trim()) || null;
    },

    async copyDevice(base, name) {
      // Another virtual device like `base`: its config.ini without its data, so it boots fresh.
      const c = await sh('d="$1"; src="$d/$2.avd"; dst="$d/$3.avd"; mkdir -p "$dst" && ' +
        '{ grep -Ev "^(AvdId|avd\\.ini\\.displayname)[[:space:]]*=" "$src/config.ini"; printf "AvdId=%s\\navd.ini.displayname=%s\\n" "$3" "$3"; } > "$dst/config.ini" && ' +
        '{ printf "avd.ini.encoding=UTF-8\\npath=%s\\npath.rel=avd/%s.avd\\n" "$dst" "$3"; grep "^target=" "$d/$2.ini"; } > "$d/$3.ini"',
        host.avdHome, base, name);
      if (c.code !== 0) throw new Error(c.stderr.trim().split("\n")[0] || "couldn't copy the virtual device");
    },

    async startDock() {
      // A fresh dock-hyprland.py (a previous one is ended, leaving its windows to this one).
      await exec("pkill", ["-KILL", "-f", "harness-simulator/dock-hyprland.py"]).catch(() => {});
      const s = await sh(DETACH, "python3", `${appHome()}/mods/harness-simulator/dock-hyprland.py`, "run", host.stateFile, `${appHome()}/herdr-app.sock`);
      if (s.code !== 0) throw new Error(s.stderr.trim().split("\n")[0] || "Couldn't start the dock helper");
    },
  };
  return host;
}
