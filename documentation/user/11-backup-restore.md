# Backup and restore

There are **two different backups**, on two different pages, with different contents. Neither is
complete. Knowing which one holds what saves a bad afternoon.

---

## 1. The two backups

| | Settings page | Device Setup page |
|---|---|---|
| Button | Settings → Backup/Restore → Save | Device Setup → Backup |
| File | `bpl.settings.json` | `device.json` |
| Contents | system config, gravity config, remote logging, MQTT, scale settings, parasite control, humidity, beer profile, control constants, control mode and targets, notes, room label, time zone, cap schedule, **device list** | device list, scale settings and calibration |
| Restore | Backup/Restore → restore from file | Device Setup → Restore |

The Settings backup is the broad one. The Device backup is a narrower copy of the hardware
configuration, useful when you only want to move devices between boards.

**The settings backup also contains the device list**, which is why restoring it brings back your
devices as well.

---

## 2. The Settings backup

**Figure:** [The backup dialog, listing every module it will collect] `"YT-053-backup-dialog.png"`

The dialog enumerates what it is about to fetch. A successful run marks each row:

**Figure:** [A completed backup, with every module marked downloaded] `"YT-054-backup-dialog-statuses.png"`

### What it really contains

Yes:

- system configuration (hostname, port, title, display, Wi-Fi mode, network mode, secured-AP flag,
  **static IP**, theme),
- gravity device configuration and calibration,
- remote logging configuration,
- MQTT configuration,
- pressure configuration,
- scale settings (including sampling interval and duration, and the temperature-correction
  coefficients),
- parasite/glycol control settings,
- humidity settings,
- beer profile,
- control constants and the current mode and targets,
- notes, room label and per-keg notes,
- the time zone offset,
- the cap schedule,
- the device list.

No:

- **brew logs** — the binary files are not included,
- **scale daily history** — `/scale_daily.log` is not included,
- **Wi-Fi SSID and password** — never exported, by design,
- **the clock itself** — only the time zone offset is restored,
- the running sampling session, boot counters, or the write-authorisation window.

### The password and DuckDNS token trap

If the page was loaded without an authenticated session, the settings response **omits** the admin
password and the DuckDNS token. The backup then contains neither.

On restore that is safe — a missing key keeps the device's existing value instead of blanking it — but
it means the file is not a complete copy of your configuration. Take the backup while logged in.

### Restore order

Devices are restored first, one at a time with a five-second watchdog, then each module is posted back
through its own endpoint. The system configuration is posted in a mode that does **not** restart the
device mid-restore.

A partial failure is normal and visible: one module can be rejected (an invalid MQTT block, for
example) while the rest succeed. The status list in the dialog marks each row individually —
`Restored` for the ones that took, `Restoration Failed` for the one that did not — so you can see at a
glance which setting needs to be re-entered by hand.

---

## 3. The Device backup

**Figure:** [The restore dialog on Device Setup] `"YT-069-device-restore-dialog.png"`

`device.json` holds:

- the device list — slot, chamber, beer, function, hardware, pin, inverted, deactivated, the 1-Wire
  or BLE address, the PIO channel, the calibration offset, the humidity sensor type,
- the scale settings and per-scale calibration.

It does **not** hold:

- the scale sampling settings (`sampleMinutes`, `sampleHours`),
- the per-keg temperature-correction coefficients,
- notes, profiles, control constants, MQTT, logging, system configuration, time zone, cap schedule,
- any history.

So `device.json` is a hardware-configuration file, not a settings backup. Restoring it onto a fresh
board gives you working devices and calibrated scales, and nothing else.

**Restoring a scale block onto the same device is harmless** for the fields it omits: the firmware
keeps the current value for any key that is absent. Across devices, the omissions become real losses.

### Restore behaviour

- The scale block is restored first, then the devices one by one.
- Each device expects an acknowledgement; a malformed entry does not answer, so the page advances on a
  timeout instead of hanging.
- Devices present on the target but absent from the file are **left in place**. There is no
  "clear first" step, so restoring onto a populated board can leave a mixture.

---

## 4. What neither backup covers

| Item | Where it lives | Back it up by |
|---|---|---|
| Brew logs | `/log/<name>` | download each one from the Logs page |
| Scale daily history | `/scale_daily.log` | Scale → Export data (`scale_daily.json`) |
| The clock | RTC + settings | it re-syncs from NTP |
| Wi-Fi credentials | settings + ESP32 NVS | re-enter after a board swap |
| Firmware | app slots | keep the `firmware.bin` you flashed |

For a board replacement, the complete procedure is: settings backup + `device.json` + the logs and
scale export + re-enter Wi-Fi.

---

## 5. A restore that goes wrong

| Symptom | Cause |
|---|---|
| devices came back but the scale does not | calibration restored, but the keg settings or the correction formula did not travel |
| the scale shows raw counts | the calibration factor was not in the file, or the restore failed |
| the room label reverted | the notes module failed, or the backup was taken before the label existed |
| MQTT is disabled | the MQTT block was rejected |
| the sample interval is back to 2 min | expected — `device.json` does not carry it |
| the IP reverted to DHCP | the backup was taken unauthenticated, or the static-IP keys are absent |

---

## 6. A routine that works

1. Before any firmware update or hardware change: **Settings → Backup/Restore → Save**, logged in.
2. **Device Setup → Backup** as well. It is small and it covers a different set.
3. Download the current brew log if the batch matters.
4. Export the scale data if you have scales.
5. Keep the `firmware.bin` you are running.

That is four files and five minutes, and it covers everything movable.

---

## Next

- [Maintenance](12-maintenance.md) — the operations these backups protect you from
- [Persistence](../reference/07-persistence.md) — file formats and migration rules
