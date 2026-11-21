# Recovery

When the device will not start, will not keep settings, or will not answer. Escalate in the order
below — each step is more destructive than the last.

---

## 1. The escalation ladder

| Step | Action | Destroys |
|---|---|---|
| 1 | `GET /restart` (logged in) | nothing |
| 2 | reload the page / rejoin the AP | nothing |
| 3 | `GET /erasewifisetting` (logged in) | saved Wi-Fi credentials |
| 4 | Device Setup → Init/Erase EEPROM | control constants, settings, device assignments |
| 5 | port 8008 → `/fsformat` | all files: logs, notes, settings file |
| 6 | flash over USB | everything on the board |

Stop as soon as it works.

---

## 2. It does not boot

Symptoms: no access point, no response, the serial console shows a boot loop.

1. **Hold BOOT, tap RESET, release BOOT** to force download mode, then flash over USB.
2. If it still loops, the cause is usually:
   - a relay or sensor holding a boot-strapping pin at the wrong level — disconnect the peripherals
     and retry,
   - a firmware that crashes on start — flash the previous `firmware.bin`,
   - a hardware fault.

Disconnecting everything except power and USB is the fastest diagnostic: if it boots alone, something
on a pin is the problem.

---

## 3. It boots but the interface does not answer

- Check the access point appears. If it does, the station connection failed — the Wi-Fi credentials
  are wrong or the network is gone.
- If the AP does not appear either, the web server failed to start. Port 8008 might still work; try
  it, because it is a separate server.
- If neither answers, reflash over USB.

---

## 4. It boots with default settings

Classic symptom: hostname back to `yeast2tap`, password back to default, no devices, no profile.

Cause: a truncated or unreadable settings file. The loader falls back to defaults and writes them.

What survives: scale settings sometimes, because they have their own size-migration path; the scale
daily file; the brew logs.

What to do:

1. Restore the Settings backup, if you have one.
2. Restore `device.json` for the hardware.
3. Re-enter the password, network and MQTT settings — those may not be in an unauthenticated backup.

If this happens twice, suspect the filesystem rather than bad luck: format it (step 5) and restore.

---

## 5. Settings will not save at all

Symptoms: every change reverts on reload or reboot.

1. Settings → Sysinfo: is there free space?
2. Delete logs to make room.
3. Format the filesystem on port 8008, then re-enter the configuration.

A filesystem that mounts read-only or fails midway produces exactly this.

---

## 6. Logs will not start, or notes will not save

Same cause, milder. The filesystem is full or partially corrupt. Delete logs, then format if needed.

---

## 7. The device is unreachable and the AP is not there

The AP is not created when the station connection succeeds, so:

- the device might be on your network with a new address — check the router,
- or it is in AP mode with a name you changed — try the hostname you set,
- or it is not running.

A network scan from a phone finds any access point quickly.

---

## 8. After a failed OTA

Should be impossible: the inactive slot is untouched. If the device does not come back:

1. Power-cycle. The bootloader falls back to the slot that worked.
2. If it does not, flash over USB.

Check `system.lastRestartReason` in `/getstatus` after recovery; `panic`, `int_wdt` or `brownout` point
at specific classes of failure.

---

## 9. What the boot reason tells you

| Value | Meaning |
|---|---|
| `power_on` | normal power-up; the reset counter restarts |
| `software` | a commanded restart |
| `panic` | a firmware crash |
| `int_wdt` / `task_wdt` / `wdt` | a watchdog fired — a blocking loop |
| `brownout` | the supply dropped; check the power supply |
| `deep_sleep` | not used by this firmware |
| `sdio` | unusual for this build |

`brownout` is worth acting on: a relay coil and an ESP32 on a marginal supply is a classic cause of
random restarts that look like software faults.

---

## 10. Preserving what you can

Before any destructive step:

1. Settings → Backup/Restore → Save (if the interface answers at all).
2. Download the brew logs you care about.
3. Scale → Export data.
4. Note the configuration by hand if the backup seems incomplete — screen photographs of the Settings
   and Device pages are enough.

A device that is about to be formatted is a device whose settings you may not get back.

---

## 11. If you replaced the board

1. Flash the firmware.
2. Join the AP, log in.
3. Restore the Settings backup — this includes the device list and the scale settings.
4. Restore `device.json` if the settings restore did not bring the devices back.
5. Re-enter the Wi-Fi credentials (never in a backup).
6. Re-enter the MQTT password and the DuckDNS token if the backup was taken unauthenticated.
7. Re-check the scale calibration — it should have come with the settings, but verify with a known
   weight.
8. Re-check the hydrometer pairing: a Tilt pairs by colour so it reconnects, a Pill pairs by MAC so it
   should too, an iSpindel needs the new IP or hostname in its own configuration.

---

## 12. When to stop troubleshooting

If two of these are true, the fastest path is a USB reflash plus a restore rather than more diagnosis:

- the interface answers inconsistently,
- settings do not persist,
- the boot reason repeats,
- the free space is fine but writes fail,
- a restart fixes it for a few minutes.

A reflash takes two minutes and eliminates the software as a variable.

---

## Next

- [Web and network](01-web-and-network.md)
- [Logs and storage](05-logs-and-storage.md)
- [Diagnostics](../reference/12-diagnostics.md) — the fields that tell you what happened
