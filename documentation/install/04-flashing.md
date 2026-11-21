# Flashing

Two ways onto the board: a USB cable, or an over-the-air update from the web interface. The first
one is required once; after that OTA is normally enough.

---

## 1. First flash over USB

```bash
pio run -e esp32 -t upload
```

With the board connected and the port visible. If PlatformIO cannot open the port:

1. Hold **BOOT** (sometimes labelled IO0), tap **RESET**, release BOOT. The board now stays in
   download mode.
2. Upload again.
3. Press RESET once when the upload finishes.

That sequence is also the way out of a firmware that crashes before it can start Wi-Fi.

**What gets written:** the bootloader, the partition table and the application. On a board that was
previously used for something else, this is also the step that replaces a foreign partition layout —
something OTA cannot do.

**What is preserved:** nothing from a previous, different firmware. Your `/bpl.cfg`, the EEPROM files
and any logs live in the filesystem partition, which this step formats if the layout changed.

---

## 2. First boot

After a successful flash the board restarts and, with no saved settings, does this:

1. Starts an access point named after its hostname — `yeast2tap` on a fresh device.
2. The access point is **open** unless an AP password has been set. See
   [Security](08-security.md).
3. Serves the web interface on `192.168.4.1`.
4. Also answers at `http://yeast2tap.local` once mDNS resolves.

Log in with `yeast2tap` / `yeast2tap`, then follow [First run](05-first-run.md).

---

## 3. OTA updates

OTA lives on a **second web server, port 8008**, not on the main interface.

| Item | Value |
|---|---|
| Page | `http://<device>:8008/systemupdate` |
| Upload endpoint | `POST /flash`, multipart field `update` |
| Authentication | the page asks for the web login; **the upload request itself is not checked** |
| On success | `Update Successfull!`, then a restart after about a second |
| On failure | `Update Failed:<error>` — the running firmware keeps working |

The image is written to the inactive slot. If the transfer is interrupted the controller simply
reboots into the old firmware; there is no half-flashed state to recover from.

**What survives an OTA update:** everything in the filesystem — `/bpl.cfg`, the control EEPROM
files, device definitions, notes, brew logs, scale history. The app slots are separate from the data
partition, so settings and calibration are untouched.

**What does not survive:** nothing, unless the new firmware changes a stored struct layout. In that
case the migration rules (see [Persistence](../reference/07-persistence.md)) decide whether your data
is reinterpreted or replaced with defaults.

---

**Figure:** [The OTA upload page on port 8008] `"YT-111-ota-upload.png"`

The page is deliberately minimal: one file selector and one button. It is a separate, synchronous
web server from the main interface, which is why the port number differs.

---

## 4. The file manager on the same port

Port 8008 also hosts a small file manager at `/filemanager`, plus direct endpoints for listing,
reading, writing and deleting files. It is the last-resort repair tool: you can inspect
`/bpl.cfg`, delete a corrupt `/notes.json`, or replace a log.

Treat it as a service tool, not a feature:

- It has **no authentication** on any of its endpoints.
- It can overwrite or delete anything, including the settings file.
- One of its endpoints, `/fsformat`, wipes the filesystem (that one does ask for a login).

Do not expose port 8008 to a network you do not control.

---

## 5. Recovering a board that will not start

In order of escalation:

1. **`GET /restart`** (authenticated) — a clean reboot when the web server still answers.
2. **`GET /erasewifisetting`** (authenticated) — clears the stored station credentials so the device
   falls back to its access point.
3. **Join the fallback access point** and use the Settings page, or `POST /wificon` directly
   (unauthenticated) to point it at the right network.
4. **`/fsformat` on port 8008** — wipes the filesystem when it is corrupt enough that logging or
   settings writes fail. Settings in RAM are re-saved afterwards, but logs and notes are gone.
5. **USB flash** — always works, and is the only path that can change the partition layout.

A common half-broken state is worth knowing: the filesystem mount fails, the firmware silently
formats it, and the settings file is then missing. The controller starts with defaults, keeps
serving the interface (pages are embedded in the firmware), and loses your configuration. If that
happens after a power cut, it is the non-atomic settings write, not a hardware fault.

---

## 6. Verifying an update

Three independent ways:

- The version chip in the page header changes.
- `GET /getstatus` reports `system.uptime` near zero and `system.lastRestartReason` `software`.
- The Settings → Sysinfo dialog shows the build time and the running partition. Alternating between
  `app0` and `app1` across updates confirms OTA is working as intended.

**Figure:** [System information: flash, filesystem, app slot and running partition] `"YT-052-sysinfo-dialog.png"`

---

## 7. Changing the partition layout

The flash is divided by `partition2.csv` (see [Build and flags](../reference/11-build-and-flags.md)).
Switching to a different table — for example to give the filesystem more room, or to fit a larger
image — cannot be done over OTA:

- **The board must be flashed over USB.** OTA writes into an existing app slot and has no way to
  rewrite the partition table under itself.
- **The filesystem is reformatted**, so every log, the saved notes and the scale history are lost.
  A fixed offset that used to hold the filesystem now holds something else, and the table change
  invalidates the contents.

Take a settings backup and download the logs you want to keep *before* changing the table.

---

## Next

- [First run](05-first-run.md)
- [OTA updates](07-ota.md) in the installation guide — the operational detail
- [Recovery](../troubleshooting/06-recovery.md) — what to do when nothing answers
