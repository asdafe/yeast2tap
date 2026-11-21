# Sensors and gravity

Temperature readings that look wrong, probes that disappear, hydrometers that stop reporting.

---

## 1. A temperature card shows `--`

In order:

1. **Is the device assigned?** Device Setup → the probe must have a function (Beer Temp, Chamber
   Temp, Room Temp).
2. **Is it detected?** Refresh the list; an unassigned probe appears under "detected".
3. **Is it on the 1-Wire bus?** GPIO 23, all probes in parallel.
4. **Is the wiring intact?** 3.3 V, ground, data, and the 4.7 kΩ pull-up if your board needs one.

Only the beer probe triggers an alarm. A missing fridge or room probe is silent apart from the `--`.

---

## 2. A reading drifts or reads consistently high/low

- **Calibration offset**: every temperature device has one, on its Device Setup card. Use it when a
  probe reads a consistent offset against a reference.
- **Probe placement**: a probe lying against a wall, or in the airflow of the fan, reads something
  other than the beer.
- **Two probes disagree**: compare them in the same glass of water before suspecting the controller.

**Figure:** [A sensor card with the calibration field] `"YT-060-device-card-sensor.png"`

---

## 3. The reading freezes

A frozen value is treated as valid for `staleSensorSec` seconds (20 by default). During that window the
controller keeps controlling on the last known value, then starts idling.

If a card stops updating but keeps a value:

- the probe stopped answering,
- and the staleness window has not expired.

After it expires, the card goes to `--` and control idles.

Raising `staleSensorSec` makes the controller tolerate longer dropouts and also makes it trust stale
data longer. Twenty seconds is a sensible compromise.

---

## 4. Every probe disappeared at once

That is a bus problem, not a probe problem:

- the 3.3 V supply to the bus,
- the common ground,
- a short on the data line,
- or the pull-up resistor.

One DS18B20 with a shorted data pin takes the whole bus down.

---

## 5. The temperature unit is wrong

Settings → Advanced → `tempFormat`. It changes display and input, not stored values.

If only one page looks wrong, that page may be reading a value that was already converted. The
gravity device's temperature, in particular, is converted to the display unit before being shown.

---

## 6. No gravity at all

| Check | Detail |
|---|---|
| device type selected | Hydrometer Setup, not "None" |
| network | an iSpindel pushes over Wi-Fi; no network, no data |
| BLE range | Tilt and Pill are low power; a fridge door is often enough to block them |
| pairing | Tilt by colour, Pill by MAC |
| battery | the dashboard card shows it |
| last update | the timestamp tells you whether it ever arrived |

**Figure:** [The gravity device card with its last-update field] `"YT-018-gravity-device-ispindel.png"`

---

## 7. A hydrometer reports but gravity stays at `--`

The gravity passed through reception but was rejected. The most likely reason is the **range gate**:
values outside SG 0.5–2.0 are discarded silently. That catches a device reading 0.000 or 3.000, and it
also catches a calibration that went badly wrong.

The second candidate is the report shape for an iSpindel: name, temperature, angle, battery and RSSI
must all be present. A partial report is dropped.

---

## 8. Gravity is plausible but wrong

- **Calibration**: too few points, or points measured at different temperatures.
- **Temperature correction**: if it is enabled with coefficients fitted for a different unit
  convention, the error can be large. In this build there is no editor for those coefficients, so
  check whether the correction is enabled at all and consider turning it off.
- **Plato/SG confusion**: a value that looks 1000× too large is a display unit mismatch.
- **Offset**: the gravity offset field is only applied in device-SG mode, not in BPL-calculated mode.

**Figure:** [The shared hydrometer settings] `"YT-071-hydrometer-ispindel.png"`

---

## 9. Manual gravity entry does not work

The dashboard's **SG** dialog sends a payload the firmware rejects, while answering success. The value
never appears.

**Figure:** [The add-gravity dialog] `"YT-017-gravity-card.png"`

Workarounds:

- set the **OG** instead; that path works,
- or post a gravity directly: `GET /sgset?sg=1.014`.

This is documented as a known limitation, not a configuration error.

---

## 10. Attenuation and ABV are blank

They are computed from OG and SG. Without an OG they stay empty.

Enter the OG once per batch. Note that the OG is not reloaded into the live gravity value at boot, so
after a restart the OG tile is empty until you re-enter it or open a log that contains it.

---

## 11. A BLE hydrometer was working and now is not

- **Battery**: Tilt and Pill both die slowly and then report nonsense before stopping.
- **Re-pairing needed**: some Pills change their advertised address after a battery change.
- **Interference**: 2.4 GHz congestion from Wi-Fi or a microwave.
- **Distance**: the BLE stack in this build scans continuously, but the radio is shared with Wi-Fi.

Press **Scan** on Hydrometer Setup to see whether the device is advertising at all.

---

## 12. Which file holds what

| Data | Where |
|---|---|
| calibration points and coefficients | settings file |
| live gravity and device readings | RAM only |
| gravity history | the brew log |
| original gravity | settings file (batch data) and the log |

So a reboot clears the live values but not the calibration.

---

## Next

- [Hydrometers](../user/07-hydrometers.md) — the configuration side
- [Gravity pipeline](../reference/10-gravity-pipeline.md) — the equations
- [Logs and storage](05-logs-and-storage.md) — if the readings are fine but not recorded
