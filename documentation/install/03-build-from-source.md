# Build from source

The firmware is a PlatformIO project. The web interface is not a separate artefact — it is compiled
into the firmware image, so a UI change means a rebuild.

---

## 1. Prerequisites

| Tool | Version used here | Notes |
|---|---|---|
| PlatformIO Core | any recent 6.x | the `pio` command, or the VS Code extension |
| Node.js + npm | 18 or newer | only needed if you change the web interface |
| Python | 3.8+ | PlatformIO dependency |

The toolchain downloads itself on the first build; expect a few hundred megabytes.

---

## 2. The short version

```bash
git clone <this repository>
cd yeast2tap
pio run -e esp32            # build
pio run -e esp32 -t upload  # flash over USB
```

The environment you want is **`esp32`**. It is the first entry in `default_envs`, so a bare
`pio run` builds it too.

---

## 3. What `-e esp32` actually means

| Setting | Value |
|---|---|
| Board | `esp32dev` |
| Platform | `espressif32@~6.8.1` |
| Framework | Arduino |
| Partition table | `partition2.csv` |
| Monitor speed | 115200 |
| Upload speed | 115200 |
| Feature flags | only `-DEnableHumidityControlSupport=true`; everything else is a `Config.h` default |

Everything that changes behaviour lives in `src/Config.h` and `src/ConfigDefault.h`, not in
`platformio.ini`. That means two builds of the same commit differ only if those headers were edited,
which is what makes the binary reproducible in practice.

The interesting defaults for this build:

- BLE hydrometers (Tilt, Pill) **on**
- DHT sensors, humidity control **on**
- MQTT remote control **on**
- Auto-capping **on**
- Pressure transducer **on**
- Parasite (glycol loop) control **on**
- Rotary encoder **on** (GPIO 13 / 14 / 18; override with `-DrotaryAPin=…`)
- BME280 **off**
- BTHome / RAPT-as-a-device **off** (only the `esp32-dev` environment enables them)

If a feature from this documentation seems missing on your device, check whether your build has the
flag. See [Build and feature flags](../reference/11-build-and-flags.md) for the full table.

---

## 4. The partition table

`partition2.csv` is what makes OTA work:

```
nvs       0x9000   0x5000
otadata   0xe000   0x2000
app0      0x10000  0x1B0000     <- 1,769,472 bytes
app1      0x1C0000 0x1B0000
spiffs    0x370000 0x90000      <- 589,824 bytes
```

`spiffs` is the data partition even though the filesystem is LittleFS; the name is historical and
must not be changed, because the firmware looks it up by subtype.

Consequences you will meet in practice:

- **The app slot is nearly full.** This build uses about 98.7 % of it. There is roughly 23 KB of
  headroom, which is enough for small changes and not enough for a large new page.
- **Changing the partition table requires USB.** OTA only writes an app image; it cannot move the
  partitions. If you ever change `partition2.csv`, flash over serial and expect the filesystem to be
  recreated.
- **Two other tables exist and are not for this build.** `partition.csv` belongs to the
  `esp32-spiffs` environment (no second OTA slot), and `partition-single.csv` is unused by any
  environment.

---

## 5. Building the web interface

Only needed if you touch `htmljs/src`.

```bash
cd htmljs
npm install
npm run embed
cd ..
```

`npm run embed` runs two steps: `grunt i18n` builds `htmljs/dist/<language>/*.htm`, and
`embed-headers.js` gzips them into `wdoc/<language>_*_htm.h`. Those headers are what
`src/EmbeddedFiles.cpp` includes and serves.

Three things to know:

1. **All CSS and JS are inlined into each page** except four shared assets (`/bwf.js`, `/shared.js`,
   `/num.js`, `/dygraph.min.js`). That is why a single page header can be 100 KB of gzip.
2. **The minifier is not deterministic on every machine.** Regenerating can rewrite headers whose
   source you did not touch, with byte-different but functionally identical content. Revert what you
   did not intend to change before committing.
3. **PlatformIO does not notice header-only changes.** `EmbeddedFiles.cpp` reaches the page data
   through a token-pasting macro, so the build system sees no dependency. After `npm run embed`,
   delete `.pio/build/esp32/src/EmbeddedFiles.cpp.o` and build again, or the firmware keeps the old
   pages.

The firmware serves the `_s` variants of the dashboard and the control page. They are identical to
their unsuffixed siblings except for the Dygraph script reference, so there is no real "small"
layout — just a different asset path.

---

## 6. Localisation

Eight locale files ship: English, Chinese, Italian, Norwegian, Portuguese (Brazil), Slovak,
Spanish and Turkish. The build language is `WebPageLanguage` in `Config.h`, English by default;
`-DWebPageLanguage=turkish` builds the Turkish interface (`[env:esp32-tr]`, `[env:esp8266-tr]`).

Every page the firmware serves is translatable: its text lives in
`htmljs/src/locales/<lang>.json` and the templates hold `<%= key %>` placeholders. That includes
Control Mode and Scale, which used to be English-only. The offline log viewer
(`y2tlogviewer.htm`) and the LCD text in `src/DisplayLcd.cpp` are outside this system.

If you add a string, add it to every locale file or the placeholder will render literally.
`npm run embed` runs `scripts/check-i18n.js`, which fails the build when a locale is missing a
key, when a key used in a template does not exist, or when a built page still contains a raw
`<%= %>` marker.

---

## 7. Checking the build result

At the end of `pio run -e esp32` you get a memory summary:

```
RAM:   [==        ]  20.2% (used 66028 bytes from 327680 bytes)
Flash: [==========]  98.7% (used 1746289 bytes from 1769472 bytes)
```

- **RAM** is static allocation; the heap is separate.
- **Flash** is the app slot. The percentage is against 1,769,472 bytes, so a change of 2 KB is
  roughly 0.1 %.

Keep an eye on the free figure. Below about 8 KB the linker starts failing in ways that are hard to
read, and a firmware that barely fits leaves no room for the next feature.

The build also produces `firmware.bin`, `bootloader.bin` and `partitions.bin` under
`.pio/build/esp32/`. Only `firmware.bin` is used for OTA.

---

## 8. Tests

The repository has a local browser test harness under `tools/ui-tests`. It runs the real embedded
pages against a mock server — no hardware, no device connection.

```bash
cd tools/ui-tests
npm install
npm run test:all
```

It exercises page rendering at three viewports, the language files, the numeric input rules, the
dashboard room label, the scale chart, the scale sampling and correction flow, and the offline log
viewer. Three `pages.spec` overflow assertions are known to fail in the current tree; they are
pre-existing layout issues on the config and gravity pages at small widths, not build errors.

This harness is a development tool. It is not part of the firmware and is not needed to flash a
device.

---

## 9. Troubleshooting the build

| Symptom | Cause | Fix |
|---|---|---|
| `region iram0_0_seg overflowed` | too much code in IRAM | reduce features, or move a table to flash |
| `app partition is too small` / link fails at the end | app slot exhausted | remove a feature, or change the partition table over USB |
| the built pages are the old ones | `EmbeddedFiles.cpp.o` was not rebuilt | delete it, build again |
| `Failed to resolve component` / missing library | PlatformIO cache incomplete | `pio pkg install`, then rebuild |
| Python traceback during upload | wrong COM port | set `upload_port`, or pass `--upload-port` |

More in [Build and feature flags](../reference/11-build-and-flags.md).

---

## Next

- [Flashing](04-flashing.md) — the upload itself, and the recovery route
- [Build and feature flags](../reference/11-build-and-flags.md) — every switch and its default
