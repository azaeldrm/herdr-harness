// A Markdown file as a readable document: prose through TextView, code in titled boxes,
// ```mermaid blocks as Pele diagrams, images from the cache images.js fills, front matter as a box.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { settings } from "herdr";
import { diagramFor } from "./diagrams.js";
import { imageFor } from "./images.js";
import { imageTarget } from "./parse.js";

export const COLUMN = 820;

let copiedId = null;

function codeBox(id, label, source, t) {
  // A code block in a box titled with its language, in the terminal font, lines kept as written, with a copy button at the top right.
  const lines = source.replace(/\n$/, "").split("\n");
  const shown = l => l.replace(/\t/g, "    ").replace(/^ +/, s => " ".repeat(s.length)) || " ";
  const copied = copiedId === id;
  const copy = (_e, cx) => {
    cx.stop_propagation();
    cx.write_to_clipboard(source.replace(/\n$/, ""));
    copiedId = id; cx.notify();
    cx.timer.after(1500, cx => { if (copiedId === id) { copiedId = null; cx.notify(); } });
  };
  return v_flex().id(id).w_full().rounded(8).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
    .child(h_flex().h(28).px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(label))
      .when(copied, el => el.child(div().text_size(11.5).text_color(t.muted).child("Copied")))
      .child(div().id(`${id}-copy`).flex_none().cursor_pointer().on_click(copy)
        .child(svg(`mods/harness-files/${copied ? "check" : "copy"}.svg`).size(14).flex_none().text_color(t.muted))))
    .child(v_flex().px(12).py(8).font_family(settings().font_family).text_size(12.5).text_color(t.foreground)
      .children(lines.map((l, k) => div().id(`${id}-l${k}`).w_full().min_h(18).child(shown(l)))));
}

function table(id, b, t, onLink) {
  // A GFM table: equal columns, a header row on the surface color, cells as inline markdown.
  const cell = (text, k, r, head) => div().id(`${id}-${r}-${k}`).flex_1().min_w(0).px(10).py(6)
    .when(k > 0, el => el.border_l(1).border_color(t.border))
    .child(h_flex().w_full().when(b.align[k] === "center", el => el.justify_center()).when(b.align[k] === "right", el => el.justify_end())
      .child(text ? TextView.markdown(`${id}-${r}-${k}-t`, head ? `**${text}**` : text).selectable(true).on_link_click((url, cx) => onLink(url, cx)) : div()));
  const row = (cells, r, head) => h_flex().id(`${id}-r${r}`).w_full().items_start()
    .when(r > 0, el => el.border_t(1).border_color(t.border)).when(head, el => el.bg(t.surface))
    .children(cells.map((c, k) => cell(c, k, r, head)));
  return v_flex().id(id).w_full().rounded(8).border_1().border_color(t.border).overflow_hidden()
    .child(row(b.head, 0, true)).children(b.rows.map((r, i) => row(r, i + 1, false)));
}

function diagram(id, source, t, room) {
  // A mermaid block: the picture once Pele has drawn it, else a note (and the source if it failed).
  const d = diagramFor(source, t);
  if (d.state === "queued") return div().id(id).w_full().h(28).flex().items_center().text_size(12.5).text_color(t.dim).child("Drawing diagram…");
  if (d.state === "failed") return v_flex().id(id).w_full().gap(6)
    .child(codeBox(`${id}-failed`, "mermaid", source, t))
    .child(div().text_size(12).text_color(t.dim).child(`Couldn't draw this diagram: ${d.error}`));
  const w = Math.max(1, Math.min(d.width, room)), h = Math.round(d.height * w / d.width);
  return h_flex().id(id).w_full().justify_center().py(4).child(image(d.rel).w(w).h(h));
}

const hostOf = url => /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1]?.replace(/^www\./, "") ?? "";

function pictures(id, items, t, room, { onLink, file, root, on }) {
  // A row of images (a lone figure, or badges side by side), each sized to fit the column.
  const one = (item, k) => {
    const target = imageTarget(item.src, file ?? "");
    const label = item.alt || item.src.split(/[?#]/)[0].split(/[\\/]/).pop() || "image";
    // A web image isn't downloaded (opening a file contacts nothing): it's a link to open it in the browser.
    if (target?.web) return h_flex().id(`${id}-${k}`).max_w(room).min_w(0).px(10).py(5).gap(6).items_center().rounded(6)
      .border_1().border_color(t.border).bg(t.surface).text_size(12).cursor_pointer().hover(s => s.bg(t.hover))
      .tooltip(item.src).on_click((_e, cx) => onLink(item.src, cx))
      .child(div().text_color(t.dim).child("Web image"))
      .child(div().min_w(0).truncate().text_color(t.accent).child(label))
      .child(div().text_color(t.dim).child(hostOf(item.src)));
    const e = imageFor(target, { root, on });
    if (e.state !== "ready") return div().id(`${id}-${k}`).max_w(room).min_w(0).px(10).py(5).rounded(6)
      .border_1().border_color(t.border).bg(t.surface).text_size(12).text_color(t.dim)
      .child(e.state === "loading" ? `Loading image · ${label}` : `Image · ${label} · ${e.error}`);
    let w = item.width ?? (item.height ? e.width * item.height / e.height : e.width);
    w = Math.max(1, Math.min(w, room));
    const h = Math.max(1, Math.round(e.height * w / e.width));
    return div().id(`${id}-${k}`).flex_none().when(Boolean(item.alt), el => el.tooltip(item.alt))
      .when(Boolean(item.href), el => el.cursor_pointer().on_click((_e, cx) => onLink(item.href, cx)))
      .child(image(e.rel).w(Math.round(w)).h(h));
  };
  return h_flex().id(id).w_full().flex_wrap().gap(6).items_center()
    .when(items.length === 1, el => el.justify_center().py(4))
    .children(items.map(one));
}

export function document(blocks, { t, width, onLink, key, file, root, on }) {
  // The whole document, centred in a readable column.
  const room = Math.max(160, Math.min(COLUMN, width) - 48);
  const children = blocks.map((b, i) => {
    const id = `md-${key}-${i}`;
    if (b.kind === "diagram") return diagram(id, b.text, t, room);
    if (b.kind === "images") return pictures(id, b.items, t, room, { onLink, file, root, on });
    if (b.kind === "table") return table(id, b, t, onLink);
    if (b.kind === "code") return codeBox(id, b.lang || "text", b.text, t);
    if (b.kind === "front") return codeBox(id, "front matter", b.text, t);
    return div().w_full().child(TextView.markdown(id, b.text).selectable(true).on_link_click((url, cx) => onLink(url, cx)));
  });
  return h_flex().w_full().justify_center()
    .child(v_flex().w_full().max_w(COLUMN).px(24).pt(18).pb(48).gap(14).text_size(14).text_color(t.foreground)
      .children(children.length ? children : [div().text_color(t.dim).child("This file is empty")]));
}
