# Maintenance

Day-to-day operations: settings, updates, and the destructive buttons.

---

## 1. Settings that matter

**Figure:** [Settings, upper half: display, glycol, DuckDNS, identity] `"YT-047-settings-system.png"`

**Figure:** [Settings, lower half: credentials, network mode, the auxiliary dialogs] `"YT-048-settings-network-security.png"`

| Group | Fields | When to touch |
|---|---|---|
| Identity | page title, hostname, HTTP port | first setup |
| Display | LCD auto-off, display mode | if you have a display |
| Credentials | user, password, "always ask for password" | immediately |
| Network | mode, AP password, SSID, static IP | first setup, or after a move |
| Glycol | the glycol-chilling flag | glycol builds only |
| DuckDNS | domain, token, interval, enabled | remote name resolution |

Some changes need a restart, and the page tells you before it does it: the page dims behind a
"restarting" overlay and reloads itself a few seconds later. An invalid value is refused rather than
corrected — the field is outlined, the dialog stays open and nothing is saved.

---

## 2. Advanced settings

Behind a risk acknowledgement, because these change how the controller behaves physically.

**Figure:** [Advanced settings, upper half: PID and limits] `"YT-055-advanced-settings-top.png"`

**Figure:** [Advanced settings, lower half: timers, filters, sensor behaviour] `"YT-056-advanced-settings-bottom.png"`

Safe to touch:

- **Temperature format** (°C/°F) — a display change.
- **Minimum cool/heat time, minimum idle, dead time** — lengthen them if your compressor complains.
- **Stale sensor seconds** — how long a frozen reading is still trusted.

Risky:

- **Kp, Ki, Kd** — the control loop. Change one at a time, and log the result.
- **Idle ranges** — the on/off bands. Too tight and the compressor short-cycles.
- **Filter coefficients** — they change the noise/delay trade-off everywhere.
- **Estimator target bands** — in PID modes they are overshoot thresholds; in Independent mode they
  are the on/off bands.
- **pidMax** — how far the computed fridge setpoint may deviate from the beer setpoint.

Read [Control algorithm](../reference/05-control-algorithm.md) before changing any of them, and write
down the old values.

---

## 3. Backups

Covered in [Backup and restore](11-backup-restore.md). The short version: two files, two pages, neither
complete.

---

## 4. Firmware updates

Covered in [OTA updates](../install/07-ota.md). The short version: port 8008, settings survive, the
inactive slot protects you from a failed upload.

---

## 5. The destructive buttons

Three different operations, often confused. Read the table before pressing anything.

| Action | Where | Erases | Keeps |
|---|---|---|---|
| **Restart** | `GET /restart`, authenticated | nothing | everything |
| **Erase Wi-Fi setting** | `GET /erasewifisetting`, authenticated | station SSID and password | everything else |
| **Init/Erase EEPROM** | Device Setup, red button | control settings, control constants, **device assignments** | Wi-Fi, system config, scale settings and calibration, MQTT, notes, history, logs |
| **Format filesystem** | port 8008 `/fsformat`, authenticated | **all files**: logs, notes, settings file, scale history | the settings currently in RAM (re-saved immediately) |

The confirmation text for Init/Erase EEPROM is the authoritative list of what goes and what stays: it
spells out both columns before you can confirm, and it is worth reading once before you need it. After
that operation the page is stale — the device list still shows the devices you just deleted — so refresh
it by hand. The filesystem format, by contrast, only returns a one-line confirmation on port 8008; there
is no summary of what was erased there.

---

## 6. Housekeeping

| Task | When | How |
|---|---|---|
| delete old brew logs | when approaching ten, or when space is low | Logs → delete |
| prune scale history | automatic at the retention setting | Scale → history days |
| reset scale history | after a keg change you do not want in the chart | Scale → Reset history |
| clear notes | when the dashboard note is stale | empty the field and save |
| check free space | before starting a log | Logs page shows free/used/total |
| verify the backup restores | once, on a bench | restore to a spare board |

---

## 7. Flash wear

The controller writes to flash more often than a naive design would. Worth knowing:

| What | Frequency |
|---|---|
| settings file (clock save) | once per hour |
| brew log record | once per minute while logging, and flushed immediately by default |
| scale sample | once per sampling interval, per keg |
| scale daily prune | once per day (full file rewrite) |
| control settings | on setpoint changes |

The defaults are reasonable, but two habits help:

- **Enable "write on buffer full"** for long logs. Fewer writes, at the cost of losing the buffer on a
  power cut.
- **Do not leave a sampling session running for weeks.** It is designed for a day or two per
  experiment.

---

## 8. Cleaning up after a batch

1. Download and delete the brew log, if you want to keep it.
2. Scale → Reset history (if the keg changed).
3. Clear the dashboard note.
4. Save a fresh backup, or keep the old one as the "known good" configuration.
5. Optionally take a new OG when the next beer starts.

---

## 9. What to do when you sell or give the device away

1. Settings → Backup, if you want a copy for yourself.
2. Device Setup → **Init/Erase EEPROM**.
3. Port 8008 → `/fsformat` to wipe files (logs, notes, history).
4. `GET /erasewifisetting` so the next owner does not inherit your network.
5. Change the password back to something neutral, or leave the default and tell the new owner to
   change it.

The order matters: format the filesystem *after* the EEPROM init, so the settings that get re-saved
during the format are the sanitised ones.

---

## Next

- [Recovery](../troubleshooting/06-recovery.md) — when a maintenance action did not go as planned
