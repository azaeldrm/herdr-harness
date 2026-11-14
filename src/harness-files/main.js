// Harness's Files: herdr's lazy file browser for the focused pane's folder, with bounded
// read-only previews, where Markdown reads as a document (mermaid drawn by Pele) instead of
// source. Started from herdr's `files` mod; Preview/Source in the header switches views.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, appHome, props, openOverlay, closeOverlay } from "herdr";
import { MARKDOWN, MERMAID, parse, resolveLink } from "./parse.js";
import { document } from "./markdown.js";
import { hasQueuedDiagrams, renderQueuedDiagrams, hash } from "./diagrams.js";
import { forgetImages, takeChanged } from "./images.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000, LIMIT = 400000, PROBE = 100;
const extOf = path => { const name = path.split("/").pop(); return name.includes(".") ? name.split(".").pop().toLowerCase() : "txt"; };
const readable = path => MARKDOWN.has(extOf(path)) || MERMAID.has(extOf(path));

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

function openOutside(url) {
  // Web and mail links open in the system's handler, as TextView would have.
  if (!/^(https?|mailto):/i.test(url)) return;
  if (appHome().includes("\\")) exec("rundll32", ["url.dll,FileProtocolHandler", url]).catch(() => {});
  else exec("open", [url]).catch(() => exec("xdg-open", [url]).catch(() => {}));
}

export default class Files extends View {
  init(_props, cx) {
    // props { file, on? }: a viewer for that one file (pane.split / tab.new), not the focused folder.
    const p = props() ?? {}, file = typeof p.file === "string" ? p.file.replace(/[\\]/g, "/") : null;
    this.fixed = file && file.includes("/") ? { cwd: file.slice(0, file.lastIndexOf("/")), on: p.on ?? null, name: file.slice(file.lastIndexOf("/") + 1) } : null;
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.source = false; this.width = 600; this.zoom = 1; this.px = 0;
    // Opened as a floating window (openDoc): its header drags it, everything else in it keeps its presses.
    this.window = Boolean(p.overlay);
    this.refresh(cx);
    if (this.fixed) this.show(this.fixed.name, cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // Diagrams queue as the document draws (and again when the theme changes): draw them here.
    cx.timer.every(200, cx => {
      if (takeChanged()) cx.notify();
      if (!hasQueuedDiagrams() || this.drawing) return;
      this.drawing = true;
      cx.spawn(async cx => { try { if (await renderQueuedDiagrams()) cx.notify(); } finally { this.drawing = false; } });
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  where() { return this.fixed ? { cwd: this.fixed.cwd, on: this.fixed.on } : location(); }
  whereKey() { return this.fixed ? "fixed" : key(); }

  current(context) {
    return this.context === context && this.whereKey() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = this.where(), next = this.whereKey();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    } else if (this.file && cx) this.reload(cx);
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null; this.text = null; this.doc = null;
    if (!path || !cx) return;
    forgetImages();
    this.read(path, cx);
  }

  reload(cx) {
    // The open file again (a save, a checkout): redrawn only when its text changed.
    if (this.file && !this.reading) this.read(this.file, cx, true);
  }

  read(path, cx, quiet = false) {
    const context = this.context, root = this.root, on = this.on;
    this.reading = true;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { if (!quiet) this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const shown = text.length > LIMIT ? text.slice(0, LIMIT) + "\n… (file truncated)" : text;
        if (shown === this.text) return;
        this.text = shown; this.version = hash(shown);
        const ext = extOf(path);
        this.doc = MARKDOWN.has(ext) ? parse(shown) : MERMAID.has(ext) ? [{ kind: "diagram", text: shown.trim() }] : null;
        this.code?.release(); this.code = null;
        if (!this.doc || this.source) this.code = this.editor(shown, ext);
        this.fileError = null;
      } catch { if (this.file === path && this.current(context) && !quiet) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { this.reading = false; cx.notify(); }
    });
  }

  editor(text, ext) {
    const t = theme();
    return EditorState.new({ language: LANG[ext] ?? ext, readonly: true, value: text,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  setSource(source, cx) {
    this.source = source;
    if (source && !this.code && this.text !== null && this.file) this.code = this.editor(this.text, extOf(this.file));
    cx.notify();
  }

  openDoc(path) {
    // A readable file (Markdown, mermaid) opens in a floating window over the work, with this panel's reading view;
    // the panel stays on its folder. One window: another file replaces it, where it was left.
    openOverlay({ mod: "harness-files", kind: "window", key: "harness-files-doc", width: 0.6, height: 0.82,
      props: { file: `${String(this.root).replace(/\\/g, "/")}/${path}`, on: this.on ?? null } });
  }

  link(url, cx) {
    // A link in a document: a file beside it opens here, a web address in the browser.
    const target = this.file ? resolveLink(this.file, url) : null;
    if (target) { this.show(target, cx); cx.notify(); }
    else openOutside(url);
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : readable(path) ? this.openDoc(path) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/harness-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/harness-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  viewToggle(t) {
    // Preview | Source, for files that have a readable view.
    const option = (label, source) => div().id(`files-view-${label}`).px(8).h(22).flex().items_center().rounded(5).cursor_pointer().text_size(11.5)
      .when(this.source === source, el => el.bg(t.selected).text_color(t.foreground))
      .when(this.source !== source, el => el.text_color(t.muted).hover(s => s.bg(t.hover)))
      .on_click((_e, cx) => this.setSource(source, cx)).child(label);
    return h_flex().flex_none().p(2).gap(2).rounded(7).border_1().border_color(t.border).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(option("Preview", false)).child(option("Source", true));
  }

  body(t) {
    if (this.doc && !this.source) return v_flex().id(`files-doc-${this.file}`).flex_1().min_h(0).overflow_y_scrollbar()
      .on_size_change((size, cx) => { this.px = size.width; const w = size.width / (this.zoom || 1); if (w > 0 && Math.abs(w - this.width) > 8) { this.width = w; cx.notify(); } })
      .child(document(this.doc, { t, width: this.width, key: this.version, file: this.file, root: this.root, on: this.on, onLink: (url, cx) => this.link(url, cx) }));
    if (this.code) return Editor.new(this.code).flex_1().min_h(0);
    return div().p(12).text_color(t.dim).child(this.fileError || "Loading file…");
  }

  render(cx) {
    if (this.whereKey() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").relative().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // An off-screen box of known size: the app's zoom, so diagrams fit the column.
      .child(div().id("files-zoom-probe").absolute().top(0).left(-30000).w(PROBE).h(PROBE).flex_none()
        .on_size_change((size, cx) => { const z = size.width > 0 ? size.width / PROBE : 1; if (Math.abs(z - this.zoom) > 0.001) { this.zoom = z; if (this.px) this.width = this.px / z; cx.notify(); } }))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file) && !this.fixed, el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        // In a floating window (openDoc), the file's name heads it and its header is where it's dragged; × closes it.
        .child(div().font_semibold().child(this.window ? (this.file ?? "") : this.fixed ? "Preview" : "Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.window ? (this.root?.split(/[\\/]/).pop() ?? "") : this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(this.file) && readable(this.file ?? ""), el => el.child(this.viewToggle(t)))
        .when(this.window, el => el.child(div().id("files-close").size(22).flex_none().flex().items_center().justify_center().rounded(5)
          .cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => closeOverlay(props().overlay)).child(svg("mods/harness-chrome/x.svg").size(12)))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.window ? div().flex_1().min_h(0).flex().flex_col().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(this.body(t)) : this.body(t)));
  }
}
