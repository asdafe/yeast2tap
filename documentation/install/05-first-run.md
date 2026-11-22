# First run

From a blank device to a controller that actually holds a temperature. Budget twenty minutes.

---

## 1. Reach the interface

A fresh device is in access-point mode.

1. On a phone or laptop, join the Wi-Fi network named **`yeast2tap`**.
2. It is open by default — see [Security](08-security.md) if that worries you, and set an AP
   password before you leave the bench.
3. Open `http://192.168.4.1`. `http://yeast2tap.local` also works on most systems.
4. Log in: user **`yeast2tap`**, password **`yeast2tap`**.

The interface loads even with nothing configured; the cards show placeholders. Pages are compiled
into the firmware, so the UI works before the filesystem has anything in it.

---

## 2. Change the password first

Settings → the password field. The default credentials are the same on every device, and the
interface (and the OTA upload) are reachable by anyone who can route to it.

While you are there, decide about the access point:

- **Enable AP password** turns the fallback access point into a protected one. It needs at least
  eight characters; shorter passwords silently produce an open network.
- If you leave it off, the device will start an open AP whenever it cannot join your Wi-Fi.

**Figure:** [Settings, lower half: credentials, network mode and the auxiliary dialogs] `"YT-048-settings-network-security.png"`

---

## 3. Join your network

Settings → **Network** button.

1. Wait for the scan.
2. Pick your network, type the password.
3. Save. The device restarts into station mode.

**Figure:** [The network dialog with scan results] `"YT-050-network-dialog.png"`

If you want a fixed address, fill in IP / gateway / netmask / DNS in the same dialog. Leaving them
empty means DHCP.

**Figure:** [Static IP fields in the network dialog] `"YT-051-network-static-ip.png"`

After the restart, the device is at `http://<hostname>.local` or at the address your router gave it.
The hostname is set on the same Settings page; it is used for mDNS and for the access point name,
not as a DHCP hostname.

---

## 4. Assign the hardware

Device Setup. This is the page that decides what the firmware controls.

1. Press **Refresh device list**. The controller enumerates its pins and scans the 1-Wire bus.
2. Every DS18B20 appears under "detected" with its address; every candidate actuator pin appears
   too.
3. For each part: pick a **Function** (Beer Temp, Chamber Temp, Chamber Heater, Chamber Cooler…),
   pick the slot, set inverted/not inverted for outputs.
4. Press **Apply** on the card.

**Figure:** [The Device Setup page with a heater, a cooler and three probes assigned] `"YT-058-device-setup-full.png"`

A device card in detail:

**Figure:** [An actuator card: function, slot, pin, polarity] `"YT-059-device-card-actuator.png"`

**Figure:** [A 1-Wire sensor card: function, address, calibration, live value] `"YT-060-device-card-sensor.png"`

The two things people get wrong here:

- **The polarity switch.** If the relay clicks when it should not, flip inverted/not inverted rather
  than rewiring.
- **The pin warnings.** A warning chip is not decoration. See
  [Wiring and pins](02-wiring-and-pins.md).

---

## 5. Get a valid reading

Open the Dashboard. The Beer, Fridge and Room cards should show numbers, not `--`.

If a card stays at `--`:

- the function is not assigned to that probe,
- the probe is not on the 1-Wire bus,
- or the address was assigned to the wrong slot.

---

## 6. Set a target and enable control

Control Mode.

1. **Control method**: PID.
2. **Controlled variable**: Beer.
3. **Setpoint source**: Fixed.
4. Type the target temperature, e.g. `18.00`.
5. Turn **Control enabled** on.
6. Press **Apply**.

**Figure:** [PID control, beer, fixed setpoint — the normal starting point] `"YT-023-control-pid-beer-fixed.png"`

The one-line summary at the top of the page restates what you have selected; it is the quickest way
to confirm that Apply took effect.

**Control is off until you press Apply.** Flipping the switch alone does nothing — this is
deliberate, so a mis-click cannot start a compressor.

**Figure:** [The Apply footer with the control switch] `"YT-032-control-disabled.png"`

---

## 7. Confirm it is actually controlling

Watch the Status card. Within a minute or two it should leave "Idling" and show Heating or Cooling,
and the corresponding relay should click.

**Figure:** [The status card in three states: cooling, heating, idling] `"YT-010-status-states.png"`

If it stays Idling:

- the setpoint is already satisfied (normal),
- the dead time is still running after a previous cycle (up to ten minutes by default),
- or an actuator is not assigned.

See [Control problems](../troubleshooting/02-control-problems.md).

---

## 8. Optional, in the order people usually want them

| Want | Page |
|---|---|
| A brewing schedule instead of a fixed temperature | [Profiles and ramps](../user/04-profiles-and-ramps.md) |
| A hydrometer feeding gravity | [Hydrometers](../user/07-hydrometers.md) |
| Keg level and consumption | [Keg scales](../user/08-keg-scales.md) |
| Pressure or spunding | [Pressure, capping and humidity](../user/09-pressure-capping-humidity.md) |
| Brew logs and remote upload | [Logging](../user/10-logging-and-remote.md) |

---

## 9. Back up before you continue

Settings → **Backup/Restore** → **Save**. You get a `bpl.settings.json` with the system config,
gravity settings, MQTT, scale settings, control constants and mode/targets, the beer profile, notes,
the time zone and the cap schedule.

**Figure:** [The backup dialog, listing every module it will collect] `"YT-053-backup-dialog.png"`

Device Setup → **Backup** gives you a second file, `device.json`, with the device assignments and
the scale settings. The two files overlap but neither contains everything; see
[Backup and restore](../user/11-backup-restore.md).

---

## Next

- [Network](06-network.md) — station, AP, static IP in depth
- [Control modes](../user/03-control-modes.md) — choosing the right one
- [Security](08-security.md) — before you expose the device to anything
