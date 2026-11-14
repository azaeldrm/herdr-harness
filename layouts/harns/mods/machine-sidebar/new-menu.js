// The + menu by a machine (or the tab bar's): a terminal, the agents installed there, a new space or worktree. It's
// machine-sidebar opened as a popup with props { newMenu: true, machine } (main.js hands it init and render), so the
// sidebar ships as one mod.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, machines, panes, knownAgents, exec, run, openOverlay, closeOverlay, props, window, keys, shared } from "herdr";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export class NewMenu {
  init(cx) {
    this.agents = [];
    this.loading = true;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props() ?? {};
    this.machine = Object.prototype.hasOwnProperty.call(p, "machine") ? p.machine : spaces().find(s => s.active)?.machine ?? null;
    cx.spawn(async cx => {
      try {
        const available = await knownAgents({ on: this.machine });
        this.agents = await Promise.all(available.map(async agent => {
          const commands = [...new Set([agent.run?.[0], agent.key].filter(Boolean))];
          let installed = false;
          for (const command of commands) {
            try {
              let result;
              if (this.machine === null && window()?.platform === "windows") {
                const escaped = command.replace(/'/g, "''");
                result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `if (Get-Command -Name '${escaped}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`]);
              } else {
                const escaped = command.replace(/'/g, "'\\''");
                result = await exec("sh", ["-lc", `command -v -- '${escaped}' >/dev/null 2>&1`], { on: this.machine });
              }
              if (result.code === 0) { installed = true; break; }
            } catch {}
          }
          return { ...agent, installed };
        }));
      }
      catch { this.failed = true; }
      finally { this.loading = false; }
      cx.notify();
    });
  }
  start(agent) {
    closeOverlay(props().overlay);
    const targetSpace = spaces().find(s => s.machine === this.machine && s.active)
      ?? spaces().find(s => s.machine === this.machine);
    if (targetSpace) run("tab.new", { name: agent.name, space: targetSpace.id, argv: agent.run });
    else run("space.new", { name: agent.name, machine: this.machine ?? "", argv: agent.run });
  }
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) action(); })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const targeted = Object.prototype.hasOwnProperty.call(props() ?? {}, "machine");
    const machine = machines().find(m => m.name === this.machine);
    const space = spaces().find(s => s.machine === this.machine && s.active) ?? spaces().find(s => s.machine === this.machine);
    const installed = this.agents.filter(a => a.installed);
    const choices = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    const start = a => this.start(a);
    return v_flex().min_h(0).w_full().h(Math.min(491, 167 + Math.max(1, choices.length) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (agent) start(agent);
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => {
        closeOverlay(props().overlay);
        if (targeted && !space) run("space.new", { machine: this.machine ?? "" });
        else run("tab.new", { space: space?.id });
      }, shortcut("tab.new"), !targeted || machine?.layout === "ready"))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child(targeted ? `Start on ${machine?.name ?? shared("machine.local-label") ?? "This computer"}` : "Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => start(a), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed && (!targeted || machine?.layout === "ready"))))
        .when(this.loading, el => el.child(div().px(9).py(6).text_color(t.dim).child("Checking installed agents…")))
        .when(!this.loading && this.failed, el => el.child(div().px(9).py(6).text_color(t.dim).child("Could not check installed agents")))
        .when(!this.loading && !this.failed && this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child("No launchable agents found"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => { closeOverlay(props().overlay); run("space.new", { machine: targeted ? this.machine : undefined }); }, shortcut("space.new"), !targeted))
      .child(this.row("worktree", svg("mods/machine-sidebar/icons/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space) && !targeted))
      .child(this.row("worktree-open", svg("mods/machine-sidebar/icons/branch.svg").size(14), "Open worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space) && !targeted));
  }
}
