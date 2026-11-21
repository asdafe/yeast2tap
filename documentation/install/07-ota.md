# OTA updates

Updating the firmware over Wi-Fi, and what else lives on that second port.

---

## 1. The update page

```
http://<device>:8008/systemupdate
```

Port **8008**, not 80. It is a separate web server from the main interface, and it exists only in
builds with the update server compiled in — which is the default here.

1. Open the URL. The browser asks for the web login (the same user and password as the interface).
2. Choose `firmware.bin` from `.pio/build/esp32/`.
3. Press **Update**.
4. Wait. The page returns `Update Successfull!` and the device restarts after about a second.

**Figure:** [The OTA upload page: one file field and one button] `"YT-111-ota-upload.png"`

---

## 2. Why it is safe

The image is written to the **inactive** app slot. The running firmware is untouched until the new
image is complete and verified, so:

- an interrupted upload leaves you on the old firmware,
- a power cut during the upload leaves you on the old firmware,
- a corrupt image is rejected by the bootloader and the old slot keeps running.

That is the point of the two OTA slots in the partition table, and the reason the app slot is only
1.69 MB: half the space is reserved for exactly this.

---

## 3. What survives, and what does not

| Item | After an OTA update |
|---|---|
| Wi-Fi credentials, hostname, static IP | kept |
| Control constants and settings | kept |
| Device assignments | kept |
| Scale settings, calibration, temperature correction | kept |
| Notes, room label, keg names | kept |
| Brew logs, scale history | kept |
| Beer profiles | kept |
| MQTT and remote-logging configuration | kept |
| The old firmware image | replaced in the *other* slot, which becomes the fallback |

Everything lives in the data partition; only the app slots change. This is why an update is a
low-risk operation.

The exception is a firmware that changes a stored structure. Then the migration rules decide what
happens — see [Persistence](../reference/07-persistence.md). A size change with no migration case is
how a settings set quietly reverts to defaults, so check the release notes for that class of change.

---

## 4. When OTA refuses

| Symptom | Cause |
|---|---|
| `Update Failed:` with a size-related code | the image does not fit the slot — you built a bigger app than the partition allows |
| the upload page 404s | the build has the update server disabled, or you are on the wrong port |
| the connection drops mid-upload | weak Wi-Fi; retry, or move closer |
| the device restarts but runs the old version | the image was rejected; check `system.lastRestartReason` |
| you changed the partition table | OTA cannot do this. Flash over USB. |

A failed OTA never requires a USB recovery, *unless* the firmware you already had was broken. The
old slot keeps booting.

---

## 5. The file manager

Same port, path `/filemanager`: a small web file manager with a tree view and an editor.

Useful for:

- reading `/bpl.cfg` (it is a binary struct, but the header bytes tell you the size),
- deleting a corrupt `/notes.json`,
- inspecting `/scale_daily.log` and `/log/*`,
- freeing space when the filesystem is nearly full.

It is also **completely unauthenticated**, and it can write and delete anything. It is a service
tool for a bench, not something to leave reachable from a shared network.

---

## 6. Filesystem format

```
http://<device>:8008/fsformat
```

This one *does* ask for a login. It formats the data partition and then re-saves the settings that
are currently in RAM, so the device keeps working — but:

- all brew logs are gone,
- `/notes.json` is gone,
- the scale daily history is gone,
- the settings file is rewritten from RAM, so a setting that was never saved is lost.

It is the correct tool when the filesystem is corrupt enough that writes fail: logs will not start,
settings will not persist, or the mount fails at boot.

Do not confuse it with **Init/Erase EEPROM** on the Device Setup page. That one wipes device
assignments and control constants but leaves the filesystem alone; this one wipes files and leaves
device assignments running in RAM.

---

## 7. Recommended update routine

1. Settings → Backup/Restore → **Save**. Keep the file.
2. Note the current version from the header chip.
3. Upload the new image on port 8008.
4. After the restart, confirm the version and check that the dashboard still shows temperatures.
5. Spot-check one thing from each subsystem you rely on (control state, a hydrometer reading, a keg
   weight).
6. If anything regressed, upload the previous `firmware.bin` — the other slot still holds it until
   the next update overwrites it.

---

## Next

- [Security](08-security.md) — including what port 8008 implies
- [Maintenance](../user/12-maintenance.md) — the operational view
- [Recovery](../troubleshooting/06-recovery.md)
