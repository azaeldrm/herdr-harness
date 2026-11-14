import { readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative as nativeRelative, resolve } from "path";
import { fileURLToPath } from "url";

// Paths inside the copy, always with "/": on Windows path.relative answers with "\", which
// wouldn't match the "diagrams/x.js" entries below.
const relative = (from, to) => nativeRelative(from, to).split("\\").join("/");

export const DIAGRAMS = ["flowchart", "sequence", "state", "class", "er", "gantt", "pie", "mindmap", "timeline", "gitGraph"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "pele");
const esm = join(pkg, "dist", "esm");
// Both mods that draw mermaid carry the same copy: the Files panel and the chat.
const OUTS = ["harness-files", "herdr-chat"].map(mod => join(root, "src", mod, "vendor", "pele"));
const check = process.argv.includes("--check");

const pinned = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies.pele;
if (!existsSync(pkg)) {
  if (check && OUTS.every(out => existsSync(join(out, "README.txt")))) {
    for (const out of OUTS) {
      const copied = /Pele (\S+)/.exec(readFileSync(join(out, "README.txt"), "utf8"))?.[1];
      if (copied !== pinned) { console.error(`${relative(root, out)} holds Pele ${copied}, package.json pins ${pinned}: run npm install && npm run vendor:pele`); process.exit(1); }
    }
    console.log(`vendor/pele is Pele ${pinned} in both mods (contents not compared: run npm install for that)`);
    process.exit(0);
  }
  console.error("node_modules/pele is missing: run npm install first"); process.exit(1);
}
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
if (version !== pinned) { console.error(`node_modules has Pele ${version}, package.json pins ${pinned}: run npm install`); process.exit(1); }

const files = new Set();
const follow = file => {
  if (files.has(file)) return;
  files.add(file);
  const source = readFileSync(join(esm, file), "utf8");
  for (const m of source.matchAll(/from\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)|import\s*["'](\.[^"']+)["']/g))
    follow(relative(esm, resolve(dirname(join(esm, file)), m[1] ?? m[2] ?? m[3])));
};
for (const entry of ["core.js", ...DIAGRAMS.map(d => `diagrams/${d}.js`)]) follow(entry);

const readme = `Pele ${version} (https://github.com/obsidianmd/pele), MIT: see LICENSE.\n` +
  `Copied by scripts/vendor-pele.mjs from npm: core and ${DIAGRAMS.join(", ")}.\nDon't edit: change the pin in package.json and run npm run vendor:pele.\n`;
const wanted = new Map([...files].map(f => [f, readFileSync(join(esm, f))]));
wanted.set("LICENSE", readFileSync(join(pkg, "LICENSE")));
wanted.set("README.txt", Buffer.from(readme));

let failed = false;
for (const out of OUTS) {
  const existing = [];
  const walk = d => { if (existsSync(d)) for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : existing.push(relative(out, p)); } };
  walk(out);
  if (check) {
    const problems = [];
    for (const [f, bytes] of wanted) if (!existsSync(join(out, f)) || !readFileSync(join(out, f)).equals(bytes)) problems.push(`differs or missing: ${f}`);
    for (const f of existing) if (!wanted.has(f)) problems.push(`not from Pele ${version}: ${f}`);
    if (problems.length) { console.error([`${relative(root, out)}:`, ...problems, "run npm run vendor:pele"].join("\n")); failed = true; }
    else console.log(`${relative(root, out)} matches Pele ${version}: ${wanted.size} files`);
  } else {
    rmSync(out, { recursive: true, force: true });
    for (const [f, bytes] of wanted) { mkdirSync(dirname(join(out, f)), { recursive: true }); writeFileSync(join(out, f), bytes); }
    const kb = [...wanted.values()].reduce((n, b) => n + b.length, 0) >> 10;
    console.log(`copied Pele ${version}: ${wanted.size} files, ${kb} KB, into ${relative(root, out)}`);
  }
}
if (failed) process.exit(1);
