// Pure Markdown helpers (no herdr imports), so tests/markdown.mjs can load them in node.

export const MARKDOWN = new Set(["md", "markdown", "mdown", "mkd", "mkdn"]);
export const MERMAID = new Set(["mmd", "mermaid"]);
export function parse(text) {
  // The document as blocks: { kind: "text" | "code" | "diagram" | "front", text, lang? }, or a table.
  // Fences follow CommonMark: ``` or ~~~, up to 3 spaces of indent, closed by the same
  // character at least as long; an unclosed fence runs to the end.
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), out = [];
  let i = 0, prose = [];
  const flush = () => { for (const b of tables(prose)) out.push(b); prose = []; };
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1), alt = lines.indexOf("...", 1);
    const close = end < 0 ? alt : alt < 0 ? end : Math.min(end, alt);
    if (close > 0) { out.push({ kind: "front", text: lines.slice(1, close).join("\n") }); i = close + 1; }
  }
  for (; i < lines.length; i++) {
    const open = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/.exec(lines[i]);
    if (!open) { prose.push(lines[i]); continue; }
    flush();
    const [, indent, fence, lang] = open, body = [];
    const closes = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    for (i++; i < lines.length && !closes.test(lines[i]); i++)
      body.push(indent ? lines[i].replace(new RegExp(`^ {0,${indent.length}}`), "") : lines[i]);
    const code = body.join("\n");
    out.push(lang.toLowerCase() === "mermaid" ? { kind: "diagram", text: code.trim() } : { kind: "code", lang, text: code });
  }
  flush();
  return out;
}

const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function cells(line) {
  // A table row's cells: pipes split them, except escaped ones and those inside `code`.
  const out = [], body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  let cell = "", code = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "|") { cell += "|"; i++; continue; }
    if (c === "`") code = !code;
    if (c === "|" && !code) { out.push(cell.trim()); cell = ""; } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function tables(lines) {
  // Prose lines as text blocks, with GFM tables taken out as { kind: "table", head, align, rows }.
  const out = []; let text = [];
  const flush = () => { for (const b of pictures(text)) out.push(b); text = []; };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("|") && i + 1 < lines.length && SEP.test(lines[i + 1])) {
      flush();
      const head = cells(lines[i]);
      const align = cells(lines[i + 1]).map(a => a.startsWith(":") && a.endsWith(":") ? "center" : a.endsWith(":") ? "right" : "left");
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(cells(lines[i]));
      i--;
      out.push({ kind: "table", head, align, rows: rows.map(r => head.map((_h, k) => r[k] ?? "")) });
      continue;
    }
    text.push(lines[i]);
  }
  flush();
  return out;
}

// ![alt](src "title"), the same wrapped in a link ([![alt](src)](href)), or an HTML <img>.
// A data: URI may hold raw spaces (an inline SVG): not CommonMark, but written often enough.
const SRC = String.raw`\(\s*(?:<([^>]*)>|(data:[^)]+?|[^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`;
const PICTURE = new RegExp(String.raw`\[!\[([^\]]*)\]${SRC}\]\(\s*<?([^\s)>]+)>?[^)]*\)|!\[([^\]]*)\]${SRC}|<img\b[^>]*>`, "gi");

function attr(tag, name) {
  const m = new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, "i").exec(tag);
  return m ? m[1] ?? m[2] ?? m[3] : null;
}

function picture(m) {
  // One match of PICTURE as { src, alt, href?, width?, height? }, or null for an <img> without a src.
  if (m[0][0] === "<") {
    const src = attr(m[0], "src");
    if (!src) return null;
    const px = n => { const v = parseFloat(attr(m[0], n) ?? ""); return v > 0 && !/%/.test(attr(m[0], n)) ? v : undefined; };
    return { src, alt: attr(m[0], "alt") ?? "", width: px("width"), height: px("height") };
  }
  if (m[1] !== undefined) return { alt: m[1], src: m[2] ?? m[3], href: m[4] };
  return { alt: m[5], src: m[6] ?? m[7] };
}

function pictures(lines) {
  // Prose lines as text blocks, with images taken out as rows of their own:
  // { kind: "images", items }. Images on one line (a row of badges) share a row.
  // Lines inside an indented code block or an inline `code` span are left alone.
  const out = []; let text = [];
  const flush = () => { const t = text.join("\n"); if (t.trim()) out.push({ kind: "text", text: t }); text = []; };
  for (const line of lines) {
    if (/^( {4}|\t)/.test(line) || !/!\[|<img\b/i.test(line)) { text.push(line); continue; }
    const masked = line.replace(/`[^`]*`/g, s => " ".repeat(s.length));
    // Masking only blanks code spans, so a match's groups are the line's own text.
    const items = [...masked.matchAll(PICTURE)].map(m => ({ at: m.index, end: m.index + m[0].length, item: picture(m) })).filter(f => f.item);
    if (!items.length) { text.push(line); continue; }
    let last = 0, row = [];
    const rest = s => s.replace(/<\/?(p|a|div|center|picture|source)\b[^>]*>/gi, "").trim();
    for (const f of items) {
      const between = line.slice(last, f.at);
      if (rest(between)) {
        if (row.length) { flush(); out.push({ kind: "images", items: row }); row = []; }
        text.push(between);
      }
      if (!row.length) flush();
      row.push(f.item); last = f.end;
    }
    if (row.length) { flush(); out.push({ kind: "images", items: row }); }
    if (rest(line.slice(last))) text.push(line.slice(last));
  }
  flush();
  return out;
}

export function imageTarget(src, file) {
  // Where an image's bytes come from: { web: url }, { data: uri }, { abs: path } (on the
  // file's machine), or { rel: path } relative to the root; null when there's nothing to load.
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return { web: src };
  if (/^data:image\//i.test(src)) return { data: src };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return null;
  let path;
  try { path = decodeURIComponent(src.split(/[?#]/)[0]); } catch { path = src.split(/[?#]/)[0]; }
  if (!path) return null;
  if (path.startsWith("/") || /^[a-z]:[\\/]/i.test(path)) return { abs: path.replace(/\\/g, "/") };
  return { rel: resolveLink(file, path) };
}

export function resolveLink(from, url) {
  // A link in the file at `from` (relative to the root) as a root-relative path, or null for
  // anything that isn't a file next to it (a web address, an anchor, an absolute path).
  if (!url || url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/") || url.startsWith("\\")) return null;
  let path;
  try { path = decodeURIComponent(url.split(/[?#]/)[0]); } catch { path = url.split(/[?#]/)[0]; }
  if (!path) return null;
  const parts = from.split("/").slice(0, -1);
  for (const p of path.replace(/\\/g, "/").split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (!parts.length || parts[parts.length - 1] === "..") parts.push(".."); else parts.pop(); }
    else parts.push(p);
  }
  return parts.join("/");
}
