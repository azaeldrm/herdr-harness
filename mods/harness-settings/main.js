import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, window, props, closeOverlay, layout, run } from "herdr";

const SECTIONS = [
  { id: "general", title: "General", icon: "mods/harness-chrome/laptop.svg" },
  { id: "sidebar", title: "Sidebar", icon: "mods/harness-chrome/sidebar.svg" },
  { id: "chat", title: "Chat", icon: "mods/harness-chrome/message.svg" },
  { id: "status", title: "Status bar", icon: "mods/harness-chrome/panel-bottom.svg" },
  { id: "simulator", title: "Simulator", icon: "mods/harness-simulator/smartphone.svg" },
];

const STYLES = [
  { id: "classic", name: "Classic", about: "Each machine boxed with its agents and stats." },
  { id: "tree", name: "Tree", about: "Agents hang from their machine on lines." },
];

const CONTEXT_BARS = [
  { id: "fill", name: "Fill", about: "Fills up as a session uses its context window: gray, amber past 75%, red past 90%." },
  { id: "health", name: "Health bar", about: "Drains as a session uses its context window: green, amber below 45% left, red below 25%." },
];

function find(node, id) {
  // The layout node with this id, if the layout has one.
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class HarnessSettings extends View {
  init(_props, cx) {
    this.section = SECTIONS.some(s => s.id === props()?.section) ? props().section : "general";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.name = InputState.new({ placeholder: shared("harness.local-hostname") ?? "This computer" });
    this.name.set_value(String(shared("harness.local-name") ?? ""));
    this.name.on("change", () => {
      const value = this.name.value();
      setShared("harness.local-name", value);
      setShared("machine.local-label", value.trim() || shared("harness.local-hostname") || "This computer");
    });
    this.name.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.name.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
  }

  heading(t, text) {
    // A group's title, as Herdr's settings write them.
    return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text.toUpperCase());
  }

  row(t, title, about, control) {
    // One setting: what it is on the left, the control on the right.
    return h_flex().w_full().gap(16).py(12).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(14).text_color(t.foreground).child(title))
        .when(Boolean(about), el => el.child(div().text_size(12.5).line_height("18px").text_color(t.dim).child(about))))
      .child(div().flex_none().child(control));
  }

  toggle(t, id, on, onClick) {
    // An on/off switch, as Herdr's settings draw it.
    return div().id(id).w(36).h(20).rounded(10).p(2).cursor_pointer().bg(on ? t.accent : t.hover).flex()
      .when(on, el => el.justify_end()).on_click(onClick)
      .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground ?? t.background : t.muted));
  }

  flag(t, key, title, about, onChange) {
    // A row switching a shared value that's on unless set to false.
    const on = shared(key) !== false;
    return this.row(t, title, about, this.toggle(t, `flag-${key}`, on, () => { setShared(key, !on); onChange?.(!on); }));
  }

  general(t) {
    // This computer's name in the sidebar and the status bar.
    return v_flex().w_full()
      .child(this.heading(t, "This computer"))
      .child(this.row(t, "Name", "How this computer is called in the sidebar and the status bar. Empty: its hostname.",
        div().id("local-name").w(200).h(30).px(10).flex().items_center().rounded(7).border_1()
          .border_color(this.typing ? t.accent : t.border).bg(t.background).cursor_text()
          .child(Input.new(this.name).h_full().text_size(13).text_color(t.foreground))));
  }

  card(t, id, name, chosen, preview, onClick) {
    // One option as Herdr's settings show layouts: a picture of it, its name under it with a check when it's the one in
    // use, the chosen card outlined in amber.
    return v_flex().id(id).w(168).p(6).gap(8).rounded(10).border_1().border_color(chosen ? t.accent : "#00000000")
      .cursor_pointer().hover(s => s.bg(t.raised)).on_click(onClick)
      .child(div().w_full().h(92).p(10).flex().flex_col().justify_center().rounded(7).bg(t.surface ?? t.background).border_1().border_color(t.border).overflow_hidden()
        .child(preview))
      .child(h_flex().px(2).gap(6).items_center()
        .child(div().text_size(13.5).text_color(chosen ? t.foreground : t.muted).child(name))
        .when(chosen, el => el.child(svg("mods/harness-chrome/check.svg").size(13).text_color(t.accent))));
  }

  cards(t, options, chosen, preview, choose) {
    // A choice between options, drawn as cards, and what the chosen one does under them.
    const now = options.find(o => o.id === chosen);
    return v_flex().w_full().gap(10).pb(18).border_b(1).border_color(t.border)
      .child(h_flex().gap(10).flex_wrap()
        .children(options.map(o => this.card(t, `card-${o.id}`, o.name, o.id === chosen, preview(o.id), () => choose(o.id)))))
      .when(Boolean(now?.about), el => el.child(div().px(2).text_size(12.5).line_height("18px").text_color(t.dim).child(now.about)));
  }

  stylePreview(t, id) {
    // A machine with three agents, drawn small in a style: Classic boxed with its rings, Tree hanging from lines.
    const line = (w, c) => div().h(3).w(w).flex_none().rounded_full().bg(c);
    const dot = c => div().size(5).flex_none().rounded(1.5).bg(c);
    const agent = w => h_flex().gap(5).items_center().child(dot(t.muted)).child(line(w, t.dim));
    const header = h_flex().gap(5).items_center().child(dot(t.foreground)).child(line(34, t.muted));
    if (id === "classic") return v_flex().w_full().rounded(5).border_1().border_color(t.border).overflow_hidden()
      .child(v_flex().gap(5).px(6).py(5).bg(t.raised)
        .child(header)
        .child(h_flex().gap(4).children([0, 1, 2].map(() => div().size(5).rounded_full().border_1().border_color(t.accent)))))
      .child(v_flex().gap(6).px(6).py(6).children([62, 48, 56].map(agent)));
    return v_flex().gap(6)
      .child(header)
      .child(v_flex().relative().pl(10).gap(7)
        .child(div().absolute().left(2).top(-3).bottom(3).w(1).bg(t.dim))
        .children([62, 48, 56].map(w => h_flex().relative().child(div().absolute().left(-8).top(1).w(6).h(1).bg(t.dim)).child(agent(w)))));
  }

  barPreview(t, id) {
    // Three sessions' context bars as a style draws them: early, halfway, nearly full.
    const crit = "#d88179";
    const bars = id === "health"
      ? [[80, t.ansi2 ?? t.done], [40, t.working], [18, crit]]
      : [[30, t.muted], [80, t.working], [94, crit]];
    return v_flex().gap(11)
      .children(bars.map(([share, color]) => h_flex().gap(7).items_center()
        .child(div().size(5).flex_none().rounded(1.5).bg(t.muted))
        .child(div().w(96).h(4).rounded_full().bg(t.border)
          .child(div().h_full().rounded_full().w(Math.round(96 * share / 100)).bg(color)))));
  }

  sidebar(t) {
    // The sidebar's look (one of the styles) and how its agents' context bars read, each a row of picture cards.
    const style = ["classic", "contained"].includes(shared("harness.sidebar")) ? "classic" : "tree";
    const bar = shared("harness.context-bar") === "health" ? "health" : "fill";
    return v_flex().w_full()
      .child(this.heading(t, "Style"))
      .child(this.cards(t, STYLES, style, id => this.stylePreview(t, id), id => setShared("harness.sidebar", id)))
      .child(div().h(18))
      .child(this.heading(t, "Context bar"))
      .child(this.cards(t, CONTEXT_BARS, bar, id => this.barPreview(t, id), id => setShared("harness.context-bar", id)));
  }

  chat(t) {
    // herdr-chat's switches: agents as a chat, and the animation behind a new conversation.
    return v_flex().w_full()
      .child(this.heading(t, "Chat"))
      .child(this.flag(t, "herdr-chat.chat", "Open agents as a chat", "Off: agents' tabs show their terminal, without the Chat and Terminal switch.",
        on => { if (!on && find(layout(), "chat-view")) run("layout.select", { stack: "chat-view", child: "terminal-panel" }); }))
      .child(this.flag(t, "herdr-chat.animation", "Welcome animation", "The dimmed scene behind a new conversation: sharks, jellyfish, a night sky or rain."));
  }

  status(t) {
    // The status bar at the bottom, and what it shows.
    return v_flex().w_full()
      .child(this.heading(t, "Status bar"))
      .child(this.flag(t, "harness.status", "Show the status bar", "The bar under the work area.",
        on => run(on ? "layout.show" : "layout.hide", { id: "status" })))
      .child(this.flag(t, "harness.quota.claude", "Claude Code quota", "Its 5-hour window, and 7 days while hovered."))
      .child(this.flag(t, "harness.quota.codex", "Codex quota", "Its 5-hour window, and 7 days while hovered."))
      .child(this.flag(t, "harness.commands-hint", "Commands hint", "The shortcut that opens the command palette, at the right end."));
  }

  simulator(t) {
    // Whether the tab bar offers the Simulator panel.
    const supported = ["windows", "linux"].includes(window()?.platform);
    const on = shared("harness.simulator") !== false;
    return v_flex().w_full()
      .child(this.heading(t, "Simulator"))
      .child(this.row(t, "Show the Simulator", supported ? "A device for each session, in a panel beside the chat." : "Needs Windows or Linux.",
        supported ? this.toggle(t, "simulator-on", on, () => setShared("harness.simulator", !on)) : div()));
  }

  render() {
    const t = theme();
    const nav = v_flex().flex_none().w(190).h_full().p(10).gap(2).border_r(1).border_color(t.border)
      .child(div().px(10).pt(6).pb(12).text_size(16).font_semibold().text_color(t.foreground).child("harns"))
      .children(SECTIONS.map(s => {
        const on = s.id === this.section;
        return h_flex().id(`hs-${s.id}`).gap(10).px(10).py(7).items_center().rounded(7).cursor_pointer()
          .bg(on ? t.raised : "#00000000").hover(st => st.bg(t.raised))
          .on_click((_e, cx) => { this.section = s.id; cx.notify(); })
          .child(svg(s.icon).size(15).text_color(on ? t.accent : t.dim))
          .child(div().flex_1().text_size(13.5).text_color(on ? t.foreground : t.muted).child(s.title));
      }));
    const page = { general: () => this.general(t), sidebar: () => this.sidebar(t), chat: () => this.chat(t), status: () => this.status(t), simulator: () => this.simulator(t) }[this.section];
    return h_flex().id("harness-settings").track_focus(this.handle).w_full().h(480).items_start()
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); closeOverlay(props()?.overlay); } })
      .child(nav)
      .child(div().id("hs-body").flex_1().min_w(0).h_full().overflow_y_scroll()
        .child(div().px(28).py(22).child(page())));
  }
}
