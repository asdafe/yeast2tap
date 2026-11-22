# Build and feature flags

What is compiled in, what is not, and where each switch lives. The build you run decides which parts
of this documentation apply.

---

## 1. Environments

| Environment | Board | Partition table | Notable |
|---|---|---|---|
| **`esp32`** | esp32dev | `partition2.csv` | **the tested build** |
| `esp32-oled` | esp32dev | `partition2.csv` | I²C OLED instead of character LCD |
| `esp32-dev` | esp32dev | `partition2.csv` | serial debug, BTHome on, encoder off, 460800 upload |
| `esp32-spiffs` | esp32dev | `partition.csv` | no second OTA slot |
| `esp32-x`, `esp32-sonoff` | esp32dev | `partition2.csv` | variants |
| `esp8266*`, `d1pro`, `thorrax`, `sonoff*` | ESP8266 | flash layout files | present but not the documented target |

Everything in this documentation describes **`esp32`**.

---

## 2. Feature flags

The defaults come from `Config.h` / `ConfigDefault.h`; the only flag `platformio.ini` adds to
`[env:esp32]` is humidity control.

| Flag | In `esp32` | Effect when on |
|---|---|---|
| `SupportBleHydrometer` | **on** | Tilt + Pill support |
| `SupportTiltHydrometer` | on | Tilt listener |
| `SupportPillHydrometer` | on | Pill listener |
| `SupportBTHomeSensor` | **off** | BTHome and RAPT-as-device; only `esp32-dev` sets it |
| `EnableDHTSensorSupport` | on | DHT11/12/21/22 |
| `EnableBME280Support` | **off** | BME280 |
| `EnableHumidityControlSupport` | on | humidity control, `/rh` |
| `SupportMqttRemoteControl` | on | MQTT both ways |
| `AUTO_CAP` | on | capping actuator and schedule |
| `EanbleParasiteTempControl` (sic) | on | glycol-loop control |
| `SupportPressureTransducer` | on | pressure monitor |
| `TWOFACED_LCD` | on | two-faced display manager |
| `SaveWiFiConfiguration` | on | Wi-Fi credentials in the settings file |
| `UseLittleFS` | on | LittleFS instead of SPIFFS |
| `FS_EEPROM` | on | EEPROM emulated by three files |
| `DEVELOPMENT_OTA` | on | port 8008 update server |
| `DEVELOPMENT_FILEMANAGER` | on | port 8008 file manager |
| `BREWPI_DS2413` | on | 1-Wire PIO actuators |
| `BREWPI_ROTARY_ENCODER` | **on** | encoder on 13/14/18 — **reserves those pins** |
| `BREWPI_BUTTONS` | **off** (on for ESP8266) | two-button local menu instead of an encoder |
| `OLED_LCD` | off | 128×64 I²C OLED instead of a 20×4 character LCD |
| `BREWPI_OLED_SH1106` | off | SH1106 controller instead of SSD1306 (needs `OLED_LCD` too) |
| `MORE_PINS_CONFIGURATION` | on | adds two candidate pins |
| `ENABLE_LOGGING` | on | brew logger |
| `EnableGravitySchedule` | on | profiles |
| `FilterPressureReading` | **off** | pressure smoothing |
| `SerialDebug` | off | serial debug output |
| `BREWPI_DEBUG` | 0 | debug commands (`Z`, `e`) compiled out |
| `NoEmbeddedFile` | off | pages compiled into flash |

### Feature gating that bites

- **BTHome and RAPT device types exist in the interface** but not in the binary. A BTHome sensor cannot
  be installed in this build.
- **`EnableHumidityControlSupport` off also disables DHT and BME support**, and the build fails if
  humidity is on with no sensor type.
- **The rotary encoder reserves GPIO 13, 14, 18.** Those pins come from `rotaryAPin`, `rotaryBPin` and
  `rotarySwitchPin` in `src/Config.h` and can be moved with a build flag; the scale validation blocks
  whatever the build uses. The scale defaults 25/26 and 27/33 are free.

---

## 3. Partition tables

### `partition2.csv` (used)

```
nvs       0x9000   0x5000
otadata   0xe000   0x2000
app0      0x10000  0x1B0000
app1      0x1C0000 0x1B0000
spiffs    0x370000 0x90000
```

- app slots: 1,769,472 bytes each
- data partition: 589,824 bytes, named `spiffs`, formatted LittleFS
- total: 4 MB

### `partition.csv` (not this build)

One app slot of 1,638,400 and a 786,432-byte filesystem. No OTA. Belongs to `esp32-spiffs`.

### `partition-single.csv` (unused)

Referenced by no environment. Do not treat it as an option.

---

## 4. What the build costs

| Metric | Typical |
|---|---|
| static RAM | 66 KB of 320 KB (20 %) |
| flash | 1,746,000 of 1,769,472 bytes (98.7 %) |
| free in the app slot | about 23 KB |
| filesystem | 576 KB |

The flash figure is the one to watch. Every embedded page is gzipped into the image, so a UI change can
cost more than a C++ change.

---

## 5. The page pipeline

```
htmljs/src/*.tmpl.html
   + js/*.js + styles/*.scss + locales/*.json
        │  grunt i18n (+ comboall: inline CSS and JS)
        ▼
htmljs/dist/<lang>/*.htm
        │  embed-headers.js: gzip → C array
        ▼
wdoc/<lang>_*_htm.h
        │  #include via a token-pasting macro
        ▼
src/EmbeddedFiles.cpp → served by the HTTP handler
```

Only four assets stay separate: `/bwf.js`, `/shared.js`, `/num.js`, `/dygraph.min.js`.

Three practical consequences:

1. The firmware serves the `_s` variants of the dashboard and control page; the unsuffixed files are
   identical except for the Dygraph path.
2. `/scale.htm` is always built from the English header, so the Scale page is English in every locale.
3. PlatformIO does not track header dependencies for `EmbeddedFiles.cpp`, so after an embed you must
   delete its object file and rebuild.

---

## 6. Localisation

| Locale | File |
|---|---|
| English | `locales/english.json` |
| Chinese | `chinese.json` |
| Italian | `italian.json` |
| Norwegian | `norwegian.json` |
| Portuguese (BR) | `portuguese-br.json` |
| Slovak | `slovak.json` |
| Spanish | `spanish.json` |
| Turkish | `turkish.json` |

Every page the firmware serves is translatable, including Control Mode and Scale. Not covered:
the offline `y2tlogviewer.htm`, the ESP file manager, and the LCD strings in `src/DisplayLcd.cpp`
(Turkish words do not fit the 20x4 display).

A missing key renders literally as the placeholder text — visible immediately, not silently.
`npm run embed` runs `scripts/check-i18n.js`, which turns a missing key, an unknown key or a raw
marker in a built page into a build error.

### Adding a language

The build language is chosen per environment with `-DWebPageLanguage=<name>`; a page is only
compiled for the languages listed in the generator's `vocabs` list.

1. `node scripts/make-locale.js <new> <html-lang>` copies `english.json` (keys and order) and sets
   `page_lang`. Translate the values. Keys must stay untouched — a renamed key is a missing key.
2. Add `<new>` to the `vocabs` array in `htmljs/gruntfile.coffee`, to the `compress` source list and
   to `languages` in `htmljs/embed-headers.js`.
3. Run `npm run embed` inside `htmljs/`. It syncs the `_s` variants, generates
   `dist/<new>/*.htm.gz`, rewrites every `wdoc/<new>_*_htm.h` and then runs the i18n gate.
4. Add an environment with `-DWebPageLanguage=<new>` to `platformio.ini`, then build.
5. A page that is missing from `wdoc/` fails to link, which is the intended check.

Scale is compiled per language now; it is no longer a shared English page.

---

## 7. Reproducing a binary

```bash
git checkout <tag or commit>
pio run -e esp32
```

Two variables can change the result without a code change:

- `Config.h` edits,
- the locale chosen by `WebPageLanguage`.

Everything else — library versions, platform version, partition table — is pinned in
`platformio.ini`.

---

## 8. Checking what a device actually runs

```
WS  "n"      → N:{"v":"0.2.4","n":<build>,"c":"<name>","s":<board>,"y":<sim>,"b":"<board>","l":<ver>}
GET /getstatus → system.uptime, system.lastRestartReason
GET /config?cfg → firmware size, app slot, running partition
```

The sysinfo dialog shows the same values, plus the build time.

**Figure:** [System information: flash, filesystem, app slot, running partition, build time] `"YT-052-sysinfo-dialog.png"`

Comparing the app slot between two updates tells you whether OTA is alternating slots as expected.

---

## 9. Typical build problems

| Error | Cause |
|---|---|
| `region iram0_0_seg overflowed` | too much code in IRAM; disable a feature |
| `app partition is too small` | the image outgrew the slot |
| `Failed to resolve component` | PlatformIO package cache; reinstall dependencies |
| pages are stale after an embed | `EmbeddedFiles.cpp.o` not rebuilt |
| `undefined reference` to a page symbol | a header was regenerated but not for the build language |

---

## Next

- [Architecture](01-architecture.md)
- [Build from source](../install/03-build-from-source.md)
