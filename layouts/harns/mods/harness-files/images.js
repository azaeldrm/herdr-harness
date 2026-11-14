// Images in a Markdown file, copied into ~/.config/herdr-app/cache/harness-files/images so that
// herdr's image() can show them (it only reads paths under the app's own folder), the way
// diagrams.js caches Pele's drawings. Sources: a file beside the document (on its machine),
// an absolute path, or a data: URI. Web addresses are never fetched: markdown.js shows them as links.
import { appHome, exec, window } from "herdr";
import * as fs from "fs/promises";
import { Buffer } from "buffer";
import { hashBytes, sniff, toBase64 } from "./bytes.js";

const DIR = "cache/harness-files/images";
const MAX_BYTES = 20 * 1024 * 1024, KEPT = 300, PARALLEL = 4;
const entries = new Map();
const queue = [];
let running = 0, changed = false;

const onWindows = () => appHome().includes("\\");
const cacheDir = () => onWindows() ? `${appHome()}\\cache\\harness-files\\images` : `${appHome()}/${DIR}`;
const reason = err => String(err?.message ?? err).split("\n")[0].slice(0, 160);

export function imageFor(target, where) {
  // The cached copy of an image ({ state: "loading" | "ready" | "failed", rel, width, height, error }),
  // started the first time it's asked for. `target` comes from parse.js's imageTarget;
  // `where` is { root, on }: the document's folder root and machine.
  if (!target || target.web) return { state: "failed", error: "Unsupported image address" };
  const key = JSON.stringify([target, target.data ? null : where.on ?? null, target.rel ? where.root : null]);
  let e = entries.get(key);
  if (!e) {
    e = { state: "loading" };
    entries.set(key, e);
    queue.push([e, target, where]);
    while (entries.size > KEPT) entries.delete(entries.keys().next().value);
    pump();
  }
  return e;
}

export function forgetImages() {
  // Drops what's known, so opening a document reads its images again (they may have changed).
  for (const [k, e] of entries) if (e.state !== "loading") entries.delete(k);
}

export function takeChanged() {
  // Whether an image finished (or failed) since the last call: the view redraws then.
  const was = changed; changed = false; return was;
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const [e, target, where] = queue.shift();
    running++;
    load(target, where)
      .then(r => Object.assign(e, { state: "ready" }, r), err => Object.assign(e, { state: "failed", error: reason(err) }))
      .finally(() => { running--; changed = true; pump(); });
  }
}

async function load(target, where) {
  const bytes = await bytesOf(target, where);
  if (!bytes?.length) throw new Error("Empty file");
  if (bytes.length > MAX_BYTES) throw new Error("Image larger than 20 MB");
  const info = sniff(bytes);
  if (!info) throw new Error("Not a PNG, JPEG, GIF, WebP or SVG image");
  const name = `${hashBytes(bytes)}.${info.type}`, dir = cacheDir();
  const dest = onWindows() ? `${dir}\\${name}` : `${dir}/${name}`;
  const have = (await readBytes(dest))?.length ?? -1;
  if (have !== bytes.length) {
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    if (!await save(dest, bytes)) { await fs.unlink(dest).catch(() => {}); throw new Error("Couldn't save a copy to show"); }
  }
  return { rel: `${DIR}/${name}`, width: info.width || 400, height: info.height || 300 };
}

async function save(dest, bytes) {
  // herdr's writeFile writes binary data as an empty file while reporting success (text comes out whole), so a copy
  // only counts once it reads back whole. Otherwise it goes down as base64 text, decoded beside it by the system's
  // own tools: PowerShell on Windows, Python 3 (else base64) elsewhere.
  await fs.writeFile(dest, bytes).catch(() => {});
  if (((await readBytes(dest))?.length ?? -1) === bytes.length) return true;
  const text = `${dest}.b64`;
  await fs.writeFile(text, toBase64(bytes));
  const quoted = p => `'${p.replace(/['‘’‚‛]/g, "$&$&")}'`;
  if (onWindows()) {
    await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `& { param($s, $d) [IO.File]::WriteAllBytes($d, [Convert]::FromBase64String([IO.File]::ReadAllText($s))) } ${quoted(text)} ${quoted(dest)}`]).catch(() => null);
  } else {
    const py = await exec("python3", ["-c", "import base64,sys;open(sys.argv[2],'wb').write(base64.b64decode(open(sys.argv[1]).read()))", text, dest]).catch(() => null);
    if (py?.code !== 0) await exec("sh", ["-c", 'base64 -d < "$1" > "$2"', "sh", text, dest]).catch(() => null);
  }
  await fs.unlink(text).catch(() => {});
  return ((await readBytes(dest))?.length ?? -1) === bytes.length;
}

async function bytesOf(target, { root, on }) {
  if (target.data) {
    const comma = target.data.indexOf(",");
    if (comma < 0) throw new Error("Malformed data: URI");
    const head = target.data.slice(0, comma), body = target.data.slice(comma + 1);
    return /;base64$/i.test(head) ? fromBase64(body) : fromText(decodeURIComponent(body));
  }
  const path = target.abs ?? `${root}/${target.rel}`;
  if (!on) {
    // fs reads only under the home folder (and refuses others by throwing, not rejecting);
    // elsewhere (another drive) the shell reads it.
    // A missing file reads as empty, not as an error: the shell then says which it is.
    const local = await readBytes(path);
    if (local?.length) return local;
  }
  return shellBytes(path, on);
}

async function readBytes(path) {
  try { return await fs.readFile(path); } catch { return null; }
}

async function shellBytes(path, on) {
  // The file's bytes as base64 through a shell on its machine (exec's output is text).
  const powershell = async () => {
    // A .NET exception doesn't end the script with an error code: check first, exit with ours.
    const script = "& { param($p) if (-not [IO.File]::Exists($p)) { exit 2 }; if ((Get-Item -LiteralPath $p).Length -gt " + MAX_BYTES + ") { exit 3 }; [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'";
    return exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { on });
  };
  let r;
  if (!on && window()?.platform === "windows") r = await powershell();
  else {
    try { r = await exec("sh", ["-c", '[ -f "$1" ] || exit 2; [ "$(wc -c < "$1")" -le ' + MAX_BYTES + ' ] || exit 3; base64 < "$1"', "img", path], { on }); }
    catch (err) {
      if (on && String(err).includes("cannot start sh: program not found")) r = await powershell();
      else throw err;
    }
  }
  if (r.code === 2) throw new Error("File not found");
  if (r.code === 3) throw new Error("Image larger than 20 MB");
  if (r.code !== 0 || !r.stdout.trim()) throw new Error((r.stderr || "Can't read this file").trim());
  return fromBase64(r.stdout);
}

// herdr's Buffer decodes natively; a per-character loop over megabytes of base64 stalls its engine.
function fromBase64(text) { return new Uint8Array(Buffer.from(text, "base64")); }

function fromText(text) { return new Uint8Array(Buffer.from(text, "utf8")); }
