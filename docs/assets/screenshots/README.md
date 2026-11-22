# Screenshots

Captured from a live controller on a private LAN (ESP32 WROOM 4 MB, firmware `0.2.4`, mode
Independent). The device address is not published; the figures show the interface, not the network. **95 of the 132 planned figures are here**; the remaining 37 could not be taken on
this device and are listed at the bottom with the reason.

The manuals reference the 95 files that exist. The 37 that could not be captured are **described in
words** at the place where they would have appeared — a reader still learns what the screen looks like,
and no reference points at a missing file.

If you ever capture one of them, add the file here and re-add its `**Figure:**` line where the
description now sits; the identifier in the table below is what locates it.

## Capture conditions

| | |
|---|---|
| Desktop | 1440 × 900 |
| Mobile | 390 × 844 |
| Theme | default Yeast2Tap (only `YT-002` shows another) |
| Format | PNG |
| Demo state | Independent mode, beer set 22 °C, beer 21.9 °C, two keg scales (SOL / SAĞ), iSpindel-style gravity device |

## Masking

Personal data was blurred **client-side before capture**. Blurred in every settings or logging image:

- DuckDNS address and token
- admin user name and password
- Wi-Fi SSID (including the badge button, not just the input)
- MQTT broker address, user and password
- remote-logging URLs, ThingSpeak key, Ubidots token, Brewers Friend key
- dashboard note and keg notes
- static IP fields

Title, hostname and HTTP port are deliberately **left readable** — they are documentation-relevant and
not personal.

## What was never done to the device

Every capture was navigation plus read-only GETs. No Apply, no Save, no calibration, no BLE scan, no
erase, no filesystem format, no log start or stop, no reboot.

Two destructive confirmations were **opened and dismissed** with the browser dialog's Cancel button, so
the command was never sent: the EEPROM init on Device Setup and the device remove button.

The only dialog that was actually confirmed is the Settings backup, which issues nothing but GET
requests.

Verified afterwards: uptime monotonic across the whole session (28 169 → 33 340 s), `resetCount` still
1, `minFree` never dropped below its baseline, both keg scales still configured, the brew log still
recording under the same name, control mode and setpoints unchanged.

---

## Figures that could not be taken on this device

Each of these needs something the bench controller does not have, or needs a state it must not be put
into.

### Required by the guide, still missing (4)

| Figure | Why | How to get it |
|---|---|---|
| `YT-035-capping-gravity.png` | no capping actuator is assigned, so the capping card stays hidden | assign a `Beer Capper` actuator, then Control Mode → Advanced controls → Gravity tab |
| `YT-067-eeprom-erase-confirm.png` | the confirmation is a **browser** dialog, which a screenshot of the page cannot contain | press Init/Erase EEPROM and capture the screen with the OS screenshot tool |
| `YT-096-pressure-cal-step2.png` | step 2 needs a real known pressure applied to the transducer | with a regulated air supply, complete step 1 then capture step 2 |
| `YT-099-scale-calibrating.png` | it requires running a calibration, which **writes** the factor | put a known mass on a keg scale, press Calculate factor, capture during averaging |

### Optional figures, missing (33)

| Group | Figures | Why |
|---|---|---|
| Hydrometer device cards | YT-019, YT-020 | only an iSpindel-style device is present; Tilt and Pill cards need that hardware |
| Failure states | YT-116, YT-117, YT-118 | they need an unsynced clock, a disconnected HX711, or a removed probe — deliberately not created on a running fermenter |
| Destructive confirmations | YT-068, YT-070, YT-112, YT-114 | browser dialogs or the result of a destructive action; OS screenshot needed |
| Erase/format results | YT-113 | the file manager was not opened on this device on purpose |
| Form validation errors | YT-119, YT-120, YT-122 | producing them means pressing Save/Save scales with a bad value, which would write to the device |
| Scale states | YT-100 | needs a completed calibration |
| Logging states | YT-081, YT-089, YT-093 | a log is already recording, so the start form is not rendered; the notation popup is hover-only; the full-disk error needs a full filesystem |
| Profiles | YT-040, YT-041, YT-043, YT-044 | they need a profile being applied, an OG reset, or a save-as — all write paths |
| Capping tabs | YT-036, YT-037 | same missing actuator as YT-035 |
| Glycol card | YT-045 | no PTC cooler is configured |
| Device cards | YT-061, YT-066 | no user-added pin device exists to warn about or remove |
| Misc | YT-007, YT-008, YT-015, YT-016, YT-057, YT-074 | they need a login prompt, a refused write, an empty keg card, a registration of a BLE scan, or a restart |

If you capture any of them, keep the file name and drop the file in this folder — the manuals pick it
up automatically.
