# Persistence

Five files, three different write patterns, and two unrelated migration schemes. This page is what you
need when data survives — or does not.

---

## 1. The files

| Path | Contents | Format |
|---|---|---|
| `/bpl.cfg` | the whole `Settings` struct | raw binary |
| `/eeprom_control_setting` | mode, setpoints, learned estimators | raw binary |
| `/eeprom_control_constant` | PID, bands, filters, timers, units | raw binary |
| `/eeprom_device_definition` | 16 device slots | raw binary |
| `/notes.json` | dashboard note, room label, keg notes | JSON |
| `/log/<name>` | brew logs | binary, versioned |
| `/scale_daily.log` | daily and sample records | 26-byte records |

Plus transient files: `/scale_daily.tmp`, `/scale_daily.bak`, and legacy `/scale.log`, `/scale.tmp`,
`/scale.bak` which are deleted at boot.

### Which copy of a web page is served

Pages are looked up in the filesystem first and only fall back to the copy embedded in the firmware.
For `http://<device>/index.htm` the order is:

1. `index.htm.gz` in the filesystem
2. `index.htm` in the filesystem
3. `index.htm` embedded in the firmware image

That is what makes it possible to replace a page by uploading a file through the file manager
(`:8008/filemanager`) without rebuilding the firmware: the uploaded copy wins. Two consequences:

- **A stale uploaded page survives a firmware update.** If a page looks wrong after an update, check
  the filesystem for an old copy before assuming the build is broken.
- **JavaScript files have a third alias.** A request for `x.js` is answered from `x.jgz` when that
  exists (a Safari workaround); it is served with `Content-Encoding: gzip`.

Deleting the filesystem copy restores the embedded page.

---

## 2. `/bpl.cfg`

### What it holds

One `Settings` struct, in memory order:

- system configuration (identity, network, credentials, DuckDNS, theme, display),
- time information (time zone, saved clock),
- gravity configuration (device type, calibration points, coefficients, offset, filter),
- beer profile,
- brew log index (up to ten entries),
- remote logging configuration,
- auto-cap settings,
- parasite (glycol) control settings,
- MQTT configuration,
- Wi-Fi credentials,
- BLE hydrometer pairing,
- humidity settings,
- **scale settings**, including the temperature-correction coefficients.

### How it is written

```cpp
File f = FileSystem.open("/bpl.cfg", "w");   // truncates immediately
f.write((uint8_t*)&theSettings, sizeof(Settings));
f.close();
```

**Not atomic.** A power cut after the truncate and before the write completes leaves a short or empty
file. The loader then either matches a known smaller size (and migrates) or falls back to defaults.

There is no magic number, no version field, no checksum. Detection relies entirely on file size.

### Migration

Each historical layout has a case, expressed as an `offsetof`-derived size:

| Case | What it means |
|---|---|
| `kegBuildSize` | before the DuckDNS fields existed |
| `preLimitSize` | before per-scale calibration limits |
| `preDailySize` | before the daily measurement time |
| `twoScaleSize` | before the six extra scale slots |
| `preSampleSize` | before the sampling fields and temperature correction |

A stored file smaller than the current struct is read into the beginning of the struct, and the missing
tail is filled from defaults. Fields are append-only, which is what makes this work.

**An unknown smaller size falls through to the scale defaults** — and that is the failure mode to
remember: a settings file from a build you do not have can quietly reset your scale configuration.

### When it is saved

- once per hour, for the clock,
- on any accepted configuration write,
- when a profile step advances or latches,
- when a log starts, stops or is deleted,
- on gravity calibration and on Wi-Fi connect.

That is frequent enough that power-cut corruption is a real, if uncommon, event.

---

## 3. The EEPROM files

Originally a byte array on an Arduino. On ESP32 it is three files.

### Constants

`/eeprom_control_constant` has a **size-based migration chain**: v9 → v8 → v7 → v5 → v1, each with a
copy of the historical struct and a converter. An unrecognised size produces zeroed constants, which
the loader then rejects (no valid unit, min ≥ max, implausible filter) and replaces with defaults.

### Settings

`/eeprom_control_setting` has **no migration at all**. A short read simply leaves the tail at whatever
was in the buffer. If a future build changes this struct, expect settings corruption rather than a
clean default.

### Devices

`/eeprom_device_definition` is an array of 16 fixed-size device records. It is rewritten whole on any
device change.

### The version byte

There is a format version constant in the source, and a byte for it in the classic layout. On the
filesystem-backed path **the version byte is never written and never checked**; only file existence
matters. So the "version 10" you may read about is not what governs your device.

---

## 4. `/notes.json`

```json
{ "dash": "dry hopped", "room": "Ferm. Chamber", "keg": { "0": "Pale ale" } }
```

- `dash` up to 1000 characters,
- `room` up to 24 characters,
- `keg` up to 8 entries, each up to 1000 characters.

Written whole on every note save. Deleted when the last field is cleared.

---

## 5. Brew logs

Binary, versioned in the header nibble. Structure:

```
header   : magic, version+flags, period, start epoch, gravity device block, optional tilt correction
records  : tag + payload, only when something changed
```

| Tag | Contents |
|---|---|
| period | temperatures, setpoints, gravity, pressure, humidity |
| state | controller state |
| mode | control mode |
| target psi | capping pressure target |
| original gravity | OG as written |
| specific gravity | gravity sample |
| calibration | calibration point |
| time sync | clock jump |
| resume | restart marker |
| fill | padding |

Temperature values are hundredths with a negative offset; invalid is a sentinel. Gravity is ten
thousandths for SG, hundredths for Plato.

Writing is append-only. Interruption loses at most the last record.

---

## 6. Scale history

26-byte packed records:

```
day             uint32
time            uint32 (UTC epoch)
levelGrams      int32
consumedGrams   int32
scaleId         uint8
flags           uint8    provisional 1, keg change 2, unstable 4, no keg 8, reset 16, sample 32
version         uint8
reserved        uint8
rawCounts       int32    (INT32_MIN = unknown)
temperatureDeciC int16   (INT16_MIN = unknown)
```

The 20-byte legacy format is detected by a zero version byte and migrated transactionally.

**This is the only file with an atomic rewrite**: write `.tmp`, rename the original to `.bak`, rename
`.tmp` into place, roll back on failure, delete `.bak`. It is used by the prune, the migration and the
sample-clear operations.

Appends are not atomic, but an interrupted append damages only the last record, which the readers skip
because it fails the size check.

---

## 7. What is *not* persisted

| State | Where it lives | Consequence |
|---|---|---|
| current gravity, device readings | RAM | empty after a reboot until the device reports |
| scale runtime (weight, state, retries) | RAM | recomputed |
| sampling session (active, end time) | RAM | reboot ends the session, samples stay |
| heater pulse PI state (duty, learned pulse, peak) | RAM | relearns from cycle one |
| WebSocket write window | RAM | clients re-authenticate |
| boot counter and reset reason | RTC memory | survives a reset, not a power cycle |
| MQTT connection state | RAM | reconnects |
| volatile brew-log ring | RAM | the last hours, if no log was running |
| original gravity in the live pipeline | RAM | the OG tile is empty after a reboot |

That last one is worth repeating because it looks like data loss: the OG **is** stored with the batch
data and **is** in the log, but nothing reloads it into the gravity value at boot.

---

## 8. Flash wear

| Target | Frequency | Notes |
|---|---|---|
| `/bpl.cfg` clock | 1/hour | whole file each time |
| `/bpl.cfg` config | per accepted write | |
| `/log/<name>` | 1/minute while logging | flushed immediately unless buffered |
| `/scale_daily.log` | 1/day per keg | plus 1 per sample during a session |
| `/scale_daily.log` prune | 1/day | whole-file rewrite |
| `/eeprom_control_setting` | on setpoint change | beer setpoint only above a 0.25 °C delta |
| `/eeprom_device_definition` | on device change | |
| `/notes.json` | per note save | |

The aggressive cases are a buffered-off log (1440 writes a day) and a sampling session at a one-minute
interval (1440 appends a day per keg).

---

## 9. Corruption scenarios

| Scenario | What happens |
|---|---|
| power cut during `/bpl.cfg` write | truncated file → size mismatch → defaults, or migration |
| power cut during a log append | last record lost, file still readable |
| power cut during a scale prune | `.bak` restored at boot |
| filesystem mount failure | **formatted automatically**, settings then re-defaulted |
| filesystem full | writes fail silently; settings do not persist |
| struct changed without a migration case | tail silently defaults |

The first and the fourth are the ones that produce "everything was fine and now it is not".

---

## 10. Checking a device's storage

`GET /getstatus` reports:

```json
"storage": { "totalBytes": 589824, "usedBytes": 120000, "freeBytes": 469824 }
```

`totalBytes` should be 589,824 on the standard partition table. A different number means a different
partition table, and the documentation's size claims do not apply.

---

## Next

- [Backup and restore](../user/11-backup-restore.md) — the user-facing view
- [Recovery](../troubleshooting/06-recovery.md) — when a file is damaged
- [Diagnostics](12-diagnostics.md) — the fields that reveal corruption
