import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Popup, ScrollHandle } from "gpui-base";
import { machines, agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, nextCommand, openOverlay, closeOverlay, props, layout, hc, notify, home, watchFolder } from "herdr";

import { machineMetrics } from "./machine-metrics.js";
import { refreshContext } from "./context.js";
import { machineDetails } from "./details.js";
import { osOf } from "./os.js";
import { look, changedHosts, machinesChanged } from "./turns.js";
import { agentFolder } from "./sessions.js";
import { NewMenu } from "./new-menu.js";
import { find, narrow } from "./layout.js";

const localMachineLabel = () => shared("machine.local-label") ?? "This computer";
const statsFor = (machine, t) => machineMetrics(machine, false, t);
const classic = () => ["classic", "contained"].includes(shared("harness.sidebar"));
const mix = (a, b, share) => {
  // Hex color a laid over b at share (0 to 1), as one solid color; b when either isn't a 6-digit hex.
  const rgb = c => /^#[0-9a-f]{6}/i.test(c ?? "") ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : null;
  const [x, y] = [rgb(a), rgb(b)];
  if (!x || !y) return b;
  return "#" + x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, "0")).join("");
};
const treeLines = (t, x, elbowAt, down, elbow, from = 0, reach = 9) => {
  // A tree's lines in a row at x px, starting from px above it: on down past the row, and an elbow reach px into it elbowAt px down.
  const color = mix(t.dim, t.surface, 0.4);
  return [
    ...(down ? [div().absolute().left(x).top(from).bottom(0).w(1).bg(color)] : []),
    ...(elbow ? [div().absolute().left(x).top(from).w(reach).h(elbowAt - from).overflow_hidden()
      .child(div().absolute().left(0).bottom(0).w(2 * reach).h(Math.max(elbowAt - from, 2 * reach)).border_l(1).border_b(1).border_color(color).rounded_bl(reach))] : []),
  ];
};
const underMachine = (t, rows, last, elbowAt) => {
  // One of a machine's agents or terminals, its rows hung from the machine's icon, 18 px in.
  return rows.map((r, i) => v_flex().relative().w_full().flex_none().pl(28).child(r)
    .children(treeLines(t, 17, elbowAt, !last, i === 0, 0, 10)));
};


const healthBars = () => shared("harness.context-bar") === "health";
const contextText = used => healthBars() ? `${Math.round(100 - used)}% left` : `${Math.round(used)}% used`;

function contextBar(t, used, width, height = 3) {
  // The context window as harns's Settings chose: filling with what's used (gray, amber past 75%, red past 90%), or
  // as a health bar draining to what's left (green, amber below 45% left, red below 25%).
  const health = healthBars(), share = health ? 100 - used : used;
  const color = health ? (share < 25 ? "#d88179" : share < 45 ? t.working : t.ansi2 ?? t.done) : (share > 90 ? "#d88179" : share > 75 ? t.working : t.muted);
  return div().w(width).h(height).flex_none().rounded_full().bg(t.border)
    .when(share > 0, el => el.child(div().h_full().rounded_full().w(Math.max(2, Math.round(width * share / 100))).bg(color)));
}


const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function harnessSessionTitle(l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const prefixes = [prog, l?.program?.key, l?.app === "pi" ? "\u03c0" : null].filter(Boolean);
  const separators = [" - ", " \u2014 ", " \u2013 ", " | ", ": "];
  let session = live;
  for (const prefix of prefixes) {
    const start = session.toLowerCase();
    const name = prefix.toLowerCase();
    const separator = separators.find(s => start.startsWith(`${name}${s}`));
    if (separator) { session = session.slice(prefix.length + separator.length).trim(); break; }
  }
  const folder = folderName(l?.cwd);
  const suffix = folder && separators.find(s => session.endsWith(`${s}${folder}`));
  if (suffix) session = session.slice(0, -(suffix.length + folder.length)).trim();
  else if ((l?.app === "codex" || l?.program?.key === "codex") && session.includes(" | ")) session = session.slice(0, session.lastIndexOf(" | ")).trim();
  const telling = session && session !== prog && !/^[~/]|^[A-Za-z]:\\/.test(session) && !session.includes("@") && session.toLowerCase() !== l?.program?.key && session !== folder;
  return telling ? session : "";
}
// The agent's own branch: its pane's folder's, as Herdr reads it (panes().branch), else its space's (the first terminal's
// there): every agent in one space showed that one branch, as all of a remote machine's sessions in its home space.
const paneBranch = a => panes().find(p => p.pane === a.pane)?.branch ?? spaces().find(s => s.id === a.space)?.branch ?? null;
const folderName = path => String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const kidStatus = (k, listed) => {
  // A sub-agent without a pane isn't in agents(): its raw word, error counting as blocked.
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function icon(p, size, color) {
  // The agent's icon from the app's program table: a one-color glyph or a picture.
  if (!p?.icon) return null;
  return p.icon.endsWith('.svg') ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// One hop of a working agent's logo, up and down, in ms; GROUND: where its feet land in the 16 px icon slot (the logo
// ends about 8 px into its 12 px box, which sits at top 10).
const HOP_MS = 700, GROUND = 18.8;
// Eight 1 px nudges: copies of a glyph at these offsets, in the background's color, make a halo that follows its outline.
const HALO = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function badgeOf(p, size, color, ring) {
  // A program's logo set on the bot: a one-color glyph sits on a halo of itself in the row's color (copies nudged 1 px
  // every way), which hides the bot behind it and fills the glyph's small gaps, shaped like the logo; a picture, which
  // can't be recolored, sits on a disc of that color. Its box is the logo plus 1 px all round.
  if (!p?.icon) return null;
  if (!p.icon.endsWith('.svg')) return div().p(1).rounded_full().bg(ring).child(image(p.icon).w(size).h(size).flex_none());
  return haloed(p.icon, size, color, ring);
}

function haloed(src, size, color, ring) {
  // A one-color glyph on a halo of itself in the row's color: copies nudged 1 px every way, under it.
  const glyph = (dx, dy, c) => svg(src).size(size).flex_none().text_color(c).absolute().left(1 + dx).top(1 + dy);
  return div().relative().size(size + 2).flex_none()
    .children(HALO.map(([dx, dy]) => glyph(dx, dy, ring)))
    .child(glyph(0, 0, color));
}

function agentPic(t, p, size, color, ring, sub = false, hop = false, tint = null, corner = null) {
  // The agent icon (a sub-agent's: the same bot without its antenna), with its program's icon small at its bottom right
  // on a halo of the row's color (badgeOf). `hop` (working; the view's beat, { n, up, go }): that logo hops in amber
  // from side to side over the bot, its halo masking the bot as it passes, a ripple spreading where it lands.
  const bot = svg(`mods/machine-sidebar/icons/${sub ? "bot-small" : "bot"}.svg`).size(size).flex_none().text_color(color);
  // The logo's color: amber while it hops (working), else `tint` (amber, still: it needs you mid-task), else the row's.
  const badge = badgeOf(p, Math.round(size * 0.65), hop ? t.working : tint ?? color, ring);
  // `corner`: a mark on its own halo right above the logo (its column, right -5), as if the logo spoke: "ask" (it needs
  // you) a red question mark, the health bar's red; "done" (finished, not yet looked at) the green check.
  const mark = corner === "ask" ? ["mods/machine-sidebar/icons/question.svg", "#d88179"]
    : corner === "done" ? ["mods/machine-sidebar/icons/circle-check.svg", t.ansi2 ?? t.done] : null;
  const cornerMark = () => haloed(mark[0], Math.round(size * 0.6), mark[1], ring).absolute().right(-5).top(-3);
  if (!hop || !badge) return div().relative().size(size).flex_none().child(bot)
    .when(Boolean(badge), el => el.child(badge.absolute().right(-5).bottom(-4)))
    .when(Boolean(mark), el => el.child(cornerMark()));
  // The view's beat (hopTick) drives it, each step a native transition: across to the other side over one hop at an
  // even pace while it rises (slowing) and falls (speeding up), so it traces a round arc. Every landing starts a fresh
  // ripple ring there, spreading and fading, so ring and landing stay together however long it runs.
  const to = hop.n % 2 ? 12 : 7, landed = hop.n % 2 ? 7 : 12;
  const ripple = () => {
    // A thin oval (ripple.svg, stretched to its size), spreading fast and slowing as it fades.
    const w = hop.go ? 16 : 5, h = hop.go ? 4 : 1.4, policy = { duration: 480, easing: "ease-out" };
    return svg("mods/machine-sidebar/icons/ripple.svg").id(`ripple-${hop.n}`).absolute().left(landed + 6 - w / 2).top(GROUND - h / 2).w(w).h(h)
      .text_color(t.working).opacity(hop.go ? 0 : 0.9)
      .transition("width", policy).transition("height", policy).transition("left", policy).transition("top", policy).transition("opacity", policy);
  };
  return div().relative().size(size).flex_none().child(bot)
    .when(hop.n > 0, el => el.child(ripple()))
    .child(div().absolute().top(10).left(to).transition("left", { duration: HOP_MS, easing: "linear" })
      .child(badge.relative().top(hop.up ? -4 : 0).transition("top", { duration: HOP_MS / 2, easing: hop.up ? "ease-out" : "ease-in" })));
}

const READ_AFTER = [1000, 4000];

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.loginBar) return;
    // Opened as the + menu (a popup): that menu alone (new-menu.js).
    if (props()?.newMenu) { this.menu = new NewMenu(); this.menu.init(cx); return; }
    this.folded = new Set();
    this.hosts = {};
    this.retrying = {};
    this.refreshHosts(cx);
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    // The order of agents within each machine: dragged by hand, and an agent that finishes or needs you moves to the top.
    this.order = JSON.parse(localStorage.getItem("order") ?? "[]");
    this.drag = null; this.drop = null;
    this.machineOrder = JSON.parse(localStorage.getItem("machines.order") ?? "[]");
    this.mdrag = null; this.mdrop = null;
    // How far the list is scrolled, and how tall it and its rows are (px, as laid out): the edges fade where
    // more is out of sight. The scroll position can't be read, so the wheel's movements are followed.
    this.scrollY = 0; this.viewH = 0; this.rowsH = 0;
    // Each machine's system, for its icon (os.js), kept from the last run and asked again in this one: machine name ("" for this computer) -> icon name.
    try { this.osIcons = JSON.parse(localStorage.getItem("os") ?? "{}"); } catch { this.osIcons = {}; }
    this.osAsked = {};
    this.osConfirmed = new Set();
    // A reload starts the list at the top, where scrollY starts (the list would otherwise keep its old place).
    this.scrollHandle = ScrollHandle.new();
    this.scrollHandle.scroll_to_item(0);
    // The working logos' beat (agentPic): every half hop it lands (a new hop and ripple) or reaches the top of its arc.
    this.hop = { n: 0, up: false, go: false };
    cx.timer.every(HOP_MS / 2, (cx) => this.hopTick(cx));
    cx.timer.every(1000, (cx) => {
      this.noticeOs(cx);
      this.noticeTurns(cx);
      if (this.detailsWanted && Date.now() < this.detailsWanted.until) this.readDetails(this.detailsWanted.name, cx);
      cx.notify();
    });
    this.noticeTurns(cx);
    this.watchLocalContext(cx);
    // Keys bound to "machine-sidebar.next-machine" / ".prev-machine" (Alt+Shift+Down / Up in harns): the next machine's top agent.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "next-machine") this.jumpMachine(1);
        else if (c === "prev-machine") this.jumpMachine(-1);
      }
    });
  }

  jumpMachine(dir) {
    // Shows the top agent of the next machine (dir 1) or the previous one (-1) that has agents, in the list's order,
    // from the machine of the agent or terminal in front; past the last it comes round to the first.
    const listed = this.machineTops ?? [];
    if (!listed.length) return;
    const f = focused(), list = agents();
    const shown = f?.terminal ?? f?.agent ?? list.find(a => a.tab === f?.tab && a.space === f?.space)?.address
      ?? list.find(a => a.focused)?.address ?? "";
    const here = shown.includes("/") ? shown.split("/")[0] : "";
    const at = listed.findIndex(m => m.machine === here);
    const next = at < 0 ? (dir > 0 ? 0 : listed.length - 1) : (at + dir + listed.length) % listed.length;
    if (next !== at) run("agent.focus", { terminal: listed[next].top });
  }

  noticeOs(cx) {
    // Asks each machine that answers what it runs, once a run (the icon kept from the last run shows until it answers);
    // one that couldn't say is asked again a minute later.
    for (const m of machines()) {
      const key = m.name ?? "";
      if (this.osConfirmed.has(key) || Date.now() - (this.osAsked[key] ?? 0) < 60000 || (m.name && m.layout !== "ready")) continue;
      this.osAsked[key] = Date.now();
      cx.spawn(async (cx) => {
        const os = await osOf(m.name ?? null);
        if (!os) return;
        this.osConfirmed.add(key);
        this.osIcons[key] = os;
        try { localStorage.setItem("os", JSON.stringify(this.osIcons)); } catch {}
        cx.notify();
      });
    }
  }

  machineIcon(machine) {
    // Its system's icon once known, else a drive (another machine) or a screen (this computer).
    const os = this.osIcons?.[machine?.name ?? ""];
    return os ? `mods/machine-sidebar/os/${os}.svg` : `mods/machine-sidebar/icons/${machine?.name ? "hard-drive" : "monitor"}.svg`;
  }

  hopTick(cx) {
    // Half a hop: landing starts the next hop (its ripple drawn small, then let go to spread on the next frame), or the
    // top of the arc turns it down. Nothing to draw while no logo hops.
    if (!this.hopping) return;
    const h = this.hop;
    if (h.up) { h.up = false; cx.notify(); return; }
    h.n++; h.up = true; h.go = false;
    cx.notify();
    cx.timer.after(30, (cx) => { h.go = true; cx.notify(); });
  }

  headerIcon(machine) {
    // The icon a machine's header shows, open or on the rail: in Classic its system's, in Tree a server or this laptop.
    return classic() ? this.machineIcon(machine) : `mods/machine-sidebar/icons/${machine?.name ? "server" : "laptop"}.svg`;
  }

  noticeTurns(cx) {
    // Once a second: reads the context of machines where a turn ended, an agent came or went, or that came online.
    const now = look(agents(), machines());
    const first = !this.seen;
    if (!first && machinesChanged(this.seen, now)) this.refreshHosts(cx);
    this.due ??= [];
    for (const host of changedHosts(this.seen, now)) {
      if (first) refreshContext(this, cx, host);
      else for (const ms of READ_AFTER) this.due.push({ host, at: Date.now() + ms });
    }
    this.seen = now;
    const ready = this.due.filter(d => d.at <= Date.now());
    this.due = this.due.filter(d => d.at > Date.now());
    for (const host of new Set(ready.map(d => d.host))) refreshContext(this, cx, host);
  }

  watchLocalContext(cx) {
    // Reads this computer's context each time its relays write a snapshot.
    const sep = home().includes("\\") ? "\\" : "/";
    const dir = [home(), ".config", "harness", "context"].join(sep);
    cx.spawn(async cx => {
      for (;;) {
        try { await watchFolder(dir); } catch { return; }
        refreshContext(this, cx, null, { footers: false });
      }
    });
  }

  track(list, now) {
    // Stamps agents whose state changed; one that finished or started needing you, or is new, goes to the top of the order.
    let dirty = false;
    const seeding = this.order.length === 0;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (seeding) { this.order.push(a.address); continue; }
      const was = this.changed[a.address]?.s;
      if (!this.order.includes(a.address) || (was !== s && (s === "blocked" || (s === "idle" && was === "working")))) this.toTop(a.address);
    }
    if (seeding && list.length) localStorage.setItem("order", JSON.stringify(this.order));
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    const kept = this.order.filter(k => listed.has(k) || this.changed[k]);
    if (kept.length !== this.order.length) { this.order = kept; localStorage.setItem("order", JSON.stringify(kept)); }
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  wantDetails(name, cx) {
    // Reads a hovered machine's details now (if over 3 s old) and keeps them fresh for a while.
    this.detailsWanted = { name, until: Date.now() + 30000 };
    this.readDetails(name, cx);
  }

  readDetails(name, cx) {
    const key = name ?? "@local";
    this.details ??= {};
    if (this.detailsBusy?.[key] || Date.now() - (this.details[key]?.at ?? 0) < 3000) return;
    (this.detailsBusy ??= {})[key] = true;
    cx.spawn(async cx => {
      try { this.details[key] = { ...(await machineDetails(name)), at: Date.now() }; }
      finally { this.detailsBusy[key] = false; cx.notify(); }
    });
  }

  // Details cards (a machine's, an agent's), as herdr-t3's: hung from a 1 px point at the row's top-right corner, so
  // nothing covers the other rows; the first waits OPEN_AFTER, and while one is up (or was, under LIVE ago) the next opens at once.
  detailsEnter(key, cx) {
    const OPEN_AFTER = 450, LIVE = 400;
    this.hot = key;
    if (this.muted === key) return;
    this.detailsTimer?.cancel();
    if (this.detailsKey || Date.now() - (this.detailsClosed ?? 0) < LIVE) { this.detailsKey = key; cx.notify(); return; }
    this.detailsTimer = cx.timer.after(OPEN_AFTER, cx => { if (this.hot === key && !this.drag?.moved && !this.mdrag?.moved) { this.detailsKey = key; cx.notify(); } });
  }

  detailsLeave(key, cx) {
    // Closes a little after the pointer has left both the row and its card.
    if (this.hot === key) this.hot = null;
    cx.timer.after(150, cx => {
      if (this.detailsKey !== key || this.hot === key || this.overCard === key) return;
      this.detailsKey = null; this.detailsClosed = Date.now(); cx.notify();
    });
  }

  hang(key, card, edge = 8) {
    // The card, hung from the row's top-right corner (the row must be relative), while it's the one up: `edge` px further,
    // the row's distance from the sidebar's edge, so the card sits right against the sidebar.
    return Popup.new(`details-${key}`, div()).absolute().top(-1).right(-1).size(1)
      .when(this.detailsKey === key && !this.drag?.moved && !this.mdrag?.moved, pop => pop.content(div().id(`details-hover-${key}`).pl(edge)
        .on_hover((on, cx) => { if (on) this.overCard = key; else { if (this.overCard === key) this.overCard = null; this.detailsLeave(key, cx); } })
        .child(card)));
  }

  machineCard(t, machine, trigger, edge = 8) {
    // A machine's band (its header, and in Classic its rings); resting on it shows its details beside the sidebar, level
    // with it.
    const key = `m:${machine.name ?? "@local"}`;
    return div().id(`mtrig-${key}`).relative().w_full()
      .on_hover((on, cx) => {
        if (on) { this.wantDetails(machine.name, cx); this.detailsEnter(key, cx); }
        else { if (this.muted === key) this.muted = null; this.detailsLeave(key, cx); }
      })
      .child(trigger)
      .child(this.hang(key, this.detailsCard(t, machine), edge));
  }

  detailsCard(t, machine) {
    // A grid: each section a title (icon, name), then rows of label | bar | value in fixed columns, so every bar and value lines up.
    const key = machine.name ?? "@local";
    const d = this.details?.[key];
    const s = (shared("machine.stats") ?? {})[key];
    const fresh = s && !s.error && Date.now() - s.at <= 15000;
    const GB = 1024 ** 3;
    const gb = b => b == null ? "?" : (b / GB >= 100 ? Math.round(b / GB) : (b / GB).toFixed(1));
    const ok = v => Number.isFinite(v);
    const WARN = "#e8823a", CRIT = "#d88179";
    const level = (v, warn, crit) => v >= crit ? CRIT : v >= warn ? WARN : t.accent;
    const BAR = 148, LABEL = 44, VALUE = 90; // with the 18 px indent and two 8 px gaps: the card's 316 px inside
    const row = (label, fill, color, value) => h_flex().w_full().pl(18).gap(8).items_center().h(18)
      .child(div().w(LABEL).flex_none().text_size(11).text_color(t.dim).child(label))
      .child(div().w(BAR).h(4).flex_none().rounded_full().bg(t.border)
        .child(div().h_full().rounded_full().w(ok(fill) ? Math.max(2, Math.round(BAR * Math.max(0, Math.min(100, fill)) / 100)) : 0).bg(color)))
      .child(h_flex().w(VALUE).flex_none().justify_end().text_size(11).text_color(color === t.accent ? t.muted : color).child(value));
    const pct = v => ok(v) ? `${Math.round(v)}%` : "\u2013";
    // A size says it in GB and the bar shows the share; otherwise the share in numbers.
    const usage = (label, v, size) => row(label, v, ok(v) ? level(v, 80, 95) : t.dim, size ?? pct(v));
    const temp = c => ok(c) ? row("Temp", c, level(c, 70, 85), `${Math.round(c)}\u00b0C`) : null;
    const section = (icon, title, ...rows) => v_flex().w_full().gap(3)
      .child(h_flex().w_full().gap(6).items_center()
        .child(svg(`mods/machine-sidebar/stats/${icon}.svg`).size(12).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title)))
      .children(rows.filter(Boolean));
    const note = text => div().pl(18).text_size(11).text_color(t.dim).truncate().child(text);
    const up = sec => { if (!ok(sec)) return ""; const m = Math.floor(sec / 60), h = Math.floor(m / 60), dd = Math.floor(h / 24); return dd ? `up ${dd}d ${h % 24}h` : h ? `up ${h}h ${m % 60}m` : `up ${m}m`; };
    const card = v_flex().w(340).p(12).gap(10).rounded(10).border_1().border_color(t.border).bg(t.popover ?? t.raised).text_size(12).shadow_md()
      .child(h_flex().gap(10).items_center()
        .child(svg(this.machineIcon(machine)).size(26).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(machine.name || localMachineLabel()))
          .when(Boolean(d && !d.error), el => el.child(div().text_size(11).text_color(t.dim).truncate().child([d.os, up(d.uptime)].filter(Boolean).join(" \u00b7 "))))));
    if (!d) return card.child(div().text_color(t.dim).child("Reading details\u2026"));
    if (d.error) return card.child(div().text_color(t.dim).child(d.error));
    const used = d.memory.total && d.memory.available != null ? d.memory.total - d.memory.available : null;
    const memPct = fresh && ok(s.memory) ? s.memory : used != null ? 100 * used / d.memory.total : null;
    const memUsed = used ?? (ok(memPct) && d.memory.total ? d.memory.total * memPct / 100 : null);
    return card
      .child(section("cpu", d.cpu.model || "CPU",
        usage("Load", fresh ? s.cpu : null),
        temp(d.cpu.temp),
        note([d.cpu.cores && `${d.cpu.cores} cores`, d.cpu.threads && `${d.cpu.threads} threads`, d.load && `load ${d.load.map(x => x?.toFixed(2)).join(" ")}`].filter(Boolean).join(" \u00b7 "))))
      .child(section("ram", "Memory", usage("Used", memPct, `${gb(memUsed)} / ${gb(d.memory.total)} GB`)))
      // Only GPUs with something live to show (an integrated GPU nvidia-smi doesn't read is left out).
      .children(d.gpus.filter(g => g.load != null || g.temp != null || g.memTotal).map(g => section("gpu", g.name,
        ok(g.load) ? usage("Load", g.load) : null,
        g.memTotal ? usage("VRAM", 100 * g.memUsed / g.memTotal, `${gb(g.memUsed)} / ${gb(g.memTotal)} GB`) : null,
        temp(g.temp),
        ok(g.power) ? row("Power", g.powerLimit ? 100 * g.power / g.powerLimit : null, g.powerLimit ? level(100 * g.power / g.powerLimit, 85, 98) : t.dim,
          g.powerLimit ? `${Math.round(g.power)} / ${Math.round(g.powerLimit)} W` : `${Math.round(g.power)} W`) : null)))
      .children(d.disks.map(k => section("usage", `Disk ${k.mount}`, usage("Used", 100 * (k.total - k.free) / k.total, `${gb(k.total - k.free)} / ${gb(k.total)} GB`))))
      .when(Boolean(d.board), el => el.child(section("board", "Board", note(d.board))));
  }

  agentDetails(t, a, all, name) {
    // Status and for how long, its turn, where it runs (machine, space and tab, folder, branch), context used, and its sub-agents.
    const now = Date.now();
    const term = all.find(x => x.address === a.address);
    const since = term?.status_ms ?? this.since(a);
    const word = { working: "Working", blocked: "Needs you", done: "Finished \u00b7 not yet seen", idle: "Idle" };
    const color = { working: t.working, blocked: t.blocked, done: t.ansi2 ?? t.done }[a.status] ?? t.muted;
    const machine = a.address.includes("/") ? a.address.split("/")[0] : localMachineLabel();
    const tab = spaces().flatMap(s => s.tabs).find(x => x.id === a.tab);
    const folder = agentFolder(a, tab ? lead(tab) : null, all);
    const branch = paneBranch(a);
    const context = (shared("agents.context") ?? {})[a.address];
    const used = Number.isFinite(context?.percent) ? Math.max(0, Math.min(100, context.percent)) : null;
    const LABEL = 64;
    const row = (label, value) => h_flex().w_full().gap(8).items_start()
      .child(div().w(LABEL).flex_none().text_size(11).text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).whitespace_normal().text_color(t.muted).child(value));
    const kids = this.tree(all, a.address);
    return v_flex().w(340).p(12).gap(8).rounded(10).border_1().border_color(t.border).bg(t.popover ?? t.raised).text_size(12).shadow_md()
      .child(h_flex().w_full().gap(10).items_center()
        .child(icon(a.program, 26, t.muted) ?? svg("mods/machine-sidebar/icons/bot.svg").size(26).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().text_size(13.5).font_semibold().text_color(t.foreground).whitespace_normal().child(name || a.program?.name || a.address))
          .child(div().text_size(11).text_color(t.dim).truncate().child([a.program?.name, machine].filter(Boolean).join(" \u00b7 ")))))
      .child(row("Status", h_flex().gap(6).items_center()
        .child(div().text_color(color).child(word[a.status] ?? a.status))
        .when(Boolean(since), el => el.child(div().text_color(t.dim).child(`\u00b7 ${duration(now - since)}`)))
        .when(Number.isFinite(term?.turn), el => el.child(div().text_color(t.dim).child(`\u00b7 turn ${term.turn}`)))))
      .child(row("Space", [a.space_name, a.tab_name || (Number.isFinite(a.tab_index) ? `tab ${a.tab_index + 1}` : "")].filter(Boolean).join(" / ")))
      .when(Boolean(folder), el => el.child(row("Folder", folder)))
      .when(Boolean(branch), el => el.child(row("Branch", branch)))
      .child(row("Context", used == null ? "No reading yet" : h_flex().gap(8).items_center()
        .child(contextBar(t, used, 148, 4))
        .child(div().text_size(11).child(contextText(used)))))
      .when(kids.length > 0, el => el.child(v_flex().w_full().gap(4).pt(2)
        .child(div().text_size(11).text_color(t.dim).child(`Sub-agents \u00b7 ${kids.length}`))
        .children(kids.map(({ t: k, lines }) => {
          const st = kidStatus(k, this.listed);
          return h_flex().w_full().gap(6).items_center().pl(Math.max(0, lines.length - 1) * 12)
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(k.name || k.template || k.program?.name || k.address))
            .child(div().flex_none().text_size(11).text_color({ working: t.working, blocked: t.blocked }[st] ?? t.dim)
              .child([word[st] ?? st, k.status_ms ? duration(now - k.status_ms) : ""].filter(Boolean).join(" \u00b7 ")));
        }))));
  }

  noticeMoves(list, cx) {
    // Cards whose place within their machine changed since the last draw: each starts offset by the places it moved
    // (CARD px apiece), with a fresh id so its transition starts there, and slides to 0 a frame later.
    const CARD = 50;
    const machineOf = x => x.includes("/") ? x.split("/")[0] : "";
    const place = new Map(), count = {};
    for (const a of list) { const m = machineOf(a.address); place.set(a.address, count[m] = (count[m] ?? -1) + 1); }
    const before = this.places;
    this.places = place;
    if (!before) return;
    let moved = false;
    for (const [address, now] of place) {
      const was = before.get(address);
      if (was === undefined || was === now) continue;
      (this.slides ??= {})[address] = (was - now) * CARD;
      (this.moveGen ??= {})[address] = (this.moveGen[address] ?? 0) + 1;
      moved = true;
    }
    if (moved) cx.timer.after(32, cx => { this.slides = {}; cx.notify(); });
  }

  railCpu(t, machine) {
    // The rail band's CPU reading: its ring alone, centred under the machine's icon, in the open rings row's 22 px.
    const sample = (shared("machine.stats") ?? {})[machine ?? "@local"];
    const value = sample && !sample.error && Date.now() - sample.at <= 15000 && Number.isFinite(sample.cpu) ? sample.cpu : null;
    const name = machine ?? localMachineLabel();
    return h_flex().h(22).flex_none().items_center().justify_center()
      .child(div().id(`rail-cpu-${machine ?? "local"}`).tooltip(`${name} · CPU: ${value == null ? "unavailable" : `${Math.round(value)}%`}`)
        .child(svg(`mods/machine-sidebar/stats/rings/ring-${value == null ? 0 : Math.max(0, Math.min(100, Math.round(value)))}.svg`).size(12).flex_none()
          .text_color(value == null ? t.dim : t.accent)));
  }

  toTop(address) {
    this.order = [address, ...this.order.filter(x => x !== address)];
    localStorage.setItem("order", JSON.stringify(this.order));
  }

  moveTo(address, target, after) {
    // A dragged agent, put before (or after) another.
    if (address === target) return;
    const rest = this.order.filter(x => x !== address);
    const at = rest.indexOf(target);
    if (at < 0) return;
    rest.splice(after ? at + 1 : at, 0, address);
    this.order = rest;
    localStorage.setItem("order", JSON.stringify(this.order));
  }

  sortMachines(list) {
    // Machines in the order dragged to, the ones never dragged after them in Herdr's order.
    const at = name => { const i = this.machineOrder.indexOf(name ?? ""); return i < 0 ? Infinity : i; };
    return list.map((m, i) => [m, i]).sort(([a, i], [b, j]) => at(a.name) - at(b.name) || i - j).map(([m]) => m);
  }

  moveMachine(key, target, after) {
    // A dragged machine, put before (or after) another, and kept.
    if (key === target) return;
    const names = this.sortMachines(machines().filter(m => !m.temporary)).map(m => m.name ?? "");
    const rest = names.filter(x => x !== key);
    const at = rest.indexOf(target);
    if (at < 0) return;
    rest.splice(after ? at + 1 : at, 0, key);
    this.machineOrder = rest;
    localStorage.setItem("machines.order", JSON.stringify(rest));
  }

  boxed(t, g, index, items) {
    // A machine's rows as drawn, or in the Classic style one box: its band on top, a rule, then its agents and terminals.
    if (!classic() || !g.machine) return items;
    const [band, ...rest] = items;
    return [
      ...(index > 0 ? [div().h(12).flex_none()] : []),
      v_flex().w_full().flex_none().rounded(10).border_1().border_color(t.border).overflow_hidden()
        .child(band)
        .when(rest.length > 0, el => el.child(div().h(1).flex_none().bg(t.border)).child(v_flex().w_full().p(4).children(rest))),
    ];
  }

  setPins(pins) {
    this.pins = pins;
    localStorage.setItem("pins", JSON.stringify(pins));
  }

  prunePins(all) {
    // Drops pins of agents that ended.
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    const kept = this.pins.filter((p) => !heard.has(machine(p)) || live.has(p));
    if (kept.length !== this.pins.length) this.setPins(kept);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  refreshHosts(cx) {
    cx.spawn(async cx => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.hosts = Object.fromEntries((JSON.parse(r.stdout).machines ?? []).map(m => [m.name, m]));
      } catch {}
      cx.notify();
    });
  }

  retry(name, cx) {
    // Retry a machine that isn't connected.
    if (this.retrying[name]?.busy) return;
    this.retrying[name] = { busy: true };
    cx.notify();
    cx.spawn(async cx => {
      const failed = message => notify({ title: `Couldn't reconnect to ${name}`, body: message, level: "error" });
      try {
        const r = await hc(["machine", "login", name, "--json"]);
        let error = null;
        if (r.code !== 0) {
          try { error = JSON.parse(r.stdout || r.stderr).error ?? null; } catch {}
          error ??= { message: (r.stderr || r.stdout || "hc machine login failed").trim() };
        }
        if (!error) notify({ title: `Reconnected to ${name}`, level: "success", timeout: 4000 });
        else if (/terminal/i.test(error.message ?? "") || /types the password/i.test(error.hint ?? "")) await this.loginInTerminal(name, failed);
        else failed(error.message);
      } catch (e) {
        failed(String(e?.message ?? e));
      }
      this.retrying[name] = { busy: false };
      this.refreshHosts(cx);
      cx.notify();
    });
  }

  async loginInTerminal(name, failed) {
    const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 20);
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--name", `login-${slug}-${Date.now().toString(36).slice(-5)}`,
      "--", "hc", "machine", "login", name]).catch(() => null);
    let address = null;
    try { address = r?.code === 0 ? JSON.parse(r.stdout).address : null; } catch {}
    if (!address) return failed(`Couldn't open a terminal for it. Run \`hc machine login ${name}\` in one.`);
    openOverlay({
      kind: "dialog",
      key: `machine-login-${name}`,
      width: 640,
      height: 300,
      layout: {
        type: "column",
        children: [
          { type: "block", size: { px: 34 }, content: { mod: "machine-sidebar", props: { loginBar: name, terminal: address } } },
          { type: "block", content: { terminal: address } },
        ],
      },
    });
  }

  loginBar(t) {
    // The login dialog's title bar.
    const { loginBar: name, terminal } = props();
    return h_flex()
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .bg(t.chrome ?? t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .child(svg("mods/machine-sidebar/icons/hard-drive.svg").size(13).flex_none().text_color(t.dim))
      .child(div().flex_none().text_color(t.foreground).font_medium().child(`Log in to ${name}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child("Type the password or code below; this closes when it connects."))
      .child(div()
        .id("login-close")
        .size(20)
        .flex_none()
        .rounded(5)
        .flex()
        .items_center()
        .justify_center()
        .text_color(t.dim)
        .hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Cancel")
        .on_click(() => {
          run("terminal.kill", { terminal });
          closeOverlay(props().overlay);
        })
        .child(svg("mods/machine-sidebar/icons/x.svg").size(12)));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  tree(all, addr, lead = []) {
    // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = k.address === shown;
    // As an agent's row: the name white while it's working, finished or needs you (or is being looked at), gray when idle;
    // the icon gray, amber for the one being looked at. On the rail, where there's no name, the icon takes the name's
    // white or gray instead, so the same rows stand out open and folded.
    const bright = on || st !== "idle";
    const color = on ? t.accent : compact && bright ? t.foreground : t.muted;
    const ring = this.hoveredSub === k.address ? t.hover : on ? t.raised : t.surface;
    const pic = classic() ? icon(k.program, 14, color) : agentPic(t, k.program, 14, color, ring, true);
    const name = k.name || k.template || k.program?.name || k.address;
    // One box, open or on the rail: 26 px, its shade when looked at, hover, and a click to peek. Inside: open, the tree
    // lines, the icon, the name and its status; on the rail the icon alone, centred, with the name in its tooltip.
    const box = h_flex().id(`sub-${k.address}`).relative().h(26).flex_none().items_center().rounded(8)
      .when(on, (el) => el.bg(t.raised)).hover((s) => s.bg(t.hover)).cursor_pointer()
      .on_hover((over, cx) => {
        if (over) this.hoveredSub = k.address; else if (this.hoveredSub === k.address) this.hoveredSub = null;
        cx.notify();
      })
      .on_click(() => this.peek(k.address));
    if (compact) return box.justify_center().tooltip(name).child(pic ?? this.status(t, { status: st }, true));
    return box
      .pl(classic() ? 17 * s.lines.length + 17 : 23 * s.lines.length + 11)
      .pr(8)
      .text_size(12.5)
      .children(classic()
        ? s.lines.flatMap((l, j) => l ? [div().absolute().left(17 + 17 * j).top(0).w(1).bg(mix(t.dim, t.surface, 0.4))
          .when(l === "└", el => el.h(13)).when(l !== "└", el => el.bottom(0))] : [])
        : s.lines.flatMap((l, j) => treeLines(t, 17 + 23 * j, 13, l === "│" || l === "├", l === "├" || l === "└")))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(bright ? t.foreground : t.muted).child(name))
      .child(this.status(t, { status: st }));
  }

  plainTerminals(machine) {
    // The machine's panes that aren't agents: a shell, a dev server, lazygit.
    const key = machine.name ?? "";
    const agentPanes = new Set(agents().map((a) => a.pane).filter(Boolean));
    return panes().filter((p) => p.terminal && !agentPanes.has(p.pane)
      && (p.terminal.includes("/") ? p.terminal.split("/")[0] : "") === key);
  }

  terminalRows(t, machine, compact = false) {
    // The machine's plain terminals at the bottom of its group, under its agents, a row each: the program's icon in the
    // agent cards' icon column (their 2 px stripe and 8 px padding), the program running now, its folder. A click focuses
    // the pane and shows the Terminal view, as a shell has no chat. In Classic their count is in the machine's header. On
    // the rail (compact) just the icon, centred as the agents' are, with the rest in its tooltip.
    const shown = focused()?.pane;
    return this.plainTerminals(machine).map((p) => {
      const on = p.pane === shown, name = p.program?.name || p.title || "shell", where = folderName(p.cwd);
      const pic = icon(p.program, 16, on ? t.accent : t.muted) ?? svg("mods/machine-sidebar/icons/terminal.svg").size(15).flex_none().text_color(on ? t.accent : t.muted);
      const open = () => {
        run("pane.focus", { pane: p.pane });
        if (find(layout(), "chat-view")) run("layout.select", { stack: "chat-view", child: "terminal-panel" });
      };
      // One box, open or on the rail: its height, the agents' 2 px stripe column (amber on the rail for the one in front),
      // hover, tooltip and click. Inside: open, the icon, the program and its folder; on the rail the icon alone, centred.
      const box = h_flex().id(`term-${p.pane}`).h(28).flex_none().items_center().rounded(6).border_l(2)
        .border_color(on && compact ? t.accent : t.surface).when(on, (el) => el.bg(compact ? t.selected : t.raised))
        .hover((s) => s.bg(t.hover)).cursor_pointer()
        .tooltip([name, p.title && p.title !== name ? p.title : "", p.cwd].filter(Boolean).join(" · "))
        .on_click(open);
      if (compact) return box.justify_center().pr(2).child(h_flex().w(16).flex_none().justify_center().child(pic));
      return box.pl(8).pr(8).gap(10).text_size(12.5)
        .child(h_flex().size(16).flex_none().items_center().justify_center().child(pic))
        .child(div().flex_none().text_color(on ? t.foreground : t.muted).child(name))
        .when(Boolean(where), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(where)));
    });
  }

  status(t, a, compact = false) {
    // An agent's status mark (compact: a ! for blocked, under a "Needs you" header); hovering any of them gives the context window used.
    const context = a.address ? (shared('agents.context') ?? {})[a.address] : null;
    const known = Number.isFinite(context?.percent);
    const percent = known ? Math.max(0, Math.min(100, context.percent)) : 0;
    const state = { working: "Working", done: "Finished · not yet viewed", blocked: "Needs you" }[a.status];
    const tip = a.address ? `Context: ${known ? contextText(percent) : "unavailable"}${state ? ` · ${state}` : ""}` : state;
    const mark = el => div().size(14).flex_none().flex().items_center().justify_center().when(Boolean(tip), d => d.tooltip(tip)).child(el);
    // The spinner's picture has a clear margin (scripts/package.py), so it draws at 15 px to show the same 12 px ring.
    if (a.status === "working") return mark(svg("mods/machine-sidebar/icons/spinner.svg").size(15).flex_none().text_color(t.working).spin(900));
    if (a.status === "done") return mark(svg("mods/machine-sidebar/icons/circle-check.svg").size(13).flex_none().text_color(t.ansi2 ?? t.done));
    if (a.status === "blocked" && compact) return mark(div().size(14).rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!"));
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center()
      .when(Boolean(tip), d => d.tooltip(tip)).child("Needs you");
    // Idle: on the rail (compact) the 14 px context bar, as the open card shows under its icon; open, no mark.
    if (compact) return (known ? contextBar(t, percent, 14) : div().w(14).h(3).flex_none().rounded_full().bg(t.border)).when(Boolean(tip), d => d.tooltip(tip));
    return div().size(14).flex_none();
  }

  render(cx) {
    const t = theme();
    if (props()?.loginBar) return this.loginBar(t);
    if (this.menu) return this.menu.render();
    const collapsed = narrow();
    this.hopping = false;
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    const at = new Map(this.order.map((x, i) => [x, i]));
    list = [...list].sort((x, y) => (at.get(x.address) ?? -1) - (at.get(y.address) ?? -1));
    this.prunePins(all);
    const pinned = this.pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !this.pins.includes(a.address));
    list = [...pinned, ...rest];
    this.noticeMoves(list, cx);

    const withKids = (a, i) => {
      const subs = this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, collapsed))];
    };

    const fold = (a, subs) => {
      // The fold chevron; folded, the count too, colored by the most urgent one.
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/machine-sidebar/icons/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      const pane = tab ? lead(tab) : null;
      const source = pane ?? { title: a.title, program: a.program, app: a.app };
      return harnessSessionTitle(source) || source.program?.name || folderName(pane?.cwd) || tab?.name || "";
    };

    const row = (a, i, subs = []) => {
      // With the Health bar context bars (Tree) the logo carries the status (agentPic): it hops in amber while working;
      // a green check (finished, not yet looked at) or a red question mark (it needs you) sits above it. So the
      // spinner, check and "Needs you" badge go, and on the rail its second line is always the health bar.
      const logoStatus = !classic() && healthBars() && Boolean(a.program?.icon);
      const hops = logoStatus && a.status === "working", finished = logoStatus && a.status === "done", asks = logoStatus && a.status === "blocked";
      // The badge's ring is the card's own shade, so it sits on the card: hovered, in front, or plain.
      const ring = this.hovered === a.address ? t.hover : a.focused ? t.selected : t.surface;
      // The icons' color: the agent in front's amber, others gray; when the logo carries the status, white for the agent
      // in front (its logo still amber while it works or waits on you), gray for the rest.
      const iconColor = logoStatus ? (a.focused ? t.foreground : t.muted) : a.focused ? t.accent : t.muted;
      if (hops) this.hopping = true;
      const pic = classic() ? icon(a.program, 16, a.focused ? t.accent : t.muted)
        : agentPic(t, a.program, 16, iconColor, ring, false, hops ? this.hop : null, asks ? t.working : null, asks ? "ask" : finished ? "done" : null);
      // The name: white while it's working, finished, needs you or is in front, gray when idle; when the logo carries the
      // status, white only for the agent in front.
      const idle = logoStatus ? !a.focused : a.status === "idle" && !a.focused;
      const isPinned = this.pins.includes(a.address);
      const pin = div()
        .id(`pin-${a.address}`)
        // The status mark's 14 px slot, so nothing moves when it swaps in.
        .size(14)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.setPins(isPinned ? this.pins.filter((p) => p !== a.address) : [...this.pins, a.address]);
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/machine-sidebar/icons/${isPinned ? "pin-off" : "pin"}.svg`).size(12));
      const full = isPinned;
      const name = label(a) || a.space_name || "";
      // Line 2: where it works (folder · branch, and its space where the list doesn't group by it); context used as a small bar.
      const tab = tabs.find(x => x.id === a.tab);
      const folder = folderName(agentFolder(a, tab ? lead(tab) : null));
      const branch = paneBranch(a);
      // Line 2's pieces, each with its icon: the folder, the branch, and the space where the list doesn't group by it.
      const where = [[folder !== name ? folder : "", "folder"], [branch, "branch"], [full && a.space_name !== name ? a.space_name : "", "layers"]].filter(([text]) => text);
      const context = (shared("agents.context") ?? {})[a.address];
      const used = Number.isFinite(context?.percent) ? Math.max(0, Math.min(100, context.percent)) : null;
      const barWidth = pic ? 14 : 36;
      const bar = used == null ? null : contextBar(t, used, barWidth).tooltip(`Context: ${contextText(used)}`);
      // Dragging (by machine, not pinned): press, move over another agent of the same machine, release.
      const machineOf = x => x.includes("/") ? x.split("/")[0] : "";
      const draggable = !isPinned;
      const dragging = this.drag?.moved && this.drag.address === a.address;
      const dropHere = this.drag?.moved && this.drop?.target === a.address;
      // A card that moved gets a new id and starts where it was, then slides to its place (noticeMoves).
      const slide = this.slides?.[a.address];
      // One card, open or on the rail: its box (the focus stripe, its shade), hover with its details card beside the
      // sidebar, dragging, and a click to focus it. Only what's inside differs, below.
      const card = v_flex()
        .id(`ag-${a.address}-${this.moveGen?.[a.address] ?? 0}`)
        .relative()
        .top(slide ?? 0)
        .transition("top", { duration: 280, easing: "ease-out" })
        .py(6)
        .gap(2)
        .flex_none()
        .rounded(6)
        .border_l(2).border_color(a.focused ? t.accent : t.surface)
        .when(a.focused, (el) => el.bg(t.selected))
        .when(dragging, (el) => el.opacity(0.45))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) { this.hovered = a.address; this.detailsEnter(a.address, cx); }
          else { if (this.hovered === a.address) this.hovered = null; this.detailsLeave(a.address, cx); }
          cx.notify();
        })
        .child(this.hang(a.address, this.agentDetails(t, a, all, name)))
        .when(draggable, el => el
          .on_mouse_down("left", (e) => { this.drag = { address: a.address, machine: machineOf(a.address), y: e.position.y, moved: false }; this.drop = null; })
          .on_mouse_move((e, cx) => {
            const d = this.drag;
            if (!d) return;
            if (!d.moved && Math.abs(e.position.y - d.y) > 4) d.moved = true;
            if (!d.moved) return;
            const drop = d.address !== a.address && machineOf(a.address) === d.machine ? { target: a.address, after: e.local_position.y > 22 } : null;
            if (drop?.target !== this.drop?.target || drop?.after !== this.drop?.after) { this.drop = drop; cx.notify(); }
          })
          .on_mouse_up("left", (_e, cx) => {
            const d = this.drag;
            if (d?.moved) {
              if (this.drop) this.moveTo(d.address, this.drop.target, this.drop.after);
              this.dragged = true;
            }
            this.drag = null; this.drop = null;
            cx.notify();
          }))
        .on_click(() => {
          if (this.dragged) { this.dragged = false; return; }
          run("pane.focus", { pane: a.pane });
        })
        .when(dropHere, el => el.child(div().absolute().left(6).right(6).h(2).rounded_full().bg(t.accent).when(this.drop.after, d => d.bottom(-1)).when(!this.drop.after, d => d.top(-1))));
      if (collapsed) {
        // On the rail: the same two lines, each as tall as open (kept by invisible text), everything centred: the icon,
        // and its status under it. The focus stripe's 2 px is matched on the right, so the centre stays the rail's.
        return card.pr(2)
          .child(h_flex().items_center().justify_center()
            .child(h_flex().w(16).flex_none().justify_center().when(Boolean(pic), el => el.child(pic)))
            .child(div().w(0).overflow_hidden().child(" "))
            // As tall as the open first line when that has its fold or "Needs you" (18 px).
            .when(subs.length > 0 || (a.status === "blocked" && !asks), el => el.child(div().w(0).h(18).flex_none())))
          .child(div().relative().w_full().text_size(11.5).child(div().w(0).overflow_hidden().child(" "))
            .child(h_flex().absolute().top(0).bottom(0).left(0).right(0).items_center().justify_center()
              .child(this.status(t, logoStatus ? { ...a, status: "idle" } : a, true))));
      }
      return card.px(8)
        .child(h_flex().w_full().gap(8).items_center()
          .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
            .when(subs.length > 0, el => el.on_click((_e, cx) => {
              cx.stop_propagation();
              this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
              cx.notify();
            })).child(pic)))
          .child(div().flex_1().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(subs.length > 0, el => el.child(fold(a, subs)))
          // Resting on the card, the pin takes the status mark's place.
          .child(this.hovered === a.address ? pin : hops || finished || asks ? div().size(14).flex_none() : this.status(t, a)))
        // Always two lines (the rail's rows match their height).
        .child(h_flex().w_full().gap(8).items_center().text_size(11.5).text_color(t.dim)
          .when(Boolean(pic), el => el.child(h_flex().w(16).flex_none().justify_center().when(Boolean(bar), c => c.child(bar))))
          .child(h_flex().flex_1().min_w(0).gap(10).items_center().overflow_hidden()
            // The folder whole; the branch (and space) take what's left, cut short at their end.
            .children(where.map(([text, glyph]) => h_flex().gap(4).items_center()
              .when(glyph === "folder", el => el.flex_none()).when(glyph !== "folder", el => el.min_w(0))
              .child(svg(`mods/machine-sidebar/icons/${glyph}.svg`).size(11).flex_none().text_color(t.dim))
              .child(div().min_w(0).truncate().child(text)))))
          .when(!pic && Boolean(bar), el => el.child(bar)));
    };

    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const machine of this.sortMachines(machines())) {
      const machineKey = machine.name ?? "";
      groups.push({
        id: `machine-${machineKey || "local"}`,
        label: machine.name || localMachineLabel(),
        status: null,
        members: rest.filter(a => (a.address.includes("/") ? a.address.split("/")[0] : "") === machineKey),
        machine,
      });
    }
    // agent.next / agent.prev (Alt+Down / Alt+Up) walk the agents as the list shows them: Pinned, then each machine top to bottom.
    setAgentOrder(groups.flatMap(g => g.members).map(a => a.address));
    // Each machine with agents listed under it and its top one, in the list's order, for jumpMachine (Alt+Shift+Down / Up).
    this.machineTops = groups.filter(g => g.machine && g.members.length).map(g => ({ machine: g.machine.name ?? "", top: g.members[0].address }));

    const empty = (g) => {
      // A machine without agents: what it is, or on the rail, in the same 26 px, a mark for it with the words in its
      // tooltip: a dash for no agents, a spinner while connecting, a cross when offline or waiting for a login.
      const ready = g.machine?.layout === "ready", loading = !ready && g.machine?.layout === "loading";
      const text = ready ? "No agents" : this.hosts[g.machine?.name]?.state === "needs_login" ? "Needs login" : loading ? "Connecting…" : "Offline";
      const mark = ready ? svg("mods/machine-sidebar/icons/minus.svg").size(12) : loading ? svg("mods/machine-sidebar/icons/spinner.svg").size(13).spin(900) : svg("mods/machine-sidebar/icons/x.svg").size(11);
      return div().id(`empty-${g.id}`).h(26).flex_none().flex().items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.justify_center().tooltip(text).child(mark.flex_none().text_color(t.dim)))
        .when(!collapsed, el => el.pl(29).child(text));
    };
    const header = (g) => {
      // A group's header: a machine's (inside its band, which folds it) or Pinned's (which folds itself).
      const open = !this.folded.has(g.id);
      const isMachine = Boolean(g.machine);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      if (collapsed) {
        // The rail's header: the open one's box (30 px, the same top padding), its icon alone and centred: the machine's
        // logo as the open header shows it in this style, or Pinned's pin, which folds the group as open.
        return h_flex().id(g.id).h(30).pt(isMachine ? 6 : 8).flex_none().items_center().justify_center().cursor_pointer()
          .tooltip(g.label)
          .when(!isMachine, el => el.on_click((_e, cx) => { open ? this.folded.add(g.id) : this.folded.delete(g.id); cx.notify(); }))
          .child(svg(isMachine ? this.headerIcon(g.machine) : "mods/machine-sidebar/icons/pin.svg").size(isMachine ? 14 : 12).flex_none().text_color(isMachine ? t.muted : t.dim));
      }
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        // A machine's whole band folds it (below); other groups fold from their header.
        .when(!isMachine, el => el.on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        }))
        .when(isMachine, el => el.gap(8).text_size(13).font_semibold().pt(6).pl(9)
          .child(div().size(16).flex_none().flex().items_center().justify_center()
            .child(svg(this.headerIcon(g.machine)).size(14).flex_none().text_color(t.muted))))
        .child(div().truncate().text_color(isMachine ? t.muted : t[g.status] ?? t.dim).child(g.label))
        .when(isMachine && classic(), (el) => {
          const n = this.plainTerminals(g.machine).length, count = (id, glyph, value, tip) => h_flex().id(id).gap(3).items_center()
            .font_medium().text_size(11).text_color(t.dim).tooltip(tip)
            .child(svg(`mods/machine-sidebar/icons/${glyph}.svg`).size(12).flex_none()).child(String(value));
          return el.child(h_flex().gap(8).items_center()
            .child(count(`agents-${g.id}`, "bot", g.members.length, `${g.members.length} agent${g.members.length === 1 ? "" : "s"}`))
            .when(n > 0, (row) => row.child(count(`terms-${g.id}`, "terminal", n, `${n} terminal${n === 1 ? "" : "s"} besides the agents`))));
        })
        .when(!isMachine && !open, (el) => el.child(div().font_medium().text_size(11).text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(Boolean(top) && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .when(!isMachine, el => el.child(svg("mods/machine-sidebar/icons/chevron-right.svg").size(11).flex_none().text_color(t.dim))))
        // A machine always shows its fold arrow, left of the +: down while its agents show, right when folded.
        .when(isMachine, el => el.child(div().size(14).flex_none().flex().items_center().justify_center()
          .tooltip(open ? "Fold this machine's agents" : "Show this machine's agents")
          .child(svg(`mods/machine-sidebar/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim))))
        .when(isMachine && g.machine?.layout === "ready", el => el.child(div()
          .id(`add-${g.id}`)
          .size(14)
          .flex_none()
          .rounded(5)
          .flex()
          .items_center()
          .justify_center()
          .text_color(t.dim)
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip(`Add an agent on ${g.label}`)
          .on_click((_e, cx) => {
            cx.stop_propagation();
            // The menu opens where the machine's card hangs: close the card, and keep it closed until the pointer leaves the box.
            this.muted = `m:${g.machine.name ?? "@local"}`;
            this.detailsTimer?.cancel();
            if (this.detailsKey === this.muted) { this.detailsKey = null; this.detailsClosed = 0; }
            cx.notify();
            openOverlay({ mod: "machine-sidebar", kind: "popup", width: 280, height: 500, props: { newMenu: true, machine: g.machine.name } });
          })
          .child(svg("mods/machine-sidebar/icons/plus.svg").size(12))))
        .when(isMachine && Boolean(g.machine?.name) && g.machine?.layout !== "ready", el => {
          const name = g.machine.name;
          const busy = Boolean(this.retrying[name]?.busy);
          const state = (this.hosts[name]?.state ?? g.machine.layout).replace(/_/g, " ");
          return el.child(div()
            .id(`retry-${g.id}`)
            .size(14)
            .flex_none()
            .rounded(5)
            .flex()
            .items_center()
            .justify_center()
            .text_color(busy ? t.working ?? t.dim : t.dim)
            .hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip(busy ? `Reconnecting to ${name}…` : `${name}: ${state}. Click to reconnect.`)
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.retry(name, cx);
            })
            .child(svg(`mods/machine-sidebar/icons/${busy ? "spinner" : "rotate-cw"}.svg`).size(busy ? 15 : 12)));
        });
    };
    // Open or on the rail, the same rows: the rail draws each in its box, its icon alone, so every row stays level as the
    // sidebar folds.
    const rows = groups.flatMap((g, index) => this.boxed(t, g, index, [
        ...(index > 0 && !(classic() && g.machine) ? [div().h(20).flex_none()] : []),
        // A machine's band, dragged to reorder the machines: in Classic its header and rings raised, so each machine's agents
        // read as a group; in Tree its header alone, the agents hanging from its icon.
        ...(g.machine ? [this.machineCard(t, g.machine, v_flex().id(`band-${g.id}`).w_full().pb(3).rounded(8).border_1()
          .when(classic(), el => el.rounded(0).bg(t.raised).border_color(t.raised).hover(s => s.bg(t.hover)))
          .when(!classic(), el => el.mb(2).border_color(t.surface).hover(s => s.bg(t.hover)))
          .relative().cursor_pointer()
          .on_mouse_down("left", (e) => { this.mdrag = { key: g.machine.name ?? "", y: e.position.y, moved: false }; this.mdrop = null; })
          .on_mouse_move((e, cx) => {
            const d = this.mdrag;
            if (!d) return;
            if (!d.moved && Math.abs(e.position.y - d.y) > 4) d.moved = true;
            if (!d.moved) return;
            const key = g.machine.name ?? "";
            const drop = d.key !== key ? { target: key, after: e.local_position.y > 17 } : null;
            if (drop?.target !== this.mdrop?.target || drop?.after !== this.mdrop?.after) { this.mdrop = drop; cx.notify(); }
          })
          .on_mouse_up("left", (_e, cx) => {
            const d = this.mdrag;
            if (d?.moved) {
              if (this.mdrop) this.moveMachine(d.key, this.mdrop.target, this.mdrop.after);
              this.mdragged = true;
            }
            this.mdrag = null; this.mdrop = null;
            cx.notify();
          })
          .on_click((_e, cx) => {
            if (this.mdragged) { this.mdragged = false; return; }
            this.folded.has(g.id) ? this.folded.delete(g.id) : this.folded.add(g.id);
            cx.notify();
          })
          .when(Boolean(this.mdrag?.moved) && this.mdrop?.target === (g.machine.name ?? ""), el => el.child(div().absolute().left(6).right(6).h(2).rounded_full().bg(t.accent)
            .when(this.mdrop.after, d => d.bottom(-1)).when(!this.mdrop.after, d => d.top(-1))))
          .child(header(g)).when(classic(), el => el.child(collapsed ? this.railCpu(t, g.machine.name ?? null) : statsFor(g.machine.name ?? null, t))))] : [header(g)]),
        ...(this.folded.has(g.id) ? [] : !g.machine ? g.members.flatMap(withKids) : classic() ? [
          ...(g.members.length ? g.members.flatMap(withKids) : [empty(g)]),
          ...this.terminalRows(t, g.machine, collapsed),
        ] : [
          ...(g.members.length ? [] : [empty(g)]),
          ...((terms) => [...g.members.map((a, i) => [withKids(a, i), 17]), ...terms.map(r => [[r], 14])]
            .flatMap(([rows, at], n, all) => collapsed ? rows : underMachine(t, rows, n === all.length - 1, at)))(this.terminalRows(t, g.machine, collapsed)),
        ]),
      ]));

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.surface)
      .text_size(13)
      // No heading: the machines' bands start the list.
      .child(div().h(10).flex_none())
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(this.scrollArea(t, collapsed, rows));
  }

  scrollArea(t, collapsed, rows) {
    // The list scrolls without a bar, and fades at the top (under the logo) and the bottom (over settings)
    // wherever more is out of sight that way.
    const max = Math.max(0, this.rowsH - this.viewH);
    if (this.scrollY > max) this.scrollY = max;
    const above = this.scrollY > 1, below = this.scrollY < max - 1;
    // As the chat's: thin bands of the background, more opaque toward the edge (a painted gradient comes out flat).
    const STEPS = 12;
    const fade = top => v_flex().absolute().left(0).right(0).h(32).when(top, el => el.top(0)).when(!top, el => el.bottom(0))
      .children(Array.from({ length: STEPS }, (_, i) => div().w_full().flex_1().bg(t.surface).opacity(top ? (STEPS - i) / STEPS : (i + 1) / STEPS)));
    const edges = () => [above, below];
    return v_flex().flex_1().min_h(0).relative()
      .child(v_flex().id("ag-list").size_full().px(8).overflow_y_scroll().track_scroll(this.scrollHandle)
        .on_size_change((size, cx) => { const was = edges(); this.viewH = size.height; this.refade(was, cx); })
        .on_scroll_wheel((e, cx) => {
          const was = edges(), room = Math.max(0, this.rowsH - this.viewH);
          this.scrollY = Math.min(room, Math.max(0, this.scrollY - (e.delta?.y ?? 0)));
          this.refade(was, cx);
        })
        // A drag ends where the pointer leaves the list, or lets go outside an agent.
        .on_hover((on, cx) => { if (!on && (this.drag || this.mdrag)) { this.drag = null; this.drop = null; this.mdrag = null; this.mdrop = null; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { if (this.drag || this.mdrag) { this.drag = null; this.drop = null; this.mdrag = null; this.mdrop = null; cx.notify(); } })
        // The list's first child: the top, for scroll_to_item(0).
        .child(div().w_full().h(0).flex_none())
        .child(v_flex().w_full().flex_none()
          .on_size_change((size, cx) => { const was = edges(); this.rowsH = size.height; this.refade(was, cx); })
          .children(rows)))
      .when(above, el => el.child(fade(true)))
      .when(below, el => el.child(fade(false)));
  }

  refade(was, cx) {
    // Redraws only when a fade comes or goes.
    const max = Math.max(0, this.rowsH - this.viewH);
    const now = [this.scrollY > 1, this.scrollY < max - 1];
    if (now[0] !== was[0] || now[1] !== was[1]) cx.notify();
  }
}
