// harns-dock: shows Android emulators' own windows over the Simulator panel, so a device draws
// natively (the emulator's GPU frames, at its own rate) instead of through copied screenshots.
// Each session has its own emulator: the panel shows the focused session's, and the others keep
// running, hidden, for the agents still using them.
//
// herdr draws with DirectComposition, which covers child windows, so each device window is an
// owned popup instead: borderless, just above herdr's window (never above other apps), gone
// when herdr minimizes. It follows herdr's window through WinEvent hooks, not polling.
//
// The mod writes the state to a small file, only when it changes:
//
//   right bottom w h visible     gaps from the right and bottom of herdr's client area, and
//                                the size, in logical pixels; visible is 1 or 0
//   <title prefix>               the emulator to show ("Android Emulator - <avd>:"), or empty
//   <title prefix>...            every other running emulator, kept hidden
//
//   quit                         give every window back as a normal emulator window and exit
//
// The panel is anchored to the window's bottom-right corner, so a window resize keeps it in
// place here, in the same moment, without waiting for the mod.
//
// herdr's popups (menus, the palette) draw inside its window, under this one. After a click or
// key press in herdr, the helper asks `herdr-app status` whether an overlay is open, and steps
// aside until it closes.
//
//   harns-dock run <state file>
// Exits on its own when herdr's window goes away.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Dock {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  delegate void WinEventProc(IntPtr hook, uint ev, IntPtr h, int obj, int child, uint thread, uint time);
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr h; public uint msg; public IntPtr w, l; public uint time; public POINT pt; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc f, uint pid, uint thread, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc f, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr h, UIntPtr id, uint ms, IntPtr f);
  [DllImport("user32.dll")] static extern bool KillTimer(IntPtr h, UIntPtr id);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  const int GWL_STYLE = -16, GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8, WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
  const long WS_CHILD = 0x40000000, WS_POPUP = 0x80000000, WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000,
    WS_SYSMENU = 0x00080000, WS_MINMAX = 0x00030000, WS_EX_APPWINDOW = 0x00040000, WS_EX_TOOLWINDOW = 0x80;
  const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40;
  const uint EVENT_SYSTEM_FOREGROUND = 0x3, EVENT_SYSTEM_MINIMIZESTART = 0x16, EVENT_SYSTEM_MINIMIZEEND = 0x17, EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
  const uint WM_TIMER = 0x113, WM_QUIT = 0x12, WM_APP_STATE = 0x8001, WM_APP_INPUT = 0x8002, WM_APP_OVERLAYS = 0x8003;
  const int WM_LBUTTONUP = 0x202, WM_RBUTTONUP = 0x205, WM_MBUTTONUP = 0x208, WM_KEYUP = 0x101, WM_SYSKEYUP = 0x105;

  const uint WM_APP_SCAN = 0x8004;

  class Device { public IntPtr h; public List<IntPtr> tools = new List<IntPtr>(); }

  static IntPtr host;
  static Dictionary<string, Device> devices = new Dictionary<string, Device>();   // by title prefix
  static List<string> wanted = new List<string>();   // every session's emulator, from the state file
  static string current = "";    // the one the panel shows
  static double[] rect;          // right bottom w h, logical px from herdr's client bottom-right
  static bool visible, overlay;
  static IntPtr shownDev = IntPtr.Zero;
  static uint mainThread;
  static string herdrApp = "herdr-app";   // herdr's own executable, once its window is found
  static int checking;           // an overlay check running (0/1)
  static WinEventProc keepEvents; static HookProc keepMouse, keepKeys;   // delegates kept alive

  static List<IntPtr> TopLevel() {
    var found = new List<IntPtr>();
    EnumWindows((h, l) => { found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
  static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
  static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }

  static IntPtr FindHost() {
    // herdr's main window: the largest visible top-level window of a herdr-app process.
    IntPtr best = IntPtr.Zero; long area = 0;
    var herdr = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("herdr-app")) herdr.Add((uint)p.Id);
    foreach (var h in TopLevel()) {
      if (!herdr.Contains(Pid(h)) || !IsWindowVisible(h) || GetParent(h) != IntPtr.Zero) continue;
      RECT r; GetWindowRect(h, out r);
      long a = (long)(r.r - r.l) * (r.b - r.t);
      if (a > area) { area = a; best = h; }
    }
    // `herdr-app status` through the running app's own path: it needn't be on PATH.
    if (best != IntPtr.Zero) try { herdrApp = Process.GetProcessById((int)Pid(best)).MainModule.FileName; } catch { }
    return best;
  }

  static void Scan() {
    // Takes in the wanted emulators' windows as they appear (a few seconds after each starts),
    // and forgets the ones that closed.
    var gone = new List<string>();
    foreach (var kv in devices) if (!IsWindow(kv.Value.h)) gone.Add(kv.Key);
    foreach (var k in gone) devices.Remove(k);
    var missing = wanted.FindAll(p => !devices.ContainsKey(p));
    if (missing.Count == 0) return;
    var all = TopLevel();
    foreach (var prefix in missing) {
      foreach (var h in all) {
        if (!Title(h).StartsWith(prefix)) continue;
        var d = new Device { h = h };
        Adopt(d, all);
        devices[prefix] = d;
        break;
      }
    }
    Apply();
  }

  static void Apply() {
    if (!IsWindow(host)) { PostThreadMessage(mainThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero); return; }
    Device d;
    IntPtr want = devices.TryGetValue(current, out d) ? d.h : IntPtr.Zero;
    bool show = want != IntPtr.Zero && visible && !overlay && rect != null && rect[2] > 0 && rect[3] > 0 && !IsIconic(host) && IsWindowVisible(host);
    // Only one shows at a time; the others keep running, hidden.
    if (shownDev != IntPtr.Zero && (!show || shownDev != want)) { ShowWindow(shownDev, 0); shownDev = IntPtr.Zero; }
    if (!show) return;
    double s = GetDpiForWindow(host) / 96.0;
    RECT c; GetClientRect(host, out c);
    int w = (int)Math.Round(rect[2] * s), h = (int)Math.Round(rect[3] * s);
    var p = new POINT { x = c.r - (int)Math.Round(rect[0] * s) - w, y = c.b - (int)Math.Round(rect[1] * s) - h };
    ClientToScreen(host, ref p);
    // Just above herdr's window: owning it doesn't reorder a window that already exists, and
    // the top of the stack would cover other apps.
    IntPtr above = GetWindow(host, 3 /* GW_HWNDPREV */);
    uint z = above == want ? SWP_NOZORDER : 0;
    SetWindowPos(want, above == IntPtr.Zero ? IntPtr.Zero : above, p.x, p.y, w, h, z | SWP_NOACTIVATE | (shownDev == want ? 0 : SWP_SHOWWINDOW));
    shownDev = want;
  }

  static void Adopt(Device d, List<IntPtr> all) {
    // Borderless, owned by herdr's window (so it stays just above it, minimizes with it and has
    // no taskbar button), hidden until shown, with the emulator's side toolbar out of the way.
    IntPtr dev = d.h;
    long style = GetLong(dev, GWL_STYLE).ToInt64();
    bool child = (style & WS_CHILD) != 0;
    style = (style & ~(WS_CHILD | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINMAX)) | WS_POPUP;
    SetLong(dev, GWL_STYLE, new IntPtr(style));
    long ex = (GetLong(dev, GWL_EXSTYLE).ToInt64() & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW;
    SetLong(dev, GWL_EXSTYLE, new IntPtr(ex));
    if (child) SetParent(dev, IntPtr.Zero);
    SetLong(dev, GWLP_HWNDPARENT, host);
    SetWindowPos(dev, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    ShowWindow(dev, 0);
    uint emu = Pid(dev);
    foreach (var h in all) if (h != dev && Pid(h) == emu && IsWindowVisible(h)) { d.tools.Add(h); ShowWindow(h, 0); }
  }

  static void Release(Device d) {
    // Back to a normal emulator window, where the user can find it.
    IntPtr dev = d.h;
    if (!IsWindow(dev)) return;
    SetLong(dev, GWLP_HWNDPARENT, IntPtr.Zero);
    long style = (GetLong(dev, GWL_STYLE).ToInt64() & ~WS_POPUP) | WS_CAPTION | WS_SYSMENU | WS_MINMAX;
    SetLong(dev, GWL_STYLE, new IntPtr(style));
    long ex = (GetLong(dev, GWL_EXSTYLE).ToInt64() & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;
    SetLong(dev, GWL_EXSTYLE, new IntPtr(ex));
    SetWindowPos(dev, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    foreach (var t in d.tools) ShowWindow(t, 4);
  }

  static bool ReadState(string path) {
    // false on "quit". A half-written file (the mod rewrites it whole) is read again on its next change.
    string text;
    try { using (var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) using (var r = new StreamReader(f)) text = r.ReadToEnd(); }
    catch { return true; }
    var lines = text.Replace("\r", "").Split('\n');
    if (lines[0].Trim() == "quit") return false;
    var parts = lines[0].Trim().Split(' ');
    if (parts.Length < 5 || lines.Length < 2) return true;
    var next = new double[4];
    for (int i = 0; i < 4; i++) if (!double.TryParse(parts[i], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out next[i])) return true;
    rect = next; visible = parts[4] == "1";
    current = lines[1].Trim();
    wanted = new List<string>();
    for (int i = 1; i < lines.Length; i++) if (lines[i].Trim().Length > 0 && !wanted.Contains(lines[i].Trim())) wanted.Add(lines[i].Trim());
    // An emulator no longer listed (it stopped, or the mod let it go) is given back.
    var drop = new List<string>();
    foreach (var k in devices.Keys) if (!wanted.Contains(k)) drop.Add(k);
    foreach (var k in drop) { if (devices[k].h == shownDev) shownDev = IntPtr.Zero; Release(devices[k]); devices.Remove(k); }
    return true;
  }

  static void CheckOverlays() {
    // `herdr-app status` on a worker thread; the answer comes back as a message.
    if (Interlocked.Exchange(ref checking, 1) == 1) return;
    ThreadPool.QueueUserWorkItem(_ => {
      bool open = false;
      try {
        var psi = new ProcessStartInfo(herdrApp, "status") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true };
        using (var p = Process.Start(psi)) {
          string text = p.StandardOutput.ReadToEnd(); p.WaitForExit(2000);
          int i = text.IndexOf("\"overlays\"");
          if (i >= 0) { int a = text.IndexOf('[', i), b = text.IndexOf(']', a); open = a >= 0 && b > a && text.Substring(a + 1, b - a - 1).Trim().Length > 0; }
        }
      } catch { }
      checking = 0;
      PostThreadMessage(mainThread, WM_APP_OVERLAYS, new IntPtr(open ? 1 : 0), IntPtr.Zero);
    });
  }

  static int Main(string[] a) {
    if (a.Length < 2 || a[0] != "run") { Console.Error.WriteLine("usage: harns-dock run <state file>"); return 1; }
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: positions in real pixels
    string state = Path.GetFullPath(a[1]);
    mainThread = GetCurrentThreadId();

    host = FindHost();
    if (host == IntPtr.Zero) { Console.Error.WriteLine("herdr has no window"); return 2; }
    if (!ReadState(state)) return 0;

    var watcher = new FileSystemWatcher(Path.GetDirectoryName(state), Path.GetFileName(state));
    watcher.NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName;
    FileSystemEventHandler changed = (o, e) => PostThreadMessage(mainThread, WM_APP_STATE, IntPtr.Zero, IntPtr.Zero);
    watcher.Changed += changed; watcher.Created += changed;
    watcher.Renamed += (o, e) => PostThreadMessage(mainThread, WM_APP_STATE, IntPtr.Zero, IntPtr.Zero);
    watcher.EnableRaisingEvents = true;

    // herdr's window moving, resizing, minimizing or restoring: follow it in the same moment.
    uint herdrPid; uint herdrThread = GetWindowThreadProcessId(host, out herdrPid);
    keepEvents = (hook, ev, h, obj, child, thread, time) => {
      if (ev == EVENT_SYSTEM_FOREGROUND) { if (h == host) { Apply(); PostThreadMessage(mainThread, WM_APP_INPUT, IntPtr.Zero, IntPtr.Zero); } return; }
      if (h == host && obj == 0) Apply();
    };
    SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, keepEvents, herdrPid, herdrThread, 0);
    SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, keepEvents, herdrPid, herdrThread, 0);
    SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, keepEvents, 0, 0, 0);

    // A click or key release in herdr may have opened or closed one of its popups. The hooks only
    // post a message: input is never held up here.
    IntPtr me = GetModuleHandle(null);
    keepMouse = (code, w, l) => {
      int m = w.ToInt32();
      if (code >= 0 && (m == WM_LBUTTONUP || m == WM_RBUTTONUP || m == WM_MBUTTONUP) && GetForegroundWindow() == host)
        PostThreadMessage(mainThread, WM_APP_INPUT, IntPtr.Zero, IntPtr.Zero);
      return CallNextHookEx(IntPtr.Zero, code, w, l);
    };
    keepKeys = (code, w, l) => {
      int m = w.ToInt32();
      if (code >= 0 && (m == WM_KEYUP || m == WM_SYSKEYUP) && GetForegroundWindow() == host)
        PostThreadMessage(mainThread, WM_APP_INPUT, IntPtr.Zero, IntPtr.Zero);
      return CallNextHookEx(IntPtr.Zero, code, w, l);
    };
    SetWindowsHookEx(WH_MOUSE_LL, keepMouse, me, 0);
    SetWindowsHookEx(WH_KEYBOARD_LL, keepKeys, me, 0);

    // Twice a second: new emulator windows to take in, closed ones to forget, herdr still there.
    new Thread(() => {
      for (;;) { Thread.Sleep(500); PostThreadMessage(mainThread, WM_APP_SCAN, IntPtr.Zero, IntPtr.Zero); }
    }) { IsBackground = true }.Start();
    Scan();

    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      if (msg.msg == WM_APP_STATE) { if (!ReadState(state)) break; Scan(); Apply(); }
      else if (msg.msg == WM_APP_SCAN) { if (!IsWindow(host)) break; Scan(); }
      else if (msg.msg == WM_APP_INPUT) SetTimer(IntPtr.Zero, UIntPtr.Zero, 90, IntPtr.Zero);   // the popup draws first
      else if (msg.msg == WM_TIMER) {
        // Thread timers are one-shot here (a null window ignores the id passed in, so kill the
        // id the message carries).
        KillTimer(IntPtr.Zero, new UIntPtr((ulong)msg.w.ToInt64()));
        CheckOverlays();
      } else if (msg.msg == WM_APP_OVERLAYS) {
        bool open = msg.w.ToInt32() == 1;
        if (open != overlay) { overlay = open; Apply(); }
        if (open) SetTimer(IntPtr.Zero, UIntPtr.Zero, 250, IntPtr.Zero);   // until it closes
      }
    }
    foreach (var d in devices.Values) Release(d);
    return 0;
  }
}
