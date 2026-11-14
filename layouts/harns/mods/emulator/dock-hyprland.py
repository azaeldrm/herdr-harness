"""harns-dock for Hyprland: shows Android emulators' own windows over the Simulator panel.

The Linux counterpart of dock.cs, reading the same state file the mod writes when it changes:

  right bottom w h visible     gaps from the right and bottom of herdr's window, and the size, in
                               logical pixels; visible is 1 or 0
  <title prefix>               the emulator to show ("Android Emulator - <avd>:"), or empty
  <title prefix>...            every other running emulator, kept hidden

  quit                         give every window back as a normal emulator window and exit

While it runs, a window rule makes every emulator window open floating and borderless on a hidden
workspace, so a new one never tiles beside herdr; the panel's emulator is brought onto herdr's
workspace, placed over the panel and raised. Everything goes through Hyprland's and herdr's own
sockets, so nothing starts a process while it follows the window. It steps aside while one of
herdr's popups is open, and gives the windows back when herdr's window goes away.

  python3 dock-hyprland.py run <state file> <herdr-app.sock>
"""
import json
import os
import socket
import sys
import time

HIDDEN = "special:harns-simulator"
RULE = "harns-simulator"
EMULATOR = "Emulator"
HERDR = "herdr-app"
TICK = 0.1
CORRECT = 0.15


def hypr(command):
    """One request to Hyprland's command socket; its answer."""
    path = os.path.join(os.environ.get("XDG_RUNTIME_DIR", ""), "hypr", os.environ.get("HYPRLAND_INSTANCE_SIGNATURE", ""), ".socket.sock")
    s = socket.socket(socket.AF_UNIX)
    s.settimeout(2)
    try:
        s.connect(path)
        s.sendall(command.encode())
        out = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                return out.decode("utf-8", "replace")
            out += chunk
    finally:
        s.close()


def dispatch(lua):
    """Runs one of Hyprland's dispatchers, given as Lua."""
    hypr("dispatch " + lua)


def target(window):
    """The Lua selector for one window."""
    return 'window = "address:%s"' % window["address"]


def overlay_open(herdr_socket):
    """Whether one of herdr's popups is open, from its status over its socket."""
    s = socket.socket(socket.AF_UNIX)
    s.settimeout(1)
    try:
        s.connect(herdr_socket)
        s.sendall(b'{"status": true}\n')
        out = b""
        while not out.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            out += chunk
        return bool(json.loads(out.decode() or "{}").get("overlays"))
    except (OSError, ValueError):
        return False
    finally:
        s.close()


def read_state(path):
    """The state file: None on "quit", else (rect, visible, current prefix, every wanted prefix)."""
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().replace("\r", "").split("\n")
    except OSError:
        return ((0, 0, 0, 0), False, "", [])
    if lines[0].strip() == "quit":
        return None
    parts = lines[0].split()
    try:
        rect = tuple(float(p) for p in parts[:4])
    except ValueError:
        rect = (0, 0, 0, 0)
    wanted = [l.strip() for l in lines[1:] if l.strip()]
    return (rect if len(rect) == 4 else (0, 0, 0, 0), len(parts) > 4 and parts[4] == "1", lines[1].strip() if len(lines) > 1 else "", wanted)


def matches(title, prefix):
    """Whether an emulator window's title is this device's: "Android Emulator - <avd>:5554", or without the port once it boots."""
    return bool(prefix) and (title.startswith(prefix) or title == prefix.rstrip(":"))


def set_rule(enabled):
    """The window rule that keeps new emulator windows floating, borderless and hidden until placed."""
    if enabled:
        hypr('eval hl.window_rule({ name = "%s", enabled = true, match = { class = "^(%s)$" }, float = true, '
             'workspace = "%s silent", no_border = true, no_shadow = true, rounding = 0, no_anim = true })' % (RULE, EMULATOR, HIDDEN))
    else:
        hypr('eval hl.window_rule({ name = "%s", enabled = false })' % RULE)


class Dock:
    def __init__(self, state_path, herdr_socket):
        self.state_path = state_path
        self.herdr_socket = herdr_socket
        self.state = ((0, 0, 0, 0), False, "", [])
        self.mtime = None
        self.placed = {}
        self.adopted = set()
        self.herdr_gone = None

    def adopt(self, window):
        """Takes in an emulator window that opened before the rule: floating, borderless, hidden."""
        if window["address"] in self.adopted:
            return
        self.adopted.add(window["address"])
        if not window["floating"]:
            dispatch('hl.dsp.window.float({ action = "enable", %s })' % target(window))
        for prop, value in (("no_anim", "1"), ("border_size", "0"), ("rounding", "0"), ("no_shadow", "1")):
            dispatch('hl.dsp.window.set_prop({ prop = "%s", value = "%s", %s })' % (prop, value, target(window)))
        if window["workspace"]["name"] != HIDDEN:
            self.hide(window)

    def hide(self, window):
        self.placed.pop(window["address"], None)
        dispatch('hl.dsp.window.move({ workspace = "%s", follow = false, %s })' % (HIDDEN, target(window)))

    def show(self, window, herdr, rect):
        """Puts the panel's emulator on herdr's workspace, over the panel's screen area, above herdr: one correction a
        look (workspace, then size, then place), from where the window really is, since Hyprland resizes around its middle."""
        right, bottom, w, h = rect
        w, h = round(w), round(h)
        x = round(herdr["at"][0] + herdr["size"][0] - right - w)
        y = round(herdr["at"][1] + herdr["size"][1] - bottom - h)
        address = window["address"]
        if time.time() - self.placed.get(address, 0) < CORRECT:
            return
        off = lambda a, b: abs(a - b) > 1
        if window["workspace"]["id"] != herdr["workspace"]["id"]:
            dispatch('hl.dsp.window.move({ workspace = "%s", follow = false, %s })' % (herdr["workspace"]["id"], target(window)))
            dispatch('hl.dsp.window.alter_zorder({ mode = "top", %s })' % target(window))
        elif off(window["size"][0], w) or off(window["size"][1], h):
            dispatch("hl.dsp.window.resize({ x = %d, y = %d, %s })" % (w, h, target(window)))
        elif off(window["at"][0], x) or off(window["at"][1], y):
            dispatch("hl.dsp.window.move({ x = %d, y = %d, %s })" % (x, y, target(window)))
        else:
            return
        self.placed[address] = time.time()

    def release(self, window):
        """Back to a normal emulator window on the workspace in front, where the user can find it."""
        monitors = json.loads(hypr("j/monitors") or "[]")
        front = next((m["activeWorkspace"]["id"] for m in monitors if m.get("focused")), None)
        for prop in ("no_anim", "border_size", "rounding", "no_shadow"):
            dispatch('hl.dsp.window.set_prop({ prop = "%s", value = "unset", %s })' % (prop, target(window)))
        if front is not None and window["workspace"]["name"] == HIDDEN:
            dispatch('hl.dsp.window.move({ workspace = "%s", follow = false, %s })' % (front, target(window)))

    def windows(self):
        clients = json.loads(hypr("j/clients") or "[]")
        herdrs = [c for c in clients if c["class"] == HERDR and c["mapped"]]
        herdr = max(herdrs, key=lambda c: c["size"][0] * c["size"][1]) if herdrs else None
        return herdr, [c for c in clients if c["class"] == EMULATOR]

    def tick(self):
        """One look: the state file if it changed, then each emulator window where it belongs. False to exit."""
        try:
            mtime = os.stat(self.state_path).st_mtime
        except OSError:
            mtime = None
        if mtime != self.mtime:
            self.mtime = mtime
            state = read_state(self.state_path)
            if state is None:
                return False
            self.state = state
        rect, visible, current, wanted = self.state
        herdr, emulators = self.windows()
        if herdr is None:
            self.herdr_gone = self.herdr_gone or time.time()
            return time.time() - self.herdr_gone < 5
        self.herdr_gone = None
        devices = {}
        for prefix in wanted:
            device = next((e for e in emulators if matches(e["title"], prefix)), None)
            if device:
                devices[prefix] = device
        mine = {d["address"] for d in devices.values()}
        pids = {d["pid"] for d in devices.values()}
        for e in emulators:
            if e["address"] in mine or e["pid"] in pids:
                self.adopt(e)
        for e in emulators:
            if e["pid"] in pids and e["address"] not in mine and e["workspace"]["name"] != HIDDEN:
                self.hide(e)
        on_screen = (visible and current in devices and rect[2] > 0 and rect[3] > 0
                     and not herdr["workspace"]["name"].startswith("special") and not overlay_open(self.herdr_socket))
        for prefix, device in devices.items():
            if on_screen and prefix == current:
                self.show(device, herdr, rect)
            elif device["workspace"]["name"] != HIDDEN:
                self.hide(device)
        return True

    def finish(self):
        set_rule(False)
        try:
            _, emulators = self.windows()
        except (OSError, ValueError):
            return
        for e in emulators:
            if e["address"] in self.adopted or e["workspace"]["name"] == HIDDEN:
                self.release(e)


def main(args):
    if len(args) < 3 or args[0] != "run":
        sys.stderr.write("usage: dock-hyprland.py run <state file> <herdr-app.sock>\n")
        return 1
    if not os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        sys.stderr.write("dock-hyprland.py: not running under Hyprland\n")
        return 1
    dock = Dock(args[1], args[2])
    set_rule(True)
    try:
        while True:
            try:
                if not dock.tick():
                    break
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(TICK)
    finally:
        dock.finish()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
