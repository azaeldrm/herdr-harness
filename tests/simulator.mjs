// Exercises the Simulator with herdr's APIs stubbed: specs merge and validation, checkShares surviving a share that
// Stop removes mid-check and repairing an offline device, and (on Linux) finding herdr's ssh connection to a machine
// and copying a virtual device.
import { mkdirSync, writeFileSync, cpSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL, fileURLToPath } from "url";

// The mod is copied beside stub packages for gpui-kit, gpui-base and herdr, then imported.
const modDir = fileURLToPath(new URL("../src/harness-simulator", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "harns-simulator-test-"));
const pkg = (name, src) => {
  mkdirSync(join(work, "node_modules", name), { recursive: true });
  writeFileSync(join(work, "node_modules", name, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  writeFileSync(join(work, "node_modules", name, "index.js"), src);
};
pkg("gpui-kit", "export class View {}; export const div = () => ({}), svg = () => ({});");
pkg("gpui-base", "export const h_flex = () => ({}), v_flex = () => ({});");
pkg("herdr", `
export const appHome = () => "HOME";
export const readTextFile = async p => globalThis.files[p] ?? null;
export const exec = (...a) => globalThis.execStub(...a);
export const hc = async () => ({ stdout: "{}" });
export const layout = () => null, settings = () => ({}), window = () => ({ platform: "windows" }), theme = () => ({});
export const spaces = () => [], machines = () => [], panes = () => [], terminals = () => [], focused = () => null;`);
mkdirSync(join(work, "mod"), { recursive: true });
cpSync(modDir, join(work, "mod"), { recursive: true });
writeFileSync(join(work, "package.json"), JSON.stringify({ type: "module" }));

const { default: Sim } = await import(pathToFileURL(join(work, "mod", "main.js")).href);
const P = Sim.prototype;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

// Specs: the mod's defaults under harness.json's `emulator`, per device too.
globalThis.files = {
  "HOME\\mods\\harness-simulator\\emulator.json": JSON.stringify({ default: { memory: 4096, cores: 4, gpu: "host" }, devices: { a: { gpu: "swiftshader_indirect" } } }),
  "HOME\\harness.json": JSON.stringify({ localMachineName: "pc", emulator: { default: { memory: 6144 }, devices: { a: { cores: 6 }, b: { memory: "4GB", gpu: "host gpu" } } } }),
};
const s = { specs: null, host: { sep: "\\" } };
for (const k of ["path", "loadSpecs", "spec", "goodSpec", "badSpec", "launchArgs", "specText"]) s[k] = P[k].bind(s);
await s.loadSpecs();
check("a device gets the defaults, harness.json's defaults over them, and its own values over both", s.spec("a"), { memory: 6144, cores: 6, gpu: "swiftshader_indirect" });
check("a device not listed takes the merged defaults", s.spec("z"), { memory: 6144, cores: 4, gpu: "host" });
check("values the emulator wouldn't take are left out of its flags", s.launchArgs("b"), ["-avd", "b", "-no-boot-anim", "-cores", "4"]);
check("and named", s.badSpec("b"), ['memory "4GB"', 'gpu "host gpu"']);
check("good values are named nowhere", s.badSpec("a"), []);
globalThis.files = {};
await s.loadSpecs();
check("no settings files: no flags beyond the device, no tooltip text", [s.launchArgs("z"), s.specText("z")], [["-avd", "z", "-no-boot-anim"], ""]);

// checkShares: Stop removes a share while its machine's adb devices answers; nothing throws, nothing else is touched.
const calls = [];
const sim = { shares: { a: { machine: "m", tunnel: 7, port: 15555, serial: "127.0.0.1:15555" }, b: { machine: "m", error: "no key", retryAt: 0 } } };
sim.ready = () => true;
sim.unshare = async avd => { calls.push(`unshare ${avd}`); delete sim.shares[avd]; };
globalThis.execStub = async (cmd, args) => {
  calls.push(`${cmd} ${args.join(" ")}`);
  if (args[0] === "devices") { delete sim.shares.a; return { code: 0, stdout: "List of devices attached\n" }; }   // Stop, mid-check
  return { code: 0, stdout: "" };
};
let threw = null;
try { await P.checkShares.call(sim); } catch (e) { threw = String(e); }
check("a share removed mid-check doesn't throw", threw, null);
check("and nothing more is run for it", calls, ["adb devices"]);
check("a share that never got a tunnel is left for tend()'s retry, error kept", sim.shares.b, { machine: "m", error: "no key", retryAt: 0 });

// An offline device: disconnected first, then connected fresh.
calls.length = 0;
sim.shares = { a: { machine: "m", tunnel: 7, port: 15555, serial: "127.0.0.1:15555", error: "old" } };
globalThis.execStub = async (cmd, args) => {
  calls.push(`${cmd} ${args.join(" ")}`);
  if (args[0] === "devices") return { code: 0, stdout: "List of devices attached\n127.0.0.1:15555\toffline\n" };
  if (args[0] === "connect") return { code: 0, stdout: "connected to 127.0.0.1:15555\n" };
  return { code: 0, stdout: "" };
};
await P.checkShares.call(sim);
check("an offline device is disconnected, then connected again", calls, ["adb devices", "adb disconnect 127.0.0.1:15555", "adb connect 127.0.0.1:15555"]);
check("and its error clears", sim.shares.a.error, undefined);

// Linux: a tunnel rides herdr-core's ssh connection to that machine, found from its clients' command lines.
{
  const { herdrClient } = await import(pathToFileURL(join(work, "mod", "linux.js")).href);
  const line = (target, extra = "") => `ssh -S /run/user/1000/herdr-core/ssh-9b45c67090ef -o ControlMaster=no -o BatchMode=yes ${extra}-T ${target} sh -c 'p=$(command -v herdr-core)'`;
  check("herdr's client to the machine gives its socket", herdrClient(line("azael@compute"), "azael@compute"), "/run/user/1000/herdr-core/ssh-9b45c67090ef");
  check("a client to another machine doesn't", herdrClient(line("azael@compute-2"), "azael@compute"), null);
  check("options with values are skipped", herdrClient(line("box", "-p 2222 "), "box"), "/run/user/1000/herdr-core/ssh-9b45c67090ef");
  check("the master itself isn't a client", herdrClient("ssh: /run/user/1000/herdr-core/ssh-9b45c67090ef [mux]", "box"), null);
  check("an ssh that isn't herdr's isn't used", herdrClient("ssh -S /tmp/mine -T box", "box"), null);
}

// Linux: a copy of a virtual device is its config.ini without its data, named for itself, beside an .ini pointing at it.
if (process.platform !== "win32") {
  const { execFile } = await import("child_process");
  const { readFileSync } = await import("fs");
  globalThis.execStub = (cmd, args) => new Promise(done => execFile(cmd, args, (err, stdout, stderr) => done({ code: err ? err.code ?? 1 : 0, stdout, stderr })));
  const avd = join(work, "avd");
  mkdirSync(join(avd, "phone.avd"), { recursive: true });
  writeFileSync(join(avd, "phone.avd", "config.ini"), "AvdId=phone\navd.ini.displayname=phone\nhw.lcd.width=1080\nhw.lcd.height = 2400\n");
  writeFileSync(join(avd, "phone.ini"), "avd.ini.encoding=UTF-8\npath=/x/phone.avd\npath.rel=avd/phone.avd\ntarget=android-35\n");
  const { linuxHost } = await import(pathToFileURL(join(work, "mod", "linux.js")).href);
  const host = await linuxHost();
  host.avdHome = avd;
  await host.copyDevice("phone", "phone_2");
  check("the copy's config.ini keeps the device's settings and takes its own name",
    readFileSync(join(avd, "phone_2.avd", "config.ini"), "utf8"), "hw.lcd.width=1080\nhw.lcd.height = 2400\nAvdId=phone_2\navd.ini.displayname=phone_2\n");
  check("and its .ini points at it, with the device's target",
    readFileSync(join(avd, "phone_2.ini"), "utf8"), `avd.ini.encoding=UTF-8\npath=${join(avd, "phone_2.avd")}\npath.rel=avd/phone_2.avd\ntarget=android-35\n`);
}

rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
