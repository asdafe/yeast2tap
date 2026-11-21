# yeast2tap Local Browser Test Infrastructure

Permanent, hardware-free Playwright/Chromium harness for the yeast2tap web UI. Opens the firmware's **real embedded web assets** locally, tests every embedded page at desktop/tablet/mobile sizes, captures JavaScript/HTTP/CSS failures, takes screenshots, and produces a readable report — **without an ESP32, without serial/Wi-Fi/MQTT/OTA/BLE/iSpindel/provisioning/AP/DuckDNS, and without modifying the firmware.**

## What this is

- A project-local Node package under `tools/ui-tests/` (dev-only; never a firmware build input).
- A small HTTP/WebSocket mock server on `127.0.0.1` that parses the **exact gzip byte arrays** from `wdoc/*.h` and serves them with the firmware's `Content-Type` / `Content-Encoding: gzip` behavior.
- Playwright tests driving Chromium against the local server.
- A thin global OpenCode skill so the harness is usable from every session.

## What it is NOT

- Not an ESP32, serial port, physical device, Wi-Fi scan, MQTT, OTA, BLE, iSpindel, SmartConfig, AP portal, or DuckDNS test.
- Not a modification of `src/`, `wdoc/`, `htmljs/src`, `htmljs/dist`, or `platformio.ini`.
- Not a simulation of real control algorithms, sensor readings, calibration, or relay actions.
- Not a claim that a mocked response is real firmware behaviour.

## Repository layout (new files only)

```
tools/ui-tests/
  package.json              # isolated dev deps (@playwright/test, ws), pinned
  .gitignore                # node_modules/, artifacts/
  playwright.config.js      # Chromium, baseURL http://127.0.0.1:4173, webServer
  README.md                 # this file
  server/
    embedded-assets.js      # parse wdoc/*.h gzip byte arrays; route map
    embedded-assets.test.js # node:test unit tests
    fixtures.js             # in-memory mock API / WebSocket fixtures
    server.js               # HTTP + WebSocket mock + request journal
  tests/
    smoke.spec.js           # /__health and /
    assets.spec.js          # shared.js, bwf.js, dygraph.min.js MIME/gzip/length
    pages.spec.js           # 8 pages x 3 viewports: status, console/page/HTTP errors,
                            # overflow, body text, screenshots
    interactions.spec.js    # navigation, theme, control tabs, scale selector,
                            # setup picker, pressure nav (hardware-free only)
    language.spec.js        # compiled language headers (7 languages) + scale English
  scripts/
    start-server.js         # launches the mock server
    summarize.js            # results.json -> artifacts/summary.md
    verify-firmware.js      # runs pio.exe run -e esp32 (evidence only)
  artifacts/                # generated: report/, results.json, screenshots/, summary.md
  test-results/             # Playwright run output (generated)
```

## Install (one time, from the repository root)

```powershell
cd tools/ui-tests
npm install
npx playwright install chromium
```

Requires Node.js 24 and npm 11 (already present). `@playwright/test@1.64.1` and `ws@8.18.3` are installed as dev dependencies only; Chromium goes to the user's Playwright browser cache (`%LOCALAPPDATA%\ms-playwright`). Nothing is added to firmware dependencies.

## Commands (run from `tools/ui-tests/`)

| Command | Purpose |
|---|---|
| `npm run test:smoke` | Server health + index page |
| `npm run test:assets` | shared.js / bwf.js / dygraph.min.js MIME + gzip + byte length |
| `npm run test:pages` | 8 pages × 3 viewports (24 tests) |
| `npm run test:interactions` | Navigation, theme, control, scale, setup, pressure |
| `npm run test:lang` | 7 compiled languages + English-only scale |
| `npm run test:all` | All suites; starts/stops the local server via webServer |
| `npm run report:summary` | Generates `artifacts/summary.md` from `artifacts/results.json` |
| `npm run verify:firmware` | Runs `pio.exe run -e esp32` (evidence only; never fixes source) |

`npm run test:all` is the recommended full run. It starts the local server through Playwright's `webServer`, runs every suite, writes `artifacts/results.json` and screenshots, then stops the server.

## Server behaviour

Real firmware behaviour mimicked:
- `/` and trailing-slash paths resolve to `index.htm`.
- Embedded files return `Content-Encoding: gzip` with `Content-Type` by path (`text/html` for `.htm`, `application/javascript` for `.js`).
- No `Cache-Control` on embedded responses; `Content-Length` is the gzip byte length.
- Unknown paths return 404; `/favicon.ico` returns 204.

Harness-only (not in firmware):
- Binds to `127.0.0.1` only; port configurable via `UI_TEST_PORT` (default 4173).
- `/__health` -> `{ ok: true }`.
- `/chart.php` -> 204 with `LogOffset: 0`; chart shell testable, log decoding not simulated.
- API/WebSocket endpoints return in-memory fixtures; every request is journaled.
- Device writes return 403 and are journaled: `POST /scale`, `/tschedule`, `/log`, `/fputs`, `/rm`, `/mqtt`, `/config`, `/rh`, `/psi`, `/ptc`, plus `/pill`, `/tcmd`, `/cap`, `/wifiscan`, `/wificon` and `POST /device.cfg`.
- `POST /theme` and `POST /notes` are UI state and are allowed.
- `/__requests` lists the journal; `POST /__requests/reset` clears it.
- WebSocket `/ws` greets with `A:<status>` and `W:<network>`, repeats `A` every second (harness-only, to suppress the client's "controller not updating" banner), and answers `c` with `C:<control constants>` and `n` with the setup discovery shape.

## Mocked endpoints (derived from the consuming page JS and real producers)

| Endpoint | Real counterpart | Notes |
|---|---|---|
| GET/POST /theme | `GET /theme`, `POST /theme` | theme persisted in memory |
| GET/POST /notes | `GET /notes`, `POST /notes` | dash + keg notes |
| GET /scale | `ScaleManager::statusJson()` | full status, 2 scales |
| GET /scale?daily=255 | scale daily records | `{ retentionDays, records }` |
| GET /config?cfg=1 | `jsonSystemConfiguration()` | title, mac, flash sizes, build time |
| GET /config?nb=1 | non-reboot save | `{}` |
| GET /tschedule | `/tschedule` | beer profile fixture |
| GET /psi | `/psi` | disabled pressure transducer |
| GET /rh | `/rh` | idle humidity control |
| GET /gdc | `/gdc?data` | gravity device config |
| GET /log | `/log?data=1` | remote logging config |
| GET /mqtt | `/mqtt` | disabled MQTT |
| GET /ptc | `/ptc` | disabled parasite temp control |
| GET /getstatus | `/getstatus` | lean status |
| GET /loglist.php | `loglist.php` | empty log list |
| GET /list | `/list` | empty file list |
| GET /device.cfg | `/device.cfg` | empty backup |
| POST /time | `/time` | `{}` |
| WebSocket /ws | greeting + `c`/`n`/`d`/`h` | fixtures only |

The full endpoint table and real-vs-mock differences are also in `artifacts/summary.md` after a run.

## Test suites

### smoke (1)
Health endpoint + index reachable.

### assets (5)
`/shared.js`, `/bwf.js`, `/dygraph.min.js`: status 200, `application/javascript`, `Content-Encoding: gzip`, byte length equals `*_len`, decompressed body contains expected marker; index is real gzip HTML containing `yeast2tap`; unknown static path 404. All assets loaded from `http://127.0.0.1:4173/` (never an external host).

### pages (24)
`index`, `control`, `logging`, `setup`, `scale`, `config`, `gravity`, `pressure` × `desktop 1440×900`, `tablet 834×1112`, `mobile 390×844`. Each asserts: status 200, visible non-empty body, no console errors, no uncaught page errors, no failed requests, no HTTP ≥ 400, no external requests, no horizontal overflow (`scrollWidth ≤ clientWidth + 2`), non-zero body text, and a full-page screenshot to `artifacts/screenshots/<page>-<viewport>.png`.

### interactions (6)
Header navigation to every page (desktop), theme swatch applies + persists via `GET /theme` across reload, control mode tabs + Advanced Settings fold open/close without saving, scale selector switches visible settings, setup add-device picker opens/closes locally, pressure nav visibility is local storage state. Each asserts no forbidden hardware write was journaled.

### language (10)
The eight compiled `wdoc` language headers (`english`, `chinese`, `spanish`, `portuguese-br`, `slovak`, `italian`, `norwegian`, `turkish`) serve `index.htm` with the matching `<html lang>` and localized body. `scale.htm` is translated too (it used to be English-only). Two extra tests cover Turkish: one asserts the Scale page is really Turkish, the other loads all eight pages and checks that the longer Turkish words do not cause horizontal overflow. Language is compile-time, not a runtime switch.

## Reporting

- Playwright HTML report: `tools/ui-tests/artifacts/report/`
- JSON results: `tools/ui-tests/artifacts/results.json`
- Screenshots: `tools/ui-tests/artifacts/screenshots/<page>-<viewport>.png`
- Failure traces: `tools/ui-tests/artifacts/test-results/<test>/trace.zip`
- Human summary: `tools/ui-tests/artifacts/summary.md` (run `npm run report:summary`)

`artifacts/` and `test-results/` are git-ignored (`tools/ui-tests/.gitignore`); they remain on disk but are not committed.

## Real-vs-mock differences (documented, not hidden)

- Mock fixtures are in-memory and derived from the consuming JavaScript and real JSON producers (`greeting()`, `ScaleManager::statusJson()`, `jsonSystemConfiguration()`).
- `/chart.php` returns 204; log decoding and plotted data are explicitly not simulated. Layout/assets/JS are still tested.
- The periodic WebSocket `A:` status is harness-only and does not exist as a timed push in this mock.
- Device writes are blocked (403) and journaled; they never reach hardware.
- `POST /theme` persists in memory only; it does not rewrite the gzip HTML.

## Real firmware vs local mock

The server reads current `wdoc/*.h` bytes, **not** `htmljs/src`. If you edit UI sources, run `npm run embed` yourself to regenerate `wdoc/` before testing — this harness never runs the embed step automatically (it would rewrite existing generated files). See `htmljs/` for the embed workflow.

## Firmware / build impact

- None at build time. `tools/` is outside PlatformIO's `src_dir`/`include_dir`.
- Playwright and Chromium are dev-only under `tools/ui-tests/node_modules`; not in any firmware dependency list.
- `wdoc`, `htmljs/dist`, `src`, and `platformio.ini` are read-only for this work.
- `npm run verify:firmware` attempts `pio.exe run -e esp32` once as verification evidence. A failure is reported as a pre-existing build issue and is not fixed here.

## Global OpenCode skill

A skill at `~/.config/opencode/skills/yeast2tap-ui-tests/SKILL.md` makes this harness discoverable from any OpenCode session. It locates the repo, checks that `node_modules` and Chromium exist, runs the requested suite, reads `artifacts/summary.md` and screenshots, and reports failures with page/viewport/condition. It warns if `htmljs/src` is newer than `wdoc` and never touches firmware, hardware, checkpoints, or commits.

## Prohibited actions (harness invariant)

Never: ESP32, serial, physical-device HTTP, Wi-Fi scan, MQTT, OTA, BLE, iSpindel, SmartConfig, provisioning, AP, DuckDNS, `npm run embed`, grunt, or any command that rewrites `htmljs/dist`/`wdoc`. Never modify, stage, commit, or checkpoint existing project files. Never fix a UI defect found by the tests without explicit approval — report it with page, viewport, and condition.

## Rerun after a run

```powershell
cd tools/ui-tests
npm run test:all
npm run report:summary
# inspect artifacts/summary.md and artifacts/screenshots/*.png
```
