import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, panes, focused, theme, run, window, shared } from "herdr";

import MachineData from "./machine-data.js";
import { current } from "./usage.js";

export default class WorkspaceStatus extends MachineData {
  init(props, cx) {
    // Redraws the bar once a second, for the shown machine, folder and branch.
    super.init(props, cx);
    if (shared("harness.status") === false) run("layout.hide", { id: "status" });
    cx.timer.every(1000, cx => cx.notify());
  }

  render() {
    const t = theme();
    const all = spaces();
    const space = all.find(s => s.active);
    const machine = space?.machine ?? null;
    const machineOf = new Map(all.map(s => [s.id, s.machine]));
    const list = agents().filter(a => machineOf.get(a.space) === machine);
    const needs = list.filter(a => a.status === "blocked").length;
    const focus = focused();
    const allPanes = panes();
    const pane = allPanes.find(p => p.pane === focus?.pane) ?? allPanes.find(p => p.focused);
    const cwd = focus?.cwd ?? pane?.cwd ?? space?.folder;
    const folder = String(cwd ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
    const usage = shared('machine.usage') ?? {};
    const clock = epoch => new Date(epoch * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const usageGroup = name => {
      const bar = (label, windowName, opacity) => {
        const limit = current(usage[name]?.[windowName]);
        const known = Number.isFinite(limit?.used);
        const percent = known ? limit.used : 0;
        return h_flex().flex_none().gap(4).items_center()
          .tooltip(`${name} ${label}: ${known ? `${Math.round(percent)}% used` : `unavailable${usage[name]?.error ? ` · ${usage[name].error.toLowerCase()}` : ''}`}${limit?.resetsAt ? ` · resets ${clock(limit.resetsAt)}` : ''}`)
          .child(div().w(14).flex_none().text_size(9).text_color(t.dim).child(label))
          .child(div().w(44).h(4).rounded(2).bg(t.border)
            .when(known, el => el.child(div().w(`${percent}%`).h(4).rounded(2).bg(percent > 90 ? '#d88179' : t.accent).opacity(percent > 90 ? 1 : opacity))));
      };
      const weekly = this.usageHover === name;
      return h_flex().id(`bottom-usage-${name.toLowerCase()}`).flex_none().gap(8).items_center()
        .on_hover((on, cx) => {
          if (on) this.usageHover = name;
          else if (this.usageHover === name) this.usageHover = null;
          cx.notify();
        })
        .child(svg(name === 'Claude' ? 'icons/claude.svg' : 'brand-assets/chatgpt-knot.svg').size(14).flex_none().text_color(t.muted))
        .child(weekly ? bar('7d', 'sevenDay', 0.5) : bar('5h', 'fiveHour', 1));
    };
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/harness-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.surface).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "hard-drive" : "monitor", space?.machine ?? shared("machine.local-label") ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .when(Boolean(folder), el => el.child(label("folder", folder)))
      .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`${needs} needs you`)))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(18).items_center()
        .when(shared("harness.quota.claude") !== false, el => el.child(usageGroup('Claude')))
        .when(shared("harness.quota.codex") !== false, el => el.child(usageGroup('Codex'))))
      .when(shared("harness.commands-hint") !== false, el => el.child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(`${window()?.platform === "macos" ? "⌘" : "Ctrl"} Shift P  commands`)));
  }
}
