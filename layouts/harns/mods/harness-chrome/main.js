import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, agents, openOverlay } from "herdr";

const logoSrc = () => agents().some(a => a.status === "working")
  ? "mods/harness-chrome/harness-logo-fade.webp"
  : "mods/harness-chrome/harness-logo-bob.webp";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// The rail is twice the sidebar's icon axis (26 px in), so what it centres lines up with the open sidebar's icons; macOS
// needs it wider for the traffic lights.
const RAIL = 52;

function toggleSidebar() {
  // To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : RAIL });
}

export default class WorkspaceChrome extends View {
  button(id, label, action, size = 26, tip = null) {
    const t = theme();
    return div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), el => el.tooltip(tip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      // Settings and Add machine as icons side by side (smaller on the rail, so both still fit); an update ready dots the gear.
      // Open: the gear on the sidebar's icon axis, 26 px in (12 + half of 28). On the rail: the gear in the icon column and the
      // server in the status column, the same 16 and 14 px slots 6 px apart as the rows above.
      const size = collapsed ? 24 : 28;
      const icon = (id, name, tip, action, dot = false) => div().id(id).relative().size(size).flex_none().flex().items_center().justify_center()
        .rounded(7).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip(tip)
        .on_click(action).child(svg(`mods/harness-chrome/${name}.svg`).size(15))
        .when(dot, el => el.child(div().absolute().top(3).right(3).size(6).rounded_full().bg(t.accent)));
      const ready = Boolean(updates().app.ready);
      const gear = icon("settings", "settings", ready ? "Settings · update ready" : "Settings", () => run("app.settings"), ready);
      const machine = icon("machine", "server", "Add machine", () => run("mod.open", { name: "machine-add" }));
      const harns = icon("harns-settings", "harness-logo-mono", "harns settings",
        () => openOverlay({ mod: "harness-settings", kind: "dialog", width: 760 }));
      if (collapsed) return h_flex().size_full().bg(t.surface).items_center().justify_center().gap(2)
        .child(gear.w(22)).child(machine.w(22));
      return h_flex().size_full().bg(t.surface).items_center().gap(2).px(12).child(gear).child(machine).child(harns);
    }
    // The logo on the sidebar's icon axis, 26 px in (12 + half of 28), as the agents' icons and the footer's gear.
    return h_flex().size_full().bg(t.surface).pl(collapsed ? 6 : 12).pr(10).gap(4).items_center().text_size(13.5)
      // On the rail, the logo centred.
      .when(collapsed, el => el.pl(0).pr(0).justify_center().child(this.button("sidebar-expand", image(logoSrc()).size(28).rounded(5), toggleSidebar, 28, "Expand sidebar").cursor_pointer()))
      .when(window()?.platform === "macos" && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center()
        // The same 28 px button and logo as the rail's.
        .child(this.button("sidebar-collapse-logo", image(logoSrc()).size(28).rounded(5), toggleSidebar, 28, "Collapse sidebar"))
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child("harns"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/harness-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      .when(!collapsed, el => el.child(this.button("sidebar-toggle", svg("mods/harness-chrome/sidebar.svg").size(15), toggleSidebar)));
  }
}
