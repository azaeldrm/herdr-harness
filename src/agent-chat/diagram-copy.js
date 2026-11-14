// The chat's own use of diagrams (the engine is diagrams.js, shared with the Files panel): an assistant message split
// around its mermaid blocks, and a drawn diagram copied to the clipboard as a picture.
import { appHome, exec } from "herdr";
import * as fs from "fs/promises";
import { diagramDir } from "./diagrams.js";
import { onWindows, modFile } from "./platform.js";

export function splitDiagrams(text) {
  // An assistant message split around its ```mermaid blocks: text, a diagram row, text, …
  const parts = text.split(/```mermaid[^\n]*\n([\s\S]*?)```/g);
  if (parts.length === 1) return null;
  const out = [];
  parts.forEach((p, i) => {
    if (i % 2) out.push({ kind: "diagram", text: p.trim() });
    else if (p.trim()) out.push({ kind: "text", text: p.trim() });
  });
  return out;
}

export const COPY_PAD = 24;

export function framedSvg(svg, width, height, background, pad = COPY_PAD) {
  // A drawn diagram's SVG on its own background with `pad` px around it, at its own size: what's copied as a picture, so its
  // light text stays readable wherever it's pasted.
  const w = width + 2 * pad, h = height + 2 * pad;
  return svg.replace(/<svg\s[^>]*>/, tag => tag
    .replace(/viewBox="[^"]*"/, `viewBox="${-pad} ${-pad} ${w} ${h}"`)
    .replace(/\swidth="[^"]*"/, ` width="${w}"`)
    .replace(/\sheight="[^"]*"/, ` height="${h}"`)
    .replace(/max-width:100%;height:auto;/, "")
    + `<rect x="${-pad}" y="${-pad}" width="${w}" height="${h}" fill="${background}"/>`);
}

const COPY_ERRORS = {
  3: onWindows() ? "Copying a picture needs Microsoft Edge or Google Chrome." : "Copying a picture needs rsvg-convert (librsvg), ImageMagick or Inkscape.",
  4: "The diagram couldn't be drawn as a picture.",
  5: "Copying a picture needs wl-copy or xclip.",
};

export async function copyDiagramImage(d, background) {
  // Puts a drawn diagram (diagramFor, ready) on the clipboard as a PNG; null when done, else why not.
  const dir = diagramDir();
  const at = name => onWindows() ? `${dir}\\${name}` : `${dir}/${name}`;
  const svg = at(`${d.key}.copy.svg`), png = at(`${d.key}.copy.png`);
  const w = Math.ceil(d.width) + 2 * COPY_PAD, h = Math.ceil(d.height) + 2 * COPY_PAD;
  try { await fs.writeFile(svg, framedSvg(await fs.readFile(at(`${d.key}.svg`), "utf8"), Math.ceil(d.width), Math.ceil(d.height), background)); }
  catch (e) { return String(e?.message ?? e); }
  const r = await (onWindows()
    ? exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", modFile("copy-image.ps1"), "-Svg", svg, "-Png", png, "-Width", String(w), "-Height", String(h)])
    : exec("sh", [modFile("copy-image.sh"), svg, png, String(w), String(h)])).catch(e => ({ code: -1, stderr: String(e) }));
  return r.code === 0 ? null : COPY_ERRORS[r.code] ?? ((r.stderr || "").trim().split("\n").pop() || "The picture couldn't be copied.");
}
