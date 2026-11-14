// Harness's Simulator: Android emulators in the right-hand panel, beside Files and Changes.
//
// One emulator per session (an agent's tab): the panel shows the focused session's, and the
// others keep running, hidden, for the agents still testing on them. Sub-agents (terminals an
// agent started with `hc run`) use their session's emulator. Closing a tab stops its emulator
// and keeps the virtual device for a later session.
//
// The device isn't drawn by this mod. The emulator's own window sits over the panel's screen
// area (harns-dock on Windows, built from dock.cs on first use; dock-hyprland.py on Hyprland), so
// it runs at the emulator's own frame rate with its own mouse and keyboard input, and nothing here
// runs per frame. This mod only says where that area is and which emulator shows, in a small state
// file, when that changes. Other Linux desktops show each emulator in its own window.
//
// A session on another machine gets its emulator shared there (an SSH reverse tunnel to that
// machine's adb server), and ~/.local/bin/adb there (adb.sh) points each session's agents at
// their own emulator, so they find it with plain `adb`.
//
// Windows and Linux (windows.js, linux.js); the iOS Simulator needs a Mac.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, hc, appHome, readTextFile, layout, settings, window, theme, spaces, machines, panes, terminals, focused } from "herdr";
import * as fs from "fs/promises";
import { windowsHost } from "./windows.js";
import { linuxHost } from "./linux.js";

const BLOCK = "simulator";
const PAD = 12;           // around the screen area, in the mod's px (herdr zooms them)
const BORDER = 1;         // the card's border, as on Files and Changes
const POLL = 4000;        // how often the emulators are read (ms)
const SHARE_PORT = 15555; // the first port tried on another machine for an emulator's adb
const CHECK = 30000;      // how often shared emulators are checked on their machines (ms)

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function insets(node, id) {
  // How far block `id` sits from the window's right and bottom edges, in layout px, from the
  // px sizes of what comes after it. Null when something after it has no fixed size.
  if (node?.id === id) return { right: 0, bottom: 0 };
  const kids = node?.children ?? [];
  for (let i = 0; i < kids.length; i++) {
    const inner = insets(kids[i], id);
    if (!inner) continue;
    if (node.type === "stack") return inner;
    const pad = typeof node.padding === "number" ? node.padding : 0, gap = node.gap ?? 0;
    let after = 0;
    for (const k of kids.slice(i + 1)) {
      if (k.hidden) continue;
      if (!k.size?.px) return null;
      after += k.size.px + gap;
    }
    return node.type === "row"
      ? { right: inner.right + pad + after, bottom: inner.bottom + pad }
      : { right: inner.right + pad, bottom: inner.bottom + pad + after };
  }
  return null;
}

const ANDROID = { 29: "10", 30: "11", 31: "12", 32: "12L", 33: "13", 34: "14", 35: "15", 36: "16" };
const zoom = () => Number(settings()?.zoom) || 1;   // herdr scales the mod's px by this
const HOSTS = { windows: windowsHost, linux: linuxHost };
const prefixOf = avd => `Android Emulator - ${avd}:`;   // its window's title
// Addresses name their machine ("homelab-compute/t34"); this computer's are bare ("t28").
const machineOf = address => address?.includes("/") ? address.slice(0, address.lastIndexOf("/")) : null;
const idOf = address => address?.split("/").pop();
const errorText = err => String(err?.message ?? err).split("\n")[0];

export default class Simulator extends View {
  init(_props, cx) {
    this.area = null;            // the screen area's size, real logical px
    this.avds = [];              // virtual devices on this computer
    this.info = {};              // avd -> { width, height, label }, from its config.ini
    this.specs = { default: {}, devices: {} }; // emulator.json: what each emulator starts with
    this.running = {};           // avd -> adb serial ("emulator-5554"), every running emulator
    this.owners = {};            // tab -> avd: each session's emulator, kept across restarts
    try { this.owners = JSON.parse(localStorage.getItem("owners") ?? "{}"); } catch {}
    this.starting = new Set();   // avds starting, so their windows dock as soon as they appear
    this.status = "Looking for the Android SDK…";
    this.mode = "dock";          // "dock": in the panel; "window": windows of their own
    try { this.mode = localStorage.getItem("mode") === "window" ? "window" : "dock"; } catch {}
    this.helper = false;         // the dock helper is running
    this.written = null;         // the state file's last contents
    this.shares = {};            // avd -> { machine, tunnel, port, serial } | { machine, error } | { pending }
    this.declined = new Set();   // avds the user stopped sharing, until they stop
    this.maps = {};              // machine -> the devices file last written there
    this.scripts = {};           // machine -> true once its adb script is in place
    this.checked = 0;            // when the shares were last checked on their machines
    this.retry = {};             // avd -> how long to wait before setting up a share that failed again (ms)
    this.busy = new Set();       // avds being stopped or restarted (their buttons wait)
    if (!HOSTS[window()?.platform]) { this.status = "The Simulator panel runs on Windows and Linux."; return; }
    cx.spawn(async cx => {
      await this.setup();
      cx.notify();
      for (;;) {
        // Always, not only while the panel shows: sessions keep working while you're elsewhere.
        // One round's error is shown and the next round runs: nothing may end this loop.
        try { await this.refresh(); await this.tend(); }
        catch (err) { this.status = `The Simulator panel hit an error: ${errorText(err)}`; }
        cx.notify();
        await cx.sleep(this.starting.size ? 1500 : POLL);
      }
    });
    // Whether the panel shows, and which session has focus, are read from herdr. A hidden stack
    // child may not render, so a light timer keeps the device windows in step (no programs run).
    cx.timer.every(200, () => this.place());
  }

  async close() {
    // The panel's slot went away (another layout, or quitting): the device windows hide, and the
    // tunnels close (the other machines see their emulators go offline until it's back).
    this.place(false);
    for (const share of Object.values(this.shares)) if (share.tunnel) this.host?.closeTunnel(share.tunnel);
    this.shares = {};
  }

  async setup() {
    this.host = await HOSTS[window().platform]();
    this.adb = this.host.adb;
    this.emulator = this.host.emulator;
    this.stateFile = this.host.stateFile;
    await this.loadSpecs();
    await fs.mkdir(this.host.cache, { recursive: true }).catch(() => {});
    // Tunnels a previous copy of this mod left (a reload, or a crash) close; they open again.
    await this.host.closeTunnels();
    const list = await exec(this.emulator, ["-list-avds"]).catch(() => null);
    if (!list || list.code !== 0) { this.status = this.host.noSdk; return; }
    this.avds = list.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("INFO"));
    for (const avd of this.avds) await this.avdInfo(avd);
    this.status = this.avds.length ? "" : "No virtual devices yet. Create one in Android Studio's Device Manager, or with avdmanager.";
    await this.refresh();
  }

  path(...parts) { return parts.join(this.host.sep); }

  docked() { return Boolean(this.host?.docks) && this.mode === "dock"; }

  async avdInfo(avd) {
    // From the virtual device's config.ini, known before it boots: its screen size, and a
    // label to show for it ("Pixel 5 · Android 15") instead of its file name. The emulator
    // rewrites the file with spaces around "=", Android Studio without.
    if (this.info[avd]) return this.info[avd];
    const text = await readTextFile(this.path(this.host.avdHome, `${avd}.avd`, "config.ini")).catch(() => null);
    const key = name => new RegExp(`^${name.replace(/\./g, "\\.")}\\s*=\\s*(.*)$`, "m").exec(text ?? "")?.[1]?.trim();
    const width = Number(key("hw.lcd.width")) || 0, height = Number(key("hw.lcd.height")) || 0;
    const device = (key("hw.device.name") ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || avd.replace(/_/g, " ");
    const api = /android-(\d+)/.exec(key("image.sysdir.1") ?? "")?.[1];
    const label = api ? `${device} · Android ${ANDROID[api] ?? `API ${api}`}` : device;
    const info = { width, height, label };
    if (text) this.info[avd] = info;
    return info;
  }

  label(avd) { return this.info[avd]?.label ?? avd; }

  async loadSpecs() {
    // emulator.json (the mod's defaults) under the person's own values: harness.json's `emulator`, which no
    // install or update overwrites. Read again before each start, so a change applies the next time one starts.
    const read = async path => { try { return JSON.parse(await readTextFile(path)) ?? {}; } catch { return {}; } };
    const base = await read(this.path(appHome(), "mods", "harness-simulator", "emulator.json"));
    const mine = (await read(this.path(appHome(), "harness.json"))).emulator ?? {};
    const devices = {};
    for (const name of new Set([...Object.keys(base.devices ?? {}), ...Object.keys(mine.devices ?? {})]))
      devices[name] = { ...base.devices?.[name], ...mine.devices?.[name] };
    this.specs = { default: { ...base.default, ...mine.default }, devices };
  }

  spec(avd) {
    // emulator.json's defaults, and the device's own values over them. Copies of a device
    // (harns_phone_2) take the defaults unless listed by their own name.
    return { ...this.specs.default, ...this.specs.devices?.[avd] };
  }

  launchArgs(avd) {
    // Launch flags, so they win over the device's config.ini on every start (copies included).
    // They're limits, not reservations: cores are threads the system schedules anywhere, memory is
    // used as Android touches it. Storage stays the device's (config.ini's
    // disk.dataPartition.size): -partition-size takes at most 2047 MB.
    const s = this.goodSpec(avd), args = ["-avd", avd, "-no-boot-anim"];
    if (s.memory) args.push("-memory", String(s.memory));
    if (s.cores) args.push("-cores", String(s.cores));
    if (s.gpu) args.push("-gpu", String(s.gpu));
    return args;
  }

  goodSpec(avd) {
    // The values the emulator takes: memory and cores as whole numbers, gpu as one word. Anything else is left
    // out (and named by badSpec), since the emulator exits on it with its console hidden.
    const s = this.spec(avd), whole = v => Number.isInteger(Number(v)) && Number(v) > 0;
    return { memory: whole(s.memory) ? Number(s.memory) : null, cores: whole(s.cores) ? Number(s.cores) : null,
      gpu: /^[\w-]+$/.test(String(s.gpu ?? "")) ? String(s.gpu) : null };
  }

  badSpec(avd) {
    const s = this.spec(avd), good = this.goodSpec(avd);
    return ["memory", "cores", "gpu"].filter(k => s[k] != null && s[k] !== "" && good[k] == null).map(k => `${k} ${JSON.stringify(s[k])}`);
  }

  specText(avd) {
    const s = this.goodSpec(avd), gb = mb => `${+(mb / 1024).toFixed(1)} GB`;
    return [s.memory && `${gb(s.memory)} RAM`, s.cores && `${s.cores} cores`, s.gpu && `${s.gpu} GPU`]
      .filter(Boolean).join(", ");
  }

  async clone(base) {
    // Another virtual device like `base`, for one more session: its config.ini without its
    // data, so it boots fresh (the first boot is a cold one).
    let n = 2;
    while (this.avds.includes(`${base}_${n}`)) n++;
    const name = `${base}_${n}`;
    await this.host.copyDevice(base, name);
    this.avds.push(name);
    await this.avdInfo(name);
    return name;
  }

  async refresh() {
    // The running emulators, by virtual device. Short timeouts: adb can be slow while one boots.
    const r = await exec(this.adb, ["devices"], { timeout: 5000 }).catch(() => null);
    if (!r) return;
    const serials = r.stdout.split(/\r?\n/).map(l => l.split(/\s+/)).filter(([s, state]) => /^emulator-\d+$/.test(s) && state === "device").map(([s]) => s);
    const next = {};
    for (const serial of serials) {
      let avd = Object.keys(this.running).find(a => this.running[a] === serial);
      if (!avd) {
        const name = await exec(this.adb, ["-s", serial, "emu", "avd", "name"], { timeout: 5000 }).catch(() => null);
        avd = name?.stdout.split(/\r?\n/)[0]?.trim();
        if (!avd) continue;
        await this.avdInfo(avd);
      }
      next[avd] = serial;
      this.starting.delete(avd);
    }
    // Emulators that stopped: their tunnels close, and a "don't share" ends with them, so the
    // next session to use the device gets it shared.
    for (const avd of Object.keys(this.running)) if (!next[avd]) { await this.unshare(avd); this.declined.delete(avd); delete this.retry[avd]; }
    this.running = next;
    if (this.docked() && !this.helper && (Object.keys(next).length || this.starting.size)) await this.dock();
  }

  saveOwners() { try { localStorage.setItem("owners", JSON.stringify(this.owners)); } catch {} }

  session() { return focused()?.tab ?? null; }

  tabMachine(tab) { return spaces().find(s => (s.tabs ?? []).some(t => t.id === tab))?.machine ?? null; }

  ready(machine) { return machines().find(x => x.name === machine)?.layout === "ready"; }

  async tend() {
    // Closed sessions' emulators stop (their devices are kept), and each running session's
    // emulator is shared with its machine, with the devices file there kept current.
    const live = new Set(spaces().flatMap(s => (s.tabs ?? []).map(t => t.id)));
    for (const [tab, avd] of Object.entries(this.owners)) {
      // Only when its machine answers: a machine going offline hides its tabs without closing them.
      if (live.has(tab) || !this.ready(machineOf(tab))) continue;
      delete this.owners[tab];
      this.saveOwners();
      if (this.running[avd]) {
        await this.unshare(avd);
        exec(this.adb, ["-s", this.running[avd], "emu", "kill"], { timeout: 15000 }).catch(() => {});
      }
    }
    for (const [tab, avd] of Object.entries(this.owners)) {
      const m = this.tabMachine(tab);
      if (this.shares[avd] && this.shares[avd].machine !== m) await this.unshare(avd);
      // A share that couldn't be set up is tried again later, waiting longer each time (30 s up to 10 min):
      // a failed try can take 20 s, and most causes (no way to ssh in, someone else's adb there) don't clear alone.
      const was = this.shares[avd], due = was && !was.tunnel && was.error && Date.now() >= (was.retryAt ?? 0);
      if (!m || !this.running[avd] || (was && !due) || this.declined.has(avd) || !this.ready(m)) continue;
      this.shares[avd] = { machine: m, pending: true, error: was?.error };
      const made = await this.share(m, avd).catch(err => {
        const wait = this.retry[avd] = Math.min((this.retry[avd] ?? 15000) * 2, 600000);
        return { machine: m, error: errorText(err), retryAt: Date.now() + wait };
      });
      if (this.shares[avd]?.pending) this.shares[avd] = made;   // unless Stop or × ended it meanwhile
      if (made.tunnel) delete this.retry[avd];
    }
    if (Date.now() - this.checked > CHECK) { this.checked = Date.now(); await this.checkShares(); }
    await this.writeMaps();
  }

  async checkShares() {
    // Shares mend themselves: a machine's adb server that restarted forgets its connections,
    // and a connect can time out and still finish. Each is checked against that machine's
    // `adb devices`; one that's missing connects again, and one that can't is set up again.
    const byMachine = {};
    // Only shares with a tunnel: one that couldn't be set up is retried by tend(), on its own clock.
    for (const [avd, share] of Object.entries(this.shares)) if (share.tunnel && !share.pending) (byMachine[share.machine] ??= []).push(avd);
    for (const [m, avds] of Object.entries(byMachine)) {
      if (!this.ready(m)) continue;
      const list = await exec("adb", ["devices"], { on: m, timeout: 10000 }).catch(() => null);
      if (!list || list.code !== 0) continue;
      const state = new Map(list.stdout.split(/\r?\n/).map(l => l.split(/\s+/)).filter(([s, st]) => s && st).map(([s, st]) => [s, st]));
      for (const avd of avds) {
        // Stop, Restart or × can end a share while that machine answers: only the same share is mended.
        const share = this.shares[avd];
        if (!share?.tunnel || share.pending) continue;
        const st = state.get(share.serial);
        if (st === "device") { delete share.error; continue; }
        // Listed but not usable ("offline"): adb connect would only say it's "already connected".
        if (st) await exec("adb", ["disconnect", share.serial], { on: m, timeout: 5000 }).catch(() => {});
        const c = await exec("adb", ["connect", share.serial], { on: m, timeout: 10000 }).catch(() => null);
        if (this.shares[avd] !== share) continue;
        if (/connected to/.test(c?.stdout ?? "")) delete share.error;
        else await this.unshare(avd);   // the tunnel is gone too: the next round opens a new one
      }
    }
  }

  // Sharing a session's emulator with its machine. An SSH reverse tunnel (on herdr's own connection
  // to it where there is one, else OpenSSH with the ssh config herdr's machines use) brings that
  // machine's 127.0.0.1:<port> to the emulator's adb port here, and that machine's own adb server
  // connects to it: the emulator is one more device in its list, beside any phones. Bound to
  // localhost there; nothing listens on the network.

  async share(m, avd) {
    const list = await hc(["machine", "ls", "--json"]);
    const info = JSON.parse(list.stdout || "{}").machines?.find(x => x.name === m);
    if (!info) throw new Error("not one of herdr's machines");
    if (info.via) throw new Error("connected through a command, not ssh");
    await this.installScript(m);
    const local = Number(this.running[avd].split("-")[1]) + 1;   // emulator-5554: console 5554, adb 5555
    const taken = new Set(Object.values(this.shares).filter(s => s.machine === m && s.port).map(s => s.port));
    for (let port = SHARE_PORT, tries = 0; tries < 5; port++) {
      if (taken.has(port)) continue;
      tries++;
      // A later copy of the mod closes what this one leaves: an ssh of its own by the name SetEnv gives it, a forward
      // on herdr's connection from the list the host keeps.
      const tunnel = await this.host.openTunnel(info.target, port, local);
      if (!tunnel) continue;   // that port is taken there (or ssh can't log in): the next one
      const serial = `127.0.0.1:${port}`;
      const c = await exec("adb", ["connect", serial], { on: m, timeout: 10000 })
        .catch(() => ({ code: 1, stdout: "", stderr: "adb isn't installed there" }));
      if (/connected to/.test(c.stdout)) return { machine: m, tunnel, port, serial };
      return { machine: m, tunnel, port, serial, error: (c.stderr || c.stdout).trim().split("\n")[0] || "adb couldn't connect" };
    }
    throw new Error("couldn't open a tunnel (herdr isn't connected to it, and ssh to it doesn't work with a key)");
  }

  async unshare(avd) {
    const share = this.shares[avd];
    delete this.shares[avd];
    if (!share?.tunnel) return;
    await exec("adb", ["disconnect", share.serial], { on: share.machine, timeout: 5000 }).catch(() => {});
    await this.host.closeTunnel(share.tunnel);
  }

  async installScript(m) {
    // ~/.local/bin/adb there: adb.sh, which points each session at its own emulator and then runs
    // that machine's own adb. An adb already there that isn't this script is left alone.
    if (this.scripts[m]) return;
    const text = (await readTextFile(this.path(appHome(), "mods", "harness-simulator", "adb.sh")))?.replace(/\r/g, "");
    if (!text) throw new Error("adb.sh is missing from the mod");
    const r = await exec("sh", ["-c",
      'f="$HOME/.local/bin/adb"; if [ -e "$f" ] && ! grep -q "^# harns: points adb" "$f"; then exit 3; fi; ' +
      'mkdir -p "$HOME/.local/bin" && printf "%s" "$1" > "$f.harns" && chmod +x "$f.harns" && mv "$f.harns" "$f"', "harns", text], { on: m, timeout: 10000 });
    if (r.code === 3) throw new Error("~/.local/bin/adb there isn't harns's: left as it is");
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || "couldn't install the adb script");
    this.scripts[m] = true;
  }

  async writeMaps() {
    // ~/.config/harness/devices on each machine: every terminal of a session (its panes and the
    // sub-agents under them) and that session's emulator there.
    const all = terminals() ?? [], kids = {};
    for (const t of all) if (t.parent) (kids[t.parent] ??= []).push(t.address);
    const maps = {};
    for (const [tab, avd] of Object.entries(this.owners)) {
      const share = this.shares[avd];
      if (!share?.serial || share.error) continue;
      const seen = new Set(), queue = (panes() ?? []).filter(p => p.tab === tab && p.terminal).map(p => p.terminal);
      while (queue.length) { const a = queue.shift(); if (seen.has(a)) continue; seen.add(a); queue.push(...(kids[a] ?? [])); }
      const lines = [...seen].filter(a => machineOf(a) === share.machine).map(a => `${idOf(a)} ${share.serial}`);
      maps[share.machine] = (maps[share.machine] ?? "") + (lines.length ? lines.join("\n") : `- ${share.serial}`) + "\n";
    }
    for (const m of new Set([...Object.keys(maps), ...Object.keys(this.maps)])) {
      const text = maps[m] ?? "";
      if (this.maps[m] === text || !this.ready(m)) continue;
      const r = await exec("sh", ["-c", 'mkdir -p "$HOME/.config/harness" && printf "%s" "$1" > "$HOME/.config/harness/devices.harns" && mv "$HOME/.config/harness/devices.harns" "$HOME/.config/harness/devices"', "harns", text],
        { on: m, timeout: 10000 }).catch(() => null);
      if (r?.code === 0) { if (text) this.maps[m] = text; else delete this.maps[m]; }
    }
  }

  async dock() {
    // A fresh dock helper takes in the emulators' windows (one helper for all of them).
    try {
      this.written = null;
      this.place();
      await this.host.startDock();
      this.helper = true;
    } catch (err) {
      this.status = `Couldn't put the emulator in the panel: ${errorText(err)}`;
    }
  }

  async undock() {
    // Back to the emulators' own windows; the dock helper gives them back and exits.
    await this.write("quit");
    this.helper = false;
  }

  async write(text) {
    if (text === this.written || !this.stateFile) return;
    this.written = text;
    await fs.writeFile(this.stateFile, text).catch(() => { this.written = null; });
  }

  shown() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return Boolean(panel && !panel.hidden && body?.active === BLOCK);
  }

  current() {
    // The focused session's emulator, when it's running or starting.
    const avd = this.owners[this.session()];
    return avd && (this.running[avd] || this.starting.has(avd)) ? avd : null;
  }

  geometry(avd) {
    // Where the device goes: centered in the screen area at its own aspect ratio, as gaps from
    // the window's right and bottom edges plus a size, in real logical px.
    const d = this.info[avd], a = this.area;
    if (!d?.width || !a?.width || !a?.height) return null;
    const z = zoom();
    const edge = insets(layout(), BLOCK);
    if (!edge) return null;
    const scale = Math.min(a.width / d.width, a.height / d.height);
    const w = Math.floor(d.width * scale), h = Math.floor(d.height * scale);
    return {
      right: (edge.right + BORDER + PAD) * z + (a.width - w) / 2,
      bottom: (edge.bottom + BORDER + PAD) * z + (a.height - h) / 2,
      w, h,
    };
  }

  place(show) {
    // The state the dock helper reads, written only when it changes: where the panel's screen is,
    // which emulator shows there, and every other one (kept hidden).
    if (!this.helper || !this.docked()) return;
    const avd = this.current(), g = avd ? this.geometry(avd) : null;
    const visible = (show ?? this.shown()) && Boolean(g);
    const others = [...new Set([...Object.keys(this.running), ...this.starting])].filter(a => a !== avd).map(prefixOf);
    const head = g ? `${g.right.toFixed(1)} ${g.bottom.toFixed(1)} ${g.w} ${g.h} ${visible ? 1 : 0}` : "0 0 0 0 0";
    this.write([head, avd ? prefixOf(avd) : "", ...others].join("\n") + "\n");
  }

  async start(label, cx) {
    // The focused session's emulator: the one it had, else a free device of this kind (a running
    // one no session has, or a stopped one), else a new copy of one.
    const tab = this.session();
    if (!tab) return;
    let avd = this.owners[tab];
    const owned = new Set(Object.values(this.owners));
    if (!avd) avd = this.avds.find(a => this.label(a) === label && !owned.has(a) && this.running[a])
      ?? this.avds.find(a => this.label(a) === label && !owned.has(a));
    try {
      if (!avd) { this.status = `Setting up another ${label}…`; cx.notify(); avd = await this.clone(this.avds.find(a => this.label(a) === label)); }
    } catch (err) { this.status = `Couldn't set up another ${label}: ${errorText(err)}`; cx.notify(); return; }
    this.owners[tab] = avd;
    this.saveOwners();
    this.status = "";
    if (this.running[avd]) { cx.notify(); return; }
    await this.boot(avd, cx);
  }

  async boot(avd, cx, extra = []) {
    await this.loadSpecs();
    const bad = this.badSpec(avd);
    this.starting.add(avd);
    this.status = `Starting ${this.label(avd)}…${bad.length ? ` (left out of its settings: ${bad.join(", ")})` : ""}`; cx.notify();
    // The dock helper first, so it takes the device window as soon as it appears and it boots inside the panel.
    if (this.docked() && !this.helper) await this.dock();
    const args = [...this.launchArgs(avd), ...extra];
    const started = await this.host.start(this.emulator, args)
      .then(() => true, err => { this.status = `Couldn't start ${this.label(avd)}: ${errorText(err)}`; return false; });
    // A fresh copy boots cold, which takes a while the first time.
    for (let i = 0; started && i < 160 && !this.running[avd]; i++) { await cx.sleep(1500); await this.refresh(); cx.notify(); }
    this.starting.delete(avd);
    this.status = this.running[avd] || !started ? this.status.replace(/^Starting.*/, "") : `${this.label(avd)} didn't start. Check it in Android Studio's Device Manager.`;
    cx.notify();
  }

  async stop(cx) {
    // The focused session's emulator stops; the session keeps its device for next time.
    const avd = this.owners[this.session()];
    if (!avd || !this.running[avd] || this.busy.has(avd)) return;
    this.busy.add(avd);
    try {
      this.status = `Stopping ${this.label(avd)}…`; cx.notify();
      await this.shutdown(avd, cx);
      this.status = "";
    } finally { this.busy.delete(avd); cx.notify(); }
  }

  async shutdown(avd, cx, wait = 30000) {
    await this.unshare(avd);
    // `emu kill` can hang on after the emulator is gone: watch the device list instead.
    exec(this.adb, ["-s", this.running[avd], "emu", "kill"], { timeout: 15000 }).catch(() => {});
    for (let i = 0; i < wait / 500 && this.running[avd]; i++) { await cx.sleep(500); await this.refresh(); cx.notify(); }
    return !this.running[avd];
  }

  async reset(cx) {
    // A full restart: the emulator shuts down and boots cold (-no-snapshot-load), so Android
    // starts fresh instead of resuming where Stop left it. Apps and data stay.
    const avd = this.owners[this.session()];
    if (!avd || !this.running[avd] || this.busy.has(avd)) return;
    this.busy.add(avd);
    try {
      this.status = `Restarting ${this.label(avd)}…`; cx.notify();
      // Longer than Stop's wait: `emu kill` first saves a Quick Boot snapshot, slower with more memory.
      if (!await this.shutdown(avd, cx, 60000)) { this.status = `${this.label(avd)} didn't shut down.`; return; }
      await this.boot(avd, cx, ["-no-snapshot-load"]);
    } finally { this.busy.delete(avd); cx.notify(); }
  }

  async setMode(mode, cx) {
    this.mode = mode;
    try { localStorage.setItem("mode", mode); } catch {}
    if (mode === "window") await this.undock(); else await this.dock();
    cx.notify();
  }

  render() {
    const t = theme();
    const avd = this.owners[this.session()];
    const live = avd && this.running[avd] ? avd : null, booting = avd && this.starting.has(avd);
    const share = live ? this.shares[live] : null;
    const swallow = (_e, cx) => cx.stop_propagation();
    const button = (id, icon, label, action, opts = {}) => h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).text_color(opts.primary ? t.accent_foreground : t.muted).when(Boolean(opts.primary), el => el.bg(t.accent))
      .when(!opts.disabled, el => el.cursor_pointer().hover(s => s.bg(opts.primary ? t.accent : t.hover).text_color(opts.primary ? t.accent_foreground : t.foreground))
        .on_mouse_down("left", swallow)
        // The actions await programs: they run as a task, with a context of their own (an
        // event's cx isn't usable after an await).
        .on_click((_e, cx) => { cx.spawn(async acx => { await action(acx); acx.notify(); }); }))
      .when(Boolean(opts.disabled), el => el.opacity(0.5))
      .child(svg(`mods/harness-simulator/${icon}.svg`).size(13)).when(Boolean(label), el => el.child(label));

    const header = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().id("sim-title").font_semibold().child("Simulator").when(Boolean(avd), el => el.tooltip(`This session's: ${this.label(avd)}${this.specText(avd) ? ` (${this.specText(avd)})` : ""}`)))
      .child(div().flex_1())
      .when(Boolean(share && (!share.pending || share.error)), el => el.child(h_flex().id("sim-share").h(22).px(6).gap(4).flex_none().items_center().rounded(5)
        .border_1().border_color(t.border).text_size(11).text_color(share.error ? t.blocked : t.muted)
        .tooltip(share.error ? `Not shared with ${share.machine}: ${share.error}` : `Shared with ${share.machine}: this session's agents reach it with adb (${share.serial} there)`)
        .child(svg("mods/harness-simulator/share.svg").size(11)).child(share.machine)
        .child(div().id("sim-unshare").cursor_pointer().text_color(t.dim).hover(st => st.text_color(t.foreground))
          .on_mouse_down("left", swallow)
          .on_click((_e, cx) => { this.declined.add(live); cx.spawn(async acx => { await this.unshare(live); await this.writeMaps(); acx.notify(); }); })
          .child(svg("mods/harness-simulator/x.svg").size(10)))))
      .when(Boolean(live), el => el
        .when(Boolean(this.host?.docks), el => el.child(this.mode === "dock"
          ? button("sim-pop", "pop-out", null, cx => this.setMode("window", cx)).tooltip("Open in their own windows")
          : button("sim-dock", "dock", null, cx => this.setMode("dock", cx)).tooltip("Show in the panel")))
        .child(button("sim-reset", "restart", null, cx => this.reset(cx), { disabled: this.busy.has(live) }).tooltip("Restart this session's emulator: shut it down and boot it fresh (apps and data stay)"))
        .child(button("sim-stop", "stop", null, cx => this.stop(cx), { disabled: this.busy.has(live) }).tooltip("Stop this session's emulator")));

    const sizeArea = (size, cx) => {
      if (this.area && Math.abs(size.width - this.area.width) < 0.5 && Math.abs(size.height - this.area.height) < 0.5) return;
      this.area = size; this.place(); cx.notify();
    };
    const message = text => div().max_w(260).text_size(12.5).text_color(t.muted).text_center().child(text);
    let body;
    if ((live || booting) && this.docked()) {
      // The device window covers this; it shows only while the window is placed.
      const g = this.geometry(avd);
      body = div().id("sim-area").size_full().flex().items_center().justify_center().on_size_change(sizeArea)
        .when(!this.helper && Boolean(this.status), el => el.child(message(this.status)))
        .when(this.helper && Boolean(g), el => el.child(div().w(g.w / zoom()).h(g.h / zoom()).rounded(8).bg(t.surface)));
    } else if (live) {
      body = div().id("sim-area").size_full().on_size_change(sizeArea).child(v_flex().size_full().items_center().justify_center().gap(10)
        .child(message(`${this.label(live)} is in its own window.`))
        .when(Boolean(this.host?.docks), el => el.child(button("sim-dock-big", "dock", "Show in the panel", cx => this.setMode("dock", cx), { primary: true }))));
    } else {
      // This session has no emulator running: start its own (or the one it had).
      const kinds = avd ? [this.label(avd)] : [...new Set(this.avds.map(a => this.label(a)))];
      body = div().id("sim-area").size_full().on_size_change(sizeArea).child(v_flex().size_full().items_center().justify_center().gap(10).px(10)
        .child(message(this.status || (avd ? "This session's emulator is stopped." : this.avds.length ? "This session has no emulator yet." : "")))
        .children(kinds.map(k => button(`sim-start-${k}`, "play", `Start ${k}`, cx => this.start(k, cx), { primary: true }))));
    }

    // A card, as Files and Changes draw theirs.
    return v_flex().id("root").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(header)
      .child(div().flex_1().min_h(0).p(PAD).child(body));
  }
}
