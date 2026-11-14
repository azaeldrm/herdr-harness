// markdown-files: Markdown split into prose, code, mermaid and front matter; links resolved.
import assert from "node:assert/strict";
import { parse, resolveLink, imageTarget } from "../layouts/harns/mods/markdown-files/parse.js";
import { sniff, hashBytes, toBase64 } from "../layouts/harns/mods/markdown-files/bytes.js";

const doc = parse([
  "---", "title: Notes", "---",
  "# Heading", "", "Some *prose*.",
  "```mermaid", "graph TD", "  A --> B", "```",
  "Between.",
  "~~~~js", "const x = 1;", "```", "still code", "~~~~",
  "  ```", "  indented", "  ```",
  "Tail.",
].join("\r\n"));
assert.deepEqual(doc.map(b => b.kind), ["front", "text", "diagram", "text", "code", "code", "text"]);
assert.equal(doc[0].text, "title: Notes");
assert.equal(doc[2].text, "graph TD\n  A --> B");
assert.equal(doc[4].lang, "js");
assert.equal(doc[4].text, "const x = 1;\n```\nstill code");
assert.equal(doc[5].text, "indented");
assert.deepEqual(parse("```Mermaid\npie\n").map(b => [b.kind, b.text]), [["diagram", "pie"]]);
assert.deepEqual(parse("---\nnot front matter"), [{ kind: "text", text: "---\nnot front matter" }]);
assert.deepEqual(parse("inline ```code``` stays prose").map(b => b.kind), ["text"]);
assert.deepEqual(parse(""), []);

assert.equal(resolveLink("docs/a.md", "b.md"), "docs/b.md");
assert.equal(resolveLink("docs/a.md", "./b.md#part"), "docs/b.md");
assert.equal(resolveLink("docs/a.md", "../README.md"), "README.md");
assert.equal(resolveLink("a.md", "../up.md"), "../up.md");
assert.equal(resolveLink("a.md", "my%20notes.md"), "my notes.md");
for (const url of ["https://x.dev", "mailto:a@b.c", "#anchor", "/abs.md", "C:/x.md", ""]) assert.equal(resolveLink("a.md", url), null, url);
console.log("markdown: ok");

const tbl = parse("Intro\n\n| A | `x|y` | C |\n|:--|:-:|--:|\n| 1 | 2 \\| 3 |\n\nAfter");
assert.deepEqual(tbl.map(b => b.kind), ["text", "table", "text"]);
assert.deepEqual(tbl[1].head, ["A", "`x|y`", "C"]);
assert.deepEqual(tbl[1].align, ["left", "center", "right"]);
assert.deepEqual(tbl[1].rows, [["1", "2 | 3", ""]]);
assert.deepEqual(parse("a | b\n---|---\nc | d")[0].rows, [["c", "d"]]);
assert.deepEqual(parse("Title\n---").map(b => b.kind), ["text"]);
console.log("tables: ok");

// Images: their own rows, badges sharing one, links kept, code left alone.
const pics = parse([
  "Before.",
  "![Diagram](img/arch.png \"Architecture\")",
  "After.",
  "[![CI](https://x.dev/ci.svg)](https://x.dev/ci) [![npm](https://x.dev/npm.svg)](https://x.dev/npm)",
  "Text with ![inline](a.gif) in the middle.",
  "`![not an image](x.png)` and <img src=\"logo.svg\" width=\"120\" alt='Logo'>",
  "    ![indented code](x.png)",
  "![spaced](<my pic.png>)",
].join("\n"));
assert.deepEqual(pics.map(b => b.kind), ["text", "images", "text", "images", "text", "images", "text", "images", "text", "images"]);
assert.deepEqual(pics[1].items, [{ alt: "Diagram", src: "img/arch.png" }]);
assert.deepEqual(pics[3].items, [
  { alt: "CI", src: "https://x.dev/ci.svg", href: "https://x.dev/ci" },
  { alt: "npm", src: "https://x.dev/npm.svg", href: "https://x.dev/npm" }]);
assert.equal(pics[4].text, "Text with ");
assert.deepEqual(pics[5].items, [{ alt: "inline", src: "a.gif" }]);
assert.equal(pics[6].text, " in the middle.\n`![not an image](x.png)` and ");
assert.deepEqual(pics[7].items, [{ src: "logo.svg", alt: "Logo", width: 120, height: undefined }]);
assert.equal(pics[8].text, "    ![indented code](x.png)");
assert.deepEqual(pics[9].items, [{ alt: "spaced", src: "my pic.png" }]);
assert.deepEqual(parse("```\n![in a fence](x.png)\n```").map(b => b.kind), ["code"]);
assert.deepEqual(parse("Dot: ![d](data:image/svg+xml;utf8,<svg width='4' height='4'></svg>) done")[1].items,
  [{ alt: "d", src: "data:image/svg+xml;utf8,<svg width='4' height='4'></svg>" }]);
assert.deepEqual(parse("<p align=\"center\"><img src=\"a.png\"></p>").map(b => b.kind), ["images"]);

assert.deepEqual(imageTarget("img/a.png", "docs/guide.md"), { rel: "docs/img/a.png" });
assert.deepEqual(imageTarget("../a%20b.png", "docs/guide.md"), { rel: "a b.png" });
assert.deepEqual(imageTarget("https://x.dev/a.png", "a.md"), { web: "https://x.dev/a.png" });
assert.deepEqual(imageTarget("data:image/png;base64,AAAA", "a.md"), { data: "data:image/png;base64,AAAA" });
assert.deepEqual(imageTarget("/srv/a.png", "a.md"), { abs: "/srv/a.png" });
assert.deepEqual(imageTarget("D:/pics/a.png", "a.md"), { abs: "D:/pics/a.png" });
assert.equal(imageTarget("ftp://x/a.png", "a.md"), null);
console.log("images: ok");

// Sizes from the bytes themselves.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEklEQVR4nGP4z8DwnwEKGBgBADnzBP0Nr8RJAAAAAElFTkSuQmCC", "base64");
assert.deepEqual(sniff(png), { type: "png", width: 3, height: 2 });
assert.deepEqual(sniff(Buffer.from("R0lGODlhBQAEAIAAAAAAAP///yH5BAEAAAAALAAAAAAFAAQAAAIEhI+pWAA7", "base64")), { type: "gif", width: 5, height: 4 });
const jpg = Buffer.alloc(40); jpg.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 7, 0, 9]);
assert.deepEqual(sniff(jpg), { type: "jpg", width: 9, height: 7 });
// The base64 an image is saved through (herdr's own writes binary data as an empty file): Node's, at every padding.
for (const len of [0, 1, 2, 3, 4, 5, 64, 65537]) {
  const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 255);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"), `toBase64 of ${len} bytes`);
}
assert.deepEqual(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"></svg>')), { type: "svg", width: 40, height: 20 });
assert.deepEqual(sniff(Buffer.from('<?xml version="1.0"?><svg width="100px" viewBox="0 0 40 20">')), { type: "svg", width: 100, height: 50 });
assert.equal(sniff(Buffer.from("just text, not an image")), null);
assert.notEqual(hashBytes(png), hashBytes(jpg));
console.log("image sizes: ok");
