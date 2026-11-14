# harns

A dark, amber-accented herdr window organized by machine. The sidebar lists every
connected machine (hover it for a card of all its details; the Classic style adds live CPU, RAM
and per-GPU load rings) and the agents running on it, each a two-line card with its session title, status,
folder and branch, and context used. Agent tabs open as a
chat (from [herdr-chat](https://github.com/azaeldrm/herdr-chat)) or their live terminal.
A status bar shows where you are and how much Claude Code and Codex quota is left.

![harns](preview.png)

Needs [herdr-chat](https://github.com/azaeldrm/herdr-chat) for the chat and the toggle: the
installer adds it, and adding this layout by hand means adding that repository's mod too.

To add it, run `./install.sh` from a clone (or `python scripts/install.py`). By hand, copy
more than the layout and its mods: `layouts/harns.json` with its picture
`layouts/harns.png`, every folder in `mods/` (the rings' images live in
`machine-stats`), `themes/harness.json` and `brand-assets/`, merge `programs.json`'s
entries into yours, and add `layouts/harns.keys.json` to your `keys.json` as its `layout:harns` section.

## What you see

Left to right: a sidebar, then the work column. There's no system title bar.

- **Sidebar** (268 px, `surface` `#0e1012`; drag 44–480 px, or fold to a 52 px rail, twice its 26 px icon axis so what the rail centres lines up with the open sidebar's icons;
  76 px on macOS):
  - **Brand** (46 px, drags the window): the animated harns logo (28 px), "harns"
    (16 px semibold), then Search and the sidebar toggle.
  - **Agents:** grouped by machine, with no heading. Each group has its system's icon (Windows, macOS, or the Linux
    distribution: os-release's ID, else its family, else Tux; Omarchy by its `~/.local/share/omarchy`; the BSDs by
    `uname`; Windows only when `cmd.exe /c ver` says so), asked each machine once a run and kept for the next, which shows
    it until the machine answers again (a drive or a screen before it ever has); the machine's name (this computer's own
    name, or a nickname; 13 px and gray like the icons, starting where its agents' titles do), a + to start an agent
    there, a row of CPU, RAM and GPU rings (one per GPU, amber), then its agents. Each agent is a two-line card: the program icon, the
    session's own title (without the harness's prefix, and the folder Pi and Codex add after it; else the
    program's name) and its status; under it, in 11.5 px dim, a 14 × 3 px bar of its context window under the icon, as on the
    rail, then its folder (the session's, from the log herdr-chat found for it,
    shared `herdr-chat.paths`; else the pane's) and git branch. Sub-agents hang under their parent as a
    tree (26 px rows; in Tree their bot has no antenna, `harness-chrome/bot-small.svg`). In Tree the program's logo sits
    on the bot's corner on a halo of itself in the row's color (copies nudged 1 px each way), not a disc; a picture
    icon keeps the disc. Its terminals that aren't agents (a shell, a dev server, lazygit) follow its agents, a 28 px row
    each: the program's icon in the agents' icon column, the program running now and its folder; a click focuses it and
    shows the Terminal view; on the rail, just the icon, on the agents' axis, with the rest in its tooltip. The machine's
    name is followed by its counts, each with its icon: agents (a bot), and terminals (`>_`) when it has any.
    A machine with no agents says "No agents", "Connecting…" or "Offline".
    The list scrolls without a scrollbar; where more is out of sight, its top (under the logo) and bottom (over the
    footer) fade, as 32 px of 12 bands of `surface`. The position is followed from the wheel (a mod can't read it).
    That's the Classic style (shared `harness.sidebar` `classic`); the Tree style (the default) drops the band's box,
    system icon, rings and counts and hangs each machine's agents and terminals from its icon (a laptop or a server) on
    1 px lines, each agent's bot icon with its program's icon small at its corner. In both, machines can be dragged into
    an order by their bands (kept in the mod's localStorage, `machines.order`).
  - **Footer** (44 px): Settings (a gear, with an amber dot when an update is ready), Add machine (a server), and
    harns's Settings (the logo, a 760 px dialog from `harness-settings`: General, Sidebar, Chat, Status bar, Simulator,
    which write shared `harness.local-name`, `harness.sidebar`, `harness.context-bar`, `herdr-chat.chat`, `herdr-chat.animation`,
    `harness.status`, `harness.quota.claude`, `harness.quota.codex`, `harness.commands-hint` and `harness.simulator`).
    A choice between options (the sidebar's style, its context bars) is a row of picture cards, as Herdr's settings
    show layouts: each a small live drawing of what it gives, the chosen one outlined in amber with a check, and what it
    does under them. On/off settings are switches.
- **Tab bar** (42 px, `chrome` `#0b0d0e`, drags the window): the space's tabs as labels
  with the program icon, the active one underlined in amber (2 px) with a close button;
  then +, Files, Changes, Simulator (Windows and Linux), and the window buttons on Windows and Linux.
- **Work area** (12 px padding): the shown tab, as a chat (where a new agent session starts) or as terminal cards (10 px
  radius, 1 px `border`, a 42 px header with the Chat / Terminal toggle). Files,
  Changes or Simulator open in a 368 px panel on the right.
- **Status bar** (42 px, `surface`): the shown space's machine and branch, the focused
  pane's folder, "N needs you" when agents on that machine are blocked, then Claude Code and Codex quota bars (44 × 4 px)
  and "Ctrl Shift P commands" (each can be turned off in harns's Settings, and the bar hidden).

The theme is `harness`: background `#080a0b`, canvas `#060708`, text `#dededb`, accent and
working `#e9aa35`, done `#10a7a7`, idle `#80868b`, borders `#25282b`. Fonts are herdr's.

## How it behaves

- **Agent status**, in the sidebar: working is an amber ring spinning once every 900 ms;
  blocked is a "Needs you" badge (a "!" in the rail); done is a green check (the theme's
  `ansi2`); idle shows nothing open (the card's bar under the icon shows its context) and, on the rail, the same
  14 × 3 px context bar. It fills with the share used (gray, amber above 75%, red `#d88179` above 90%), or, with
  shared `harness.context-bar` `health` (Settings → Sidebar → Context bar), drains like a health bar to the share left
  (green, amber below 45% left, red below 25%); hovering it gives the percentage either way. On the
  rail the mark sits on the row's second line, under the icon.
  With the Health bar (Tree), the program logo carries the status instead: working, it hops in amber from side to side
  over the bot in a round arc (even pace across, easing up and down), an amber ripple ring spreading where it lands
  (`harness-chrome/ripple.svg`, an oval stretched as it grows). The sidebar drives it, one beat per half hop, each step
  a native transition and a fresh ring each landing, so ring and landing never drift apart. Above the logo, on its own
  halo: the green check (done, until it's looked at) or a red question mark (`harness-chrome/question.svg`, blocked; the
  logo stays amber). So there's no spinner, check or "Needs you" badge; on the rail every agent's second line is its
  context bar; names and icons are gray but for the agent in front's, white.
  Tabs show the same spinner, or a dot for blocked and done.
- **Context readings:** Claude Code and Pi report through the relays (Watch out). Codex's
  reading is its log's newest `token_count` (last input tokens of the model's window), from the
  log herdr-chat found for it (shared `herdr-chat.paths`); else its footer's "Context N% left",
  when `context-remaining` is one of its `tui.status_line` items and the terminal is wide enough
  for Codex to show it. A machine's readings are fetched when one of its agents
  finishes a turn, appears or goes away, or the machine comes online, and cleared while it's
  unavailable.
- **Logo:** it fades in and out while any agent is working and bobs up and down otherwise.
  Clicking it folds or unfolds the sidebar.
- **Sidebar:** clicking an agent focuses it; hovering a card shows a pin, and pinned
  agents sit in a Pinned group on top. Each machine keeps its own order: an agent that finishes, starts needing you or is new
  moves to the top, and dragging a card onto another of the same machine puts it there.
  A card that changes place slides there (280 ms, ease-out), and the ones it passes slide too.
  Alt+Down and Alt+Up (`agent.next`, `agent.prev`) walk the agents in the list's order: Pinned, then
  each machine top to bottom. Alt+Shift+Down and Alt+Shift+Up jump to the next or previous machine's top
  agent, coming round past the last (`machine-agents.next-machine`, `.prev-machine`). Alt+Left and Alt+Right show
  the agent's Chat or Terminal (`layout.select` on the `chat-view` stack; herdr-chat follows). These keys are
  `layouts/harns.keys.json`; the installer adds each to keys.json's `layout:harns` section unless that keystroke is
  bound there already, and keeps the old file as `keys.json.before-install-<time>` when it changes. Without a
  keys.json (Herdr not opened yet) it adds none and says so.
  A machine's whole band (its name, and in Classic its rings) folds its agents; parents with sub-agents fold too. A machine's + opens the agents
  installed there.
- **Details cards** (an agent's, a machine's) hang from the row's top-right corner, right against the
  sidebar: the first opens after 450 ms, and while one is up (or was, under 400 ms ago) moving to
  another row opens its card at once. A card closes 150 ms after the pointer leaves the row and the card.
- **Agent card:** resting on an agent's card opens a 340 px card beside the
  sidebar, level with it: the agent's name, program and machine; its status, for how long
  and its turn; its space and tab, full folder and branch; the context used as a bar; and
  its sub-agents, each with its status and for how long. Not while a card is being dragged.
- **Machine card:** resting on a machine's band opens a 340 px card level with it,
  beside the sidebar. Each part is a title (icon, name) and rows of label, a 148 px bar and the
  value, in fixed columns: CPU load and temperature (cores, threads and load averages under
  them), memory used, each GPU's load, VRAM, temperature and power against its limit (NVIDIA,
  through `nvidia-smi`; a GPU with no live readings is left out), each disk's use, and the
  motherboard. Bars are amber, orange (`#e8823a`) when high and red (`#d88179`) when near
  full: use from 80% and 95%, temperatures from 70 and 85 °C, power from 85% and 98% of its
  limit. It's read on the machine when the card opens and every 3 s while it's in use
  (Python 3 on Linux and macOS, PowerShell on Windows, where the CPU temperature needs
  administrator rights, so the card leaves it out).
- **Rings:** CPU, RAM and GPU refresh every second; hover one for its percentage. A ring
  stays empty until its first reading arrives.
- **Usage meters:** Claude's and Codex's limits belong to the account, so the bar shows one
  reading per service on every machine, from the service itself: Anthropic's OAuth usage
  endpoint with Claude Code's login, and `codex app-server`'s `account/rateLimits/read`. Each
  reading replaces the last (kept in shared `machine.usage` across restarts), so a usage reset
  shows at once. They're read when herdr starts, 2 s after a turn ends (seen in herdr's agent
  list: Claude Code's turn reads Claude, Codex's Codex, Pi's both) and every 15 minutes, for
  use outside herdr. They're asked on this computer, or on the first ready machine where the
  service is installed and signed in. A window past its reset reads 0%; a service signed out
  everywhere says so in the tooltip.
- **Tab bar:** click selects, double-click renames, drag reorders, right-click opens the
  tab menu, the scroll wheel moves between tabs. Files, Changes and Simulator toggle the right
  panel, remembered per space.
- **Simulator** (Windows and Linux; setup below): one Android emulator per session (tab), shared by its sub-agents.
  On Windows and on Linux under Hyprland, the panel shows the focused session's emulator's own window over its screen
  area; on other Linux desktops each emulator has its own window, with the panel's controls the same. Docked, it's at the
  device's aspect ratio, so it draws and takes input natively; the other sessions' keep
  running, hidden. It hides with the panel, while one of herdr's popups is open, and when
  herdr minimizes; it follows the window as it moves or resizes. A session without one gets
  Start (a free virtual device, or a copy of one); the header pops the emulators out into
  their own windows and back, restarts this session's (a shutdown, then a cold boot with
  `-no-snapshot-load`, so it doesn't resume Stop's snapshot) and stops it; both wait while one
  runs. Every 30 s, each shared emulator is looked for in its machine's `adb devices`; a missing
  or offline one is connected again, or its tunnel opened again. A share that couldn't be set up
  keeps its error showing and is tried again after 30 s, then twice as long each time, up to
  10 min. Errors in one round are shown and the next round still runs. Closing a tab stops its emulator and
  keeps the device. A session on another machine has its emulator shared there, shown as the
  machine's name in the header, with × to stop. Emulators start with the specs in
  `emulator.json` (by default 4096 MB, 4 cores, `-gpu host`; a
  device listed by name under `devices` gets its own) under the person's own, from
  `harness.json`'s `emulator` key (same shape; installs don't overwrite it), read again at each
  start. They're passed as `emulator` flags so they apply to every copy of a device too: memory
  and cores only as whole numbers, gpu as one word, anything else left out and named in the
  status. The title's tooltip shows them.
- **Status bar:** each quota bar shows the 5-hour window and switches to 7 days while
  hovered, red above 90%; the tooltip gives the reset time. The last item opens the
  command palette.

## Built from

- **Layout** `layouts/harns.json`, cloned from `main`: root `row` (`titlebar:
  none`, theme `harness`, `terminal_padding [14, 12]`) → `sidebar` column [`brand`
  block, `sidebar-lists` column with the `agents` block, `sidebar-footer` block] and `work` column [`tabs` block,
  `work-body` row [`chat-view` stack of `chat-panel` and `terminal-panel`, hidden
  `panel` column with a `panel-body` stack of `files`, `changes` and `simulator`], `status` block].
- **Mods:**
  - `harness-chrome`: the brand bar, or the footer with props `{footer: true}`. Folds
    the sidebar with `layout.resize` and opens the shipped `picker` and `machine-add`.
  - `machine-agents`: the agents list, its machine cards and context bars. Calls `setAgentOrder`, `pane.focus` and `terminal.peek`.
  - `machine-metrics`: draws a machine's ring row (built into `machine-agents`).
  - `machine-new-menu`: the per-machine agent menu, from `knownAgents({on})`.
  - `harness-tabs`: the tab bar; uses the shipped `new-menu` and `menu`.
  - `harness-simulator`: the Simulator panel. herdr draws with DirectComposition, which covers
    child windows, so `harns-dock` (built once from `dock.cs` with Windows' own `csc.exe` into
    `cache/harness-simulator/`) makes each emulator's window a borderless popup owned by
    herdr's, just above it. The mod writes the screen area, as gaps from the window's
    bottom-right corner, to `cache/harness-simulator/dock-state.txt` only when it changes; the
    helper follows herdr's window through WinEvent hooks and, after a click or key press in
    herdr, asks `herdr-app status` whether an overlay is open. Nothing runs per frame. The
    state also names the emulator to show and every other one, which it keeps hidden.
    Sessions are tabs (`focused().tab`); their emulators are kept in localStorage `owners`.
    For a session on another machine, the mod writes `~/.config/harness/devices` there (each
    terminal of the tab, its panes' and the sub-agents under them from `terminals()` `parent`,
    and the emulator's serial there) and installs `adb.sh` as `~/.local/bin/adb`, which sets
    `ANDROID_SERIAL` from `HC_TERMINAL_ID` and filters `adb devices`. What differs by system is in `windows.js`
    (PowerShell, Windows' OpenSSH, `harns-dock`) and `linux.js` (`sh`, forwards on herdr-core's ssh connection or OpenSSH, `setsid`). On Hyprland,
    `dock-hyprland.py` (Python 3) reads the same state file: while it runs, a window rule (`harns-simulator`) opens
    every `Emulator`-class window floating and borderless on the hidden workspace `special:harns-simulator`, so one
    never tiles beside herdr or takes its maximized place; the shown one is brought onto herdr's workspace over the
    panel, checked against where it really is every 100 ms through Hyprland's socket, and hidden while herdr's own
    socket says an overlay is open. `quit` turns the rule off and gives the windows back.
  - `workspace-status-machine`: the status bar. It also collects the stats: a built copy of
    `machine-stats` publishes shared `machine.stats`, `machine.usage` and
    `machine.local-label`.
  - `herdr-chat` (separate repo): the chat panel and the pane header with the toggle. The chat
    block passes it `backdrop: true`: an empty chat (a new session's welcome, or no agent in
    view) plays an animated scene behind it, dimmed (sharks, jellyfish, a night sky, rain),
    switched with a button at its bottom right; the reply box goes see-through while it plays.
  - Shipped: the `changes` block; `picker`, `machine-add`, `new-menu`, `menu` and
    `worktree` as overlays; icons from `pane`, `files` and `changes`.
- **Programs it runs** through `exec(..., {on: machine})`: per platform
  (`machine-stats/platforms.js`) a PowerShell or Python 3 stats probe every second, the
  account probe above (an HTTPS request to Anthropic and a short-lived `codex app-server`),
  `nvidia-smi`, `uname -s` and `hostname`. Context bars read the relays' snapshots after
  turns end: this computer's directly (no process, as the relays write them), another
  machine's with `scripts/context-relay.py`'s collect() there; and Codex's logs (a small
  Python read of each one's newest `token_count`), else their footers with `hc read`.
- **Art:** `harness-logo-fade` and `harness-logo-bob` (WebP, SVG sources), monochrome SVG
  icons in `harness-chrome` and `machine-stats`, system icons in `machine-agents/os` (Simple Icons, CC0; see its
  SOURCES.md), a generated spinner, Windows
  window icons in `harness-tabs`, program icons in `brand-assets/` and `programs.json`.

## Simulator setup

The panel needs the Android SDK's `emulator` and `platform-tools` and one virtual device on this computer, and says
what's missing. Sessions on other machines need only `adb` there; on Windows, ssh to them with a key too (Linux reuses herdr's
connection).

- **Windows:** Android Studio installs the SDK in `%LOCALAPPDATA%\Android\Sdk`; create a device in its Device Manager.
- **Linux** (the SDK in `~/Android/Sdk`, or `ANDROID_HOME`):
  1. A JDK 17 or newer, for `sdkmanager` and `avdmanager` only: `mise install java@temurin-21`, or the distribution's
     OpenJDK.
  2. Google's command-line tools, `commandlinetools-linux-*_latest.zip` (developer.android.com/studio, "Command line
     tools only"), unpacked as `~/Android/Sdk/cmdline-tools/latest`.
  3. With `JAVA_HOME` set: `sdkmanager --licenses`, which the person accepts (Google's license), then
     `sdkmanager --install platform-tools emulator "system-images;android-35;google_apis;x86_64"`.
  4. `avdmanager create avd -n harns_phone -k "system-images;android-35;google_apis;x86_64" -d pixel_8`.
  5. KVM: `/dev/kvm` readable and writable by the person (most distributions: the `kvm` group).
- **Expo:** `npx expo start --android` (Expo Go or an installed dev build) needs only `adb`. `npx expo run:android`
  builds locally, so the agent's shell needs `ANDROID_HOME`, `JAVA_HOME` and `$ANDROID_HOME/platform-tools` on `PATH`.

## Watch out

**What it accesses:**

- runs programs on this computer and on connected machines (`exec(…, { on })`): a PowerShell
  or Python 3 stats probe every second, `nvidia-smi`, `uname -s`, `hostname`, `hc read`, and
  for the usage meters a short-lived `codex app-server`;
- with the Simulator panel open on Windows: the Android SDK's `emulator` and `adb` on this
  computer, `csc.exe` once to build `harns-dock`, and that helper while emulators are docked
  (it hooks herdr's window and mouse/keyboard release events only to place the device window
  and notice herdr's popups; it reads no input content);
- with the Simulator panel open on Linux: the SDK's `emulator` and `adb`, and on Hyprland `python3` running
  `dock-hyprland.py` while emulators are docked (it talks only to Hyprland's and herdr's sockets, to place the device
  window and notice herdr's popups, and adds and removes its one window rule);
- for each session on another machine with a running emulator: an SSH reverse tunnel to that
  machine, bound to its localhost: on Linux a forward added to herdr-core's own ssh connection (`ssh -S <its
  socket> -O forward -R 127.0.0.1:<port>:127.0.0.1:<emulator adb port>`, found from herdr-core's ssh clients in
  `ps`, cancelled with `-O cancel` and remembered in the mod's localStorage until then), else OpenSSH (Windows' own
  there) `ssh -N -R …`, `adb connect` / `adb disconnect` there, and two files there:
  `~/.local/bin/adb` (harns's `adb.sh`, never over an `adb` that isn't its own) and
  `~/.config/harness/devices`; on this computer, copies of a virtual device in
  `~/.android/avd` when more sessions need one;
- reads Claude Code's login (`~/.claude/.credentials.json`, or the `Claude Code-credentials`
  keychain item on macOS) and sends its token only to Anthropic's usage endpoint,
  `https://api.anthropic.com/api/oauth/usage`. That request and `codex app-server` are its only
  network use beyond herdr's own machine connections;
- reads the context snapshots the relays write in `~/.config/harness/context/` (session
  identifiers and context counts only; the relays send nothing anywhere), and files and Markdown
  shown in the Files panel (images beside a Markdown file are read from its machine; web images
  show as links and are never fetched);
- reads `harness.json` in the Herdr home for an optional nickname, and keeps its readings in
  shared `machine.*` values.

The installer writes only in the Herdr home, apart from the relays (see the README for the
files they add or change), and downloads herdr-chat from GitHub when it isn't installed.

**Notes for building it:**

- herdr's `fs.writeFile` writes binary data as an empty file while reporting success (text is
  written whole), and its `Buffer` encodes bytes to base64 as an empty string. `harness-files`
  saves images for `image()` by checking each copy reads back whole and, when it doesn't,
  writing it as base64 text (its own `toBase64` in `bytes.js`) for PowerShell, else Python 3
  or `base64`, to decode beside it.
- Each herdr mod imports from its own folder, so `scripts/build-mods.py` copies shared code:
  `machine-metrics` and `machine-stats`'s `details.js` (with what it runs on) into
  `machine-agents`, `machine-stats` into
  `workspace-status-machine`, `context-relay.py` into `context-probe.js`. Edit the
  sources and run it.
- The chat and the toggle need herdr-chat; without it those blocks show errors. The installer
  adds it from its repository when it's missing and never replaces an installed copy.
- Claude's and Pi's context readings come from the relays (`scripts/install-context.py`) on each
  machine: the installer sets them up on this computer, and `--on MACHINE` on the others.
  Pi's is a global extension publishing `getContextUsage()` every second; Claude's is the
  status line, keeping the session ID and `context_window` fields and passing the same input
  to a status line that was there before. Snapshots are keyed by `HC_TERMINAL_ID`, qualified
  with the machine name and checked against the terminal's creation time, never matched by
  folder. Claude reports no percentage early in a session; keep it unknown rather than 0%.
  `/reload` sent to Pi with `hc send` arrives as a message, so it's typed. The usage meters need only a machine where Claude Code and Codex are signed in. Claude's usage
  comes from Anthropic's OAuth usage endpoint with the `anthropic-beta: oauth-2025-04-20`
  header.
- Other machines need Python 3. GPU rings read NVIDIA cards through `nvidia-smi`; other vendors
  go in `machine-stats/gpus.js`, which has an entry for each.
- The installer is `scripts/install.py`; `install.sh` runs it with the first Python 3 that
  starts (on Windows, `python3` can be the Store placeholder), so install logic belongs in
  `install.py`.
- `harness-files` replaces herdr's `files` block (same block id, so its clicks survive). It is
  herdr's Files plus a Markdown view, and `vendor/pele` comes from `npm run vendor:pele`. Don't
  edit the vendored copy. With props `{ file }` it is a viewer for that one file. Clicking a
  Markdown or `.mmd` file in the tree opens it as that viewer in a floating window (`openOverlay`
  `kind: "window"`, key `harness-files-doc`: one at a time, reopened where it was dropped), headed
  by the file's name with Preview/Source and ×; the panel stays on its folder. Other files preview
  in the panel, with ← back.
- `harness-pane` is a pane header for layouts that want one; harns itself uses herdr-chat's.
- Sizes are read from the `sidebar` node's width: below 160 px every sidebar mod draws
  its rail. `machine-agents` draws the rail from the same rows as the open list, each in its open box with
  its icon alone and centred, so every row stays level as the sidebar folds, in either style: a machine's header icon as
  open (Tree: server or laptop; Classic: its system's, with its CPU ring for the rings row), sub-agents and terminals
  included, and a machine without agents a mark in its 26 px (a dash; a spinner while connecting; a cross offline).

## Done when

- `herdr-app check` passes for every mod and `herdr-app status` shows no errors.
- On Windows and on Linux under Hyprland, Simulator starts a virtual device inside the panel; the + menu shows over
  it, and Files hides it. On other Linux desktops it starts in its own window. Two sessions on another machine each get their own emulator: `adb devices`
  in each lists only its own, a sub-agent's lists its session's, and closing a tab stops its
  emulator.
- Each connected machine has a group with its agents under it (in Classic, with live CPU, RAM and GPU rings),
  and dragging a band reorders the machines; a working agent spins and the logo fades.
- Folding the sidebar leaves icons, rings and statuses centered in the rail, each level with its row in the open list.
- The status bar names the focused pane's machine and folder and fills the quota bars.
- A new Claude Code tab opens on its chat and toggles to Terminal from its header.
- Running the installer where herdr-chat isn't installed adds it; running it again leaves no layout
  backup behind.
