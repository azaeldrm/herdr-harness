// Every picture a built mod names (`mods/<mod>/....svg`, .png, .webp) is in that mod's own folder: a listing's mods
// work alone, and no picture is missing. herdr's own mods (files, changes, pane) are herdr's to ship.
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const ours = readdirSync(join(repo, "src")).filter(name => name !== "shared");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`);
  if (!ok) failed++;
};
const scripts = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return f === "vendor" ? [] : statSync(p).isDirectory() ? scripts(p) : f.endsWith(".js") ? [p] : [];
});

for (const listing of ["layouts/harns", "layouts/herdr-chat"]) {
  const mods = join(repo, listing, "mods");
  for (const mod of readdirSync(mods)) {
    const missing = [], elsewhere = [];
    for (const file of scripts(join(mods, mod))) {
      for (const [, owner, path] of readFileSync(file, "utf8").matchAll(/mods\/([a-z0-9-]+)\/([A-Za-z0-9_./-]+\.(?:svg|png|webp))/g)) {
        if (owner === mod) { if (!existsSync(join(mods, mod, path))) missing.push(path); }
        else if (ours.includes(owner)) elsewhere.push(`mods/${owner}/${path}`);
      }
    }
    check(`${listing}: ${mod} finds every picture it names`, missing.length === 0, [...new Set(missing)].join(", "));
    check(`${listing}: ${mod} names no picture in another of our mods`, elsewhere.length === 0, [...new Set(elsewhere)].join(", "));
  }
}
process.exit(failed ? 1 : 0);
