# Hydrometers

Three wireless hydrometers are supported, plus manual entry. Each reports a gravity that the
controller can log, chart, use in profile conditions, and use for capping decisions.

---

## 1. The three device types

| Type | Transport | Reports | Pairing |
|---|---|---|---|
| **iSpindel** (and GravityMon) | Wi-Fi, HTTP POST to the controller | angle, temperature, battery, RSSI, optional gravity | points at the controller's address |
| **Tilt** | Bluetooth LE | specific gravity, temperature (converted from °F), battery % | paired by colour |
| **RAPT Pill** | Bluetooth LE | specific gravity, temperature, acceleration, battery % | paired by MAC address |

Only one hydrometer type can be active at a time. Switching types reconfigures the pipeline.

**Figure:** [Hydrometer Setup with no device selected — the factory state] `"YT-077-hydrometer-none.png"`

With no device selected the panes are empty and only the shared settings remain. That is what a device
looks like before any hydrometer is configured, and it is also the state a gravity-conditioned profile
will be in if you forget to pair one.

**Figure:** [Hydrometer Setup with iSpindel selected] `"YT-071-hydrometer-ispindel.png"`

**Figure:** [The same page with Tilt selected] `"YT-072-hydrometer-tilt.png"`

**Figure:** [The same page with RAPT Pill selected] `"YT-073-hydrometer-pill.png"`

---

## 2. iSpindel

An iSpindel pushes to `http://<controller>/gravity` on its own schedule. On the controller side there
is nothing to pair; you only need:

1. The same Wi-Fi network name and password the controller uses.
2. The controller's address in the iSpindel's configuration.

The controller replies immediately and processes the report afterwards, so a slow parse never
delays the sensor.

**What the report must contain:** the device name, temperature, angle, battery and RSSI. A report
missing any of them is discarded. That strictness is why a "manual gravity" post from another tool
can be accepted with a 200 and still do nothing.

**Figure:** [The iSpindel card on the dashboard] `"YT-018-gravity-device-ispindel.png"`

---

## 3. Tilt

1. Select **Tilt** as the device type.
2. Pick the colour of your Tilt.
3. Optionally press **Scan** to see which Tilts are advertising nearby.

Scan opens a table of everything the controller can hear — one row per device with its gravity,
temperature and signal strength, and a **Done** button to take the one you selected. It is a read-only
convenience: picking a colour by hand does the same job.

Tilt reports specific gravity directly, so the calibration curve is an offset rather than a
polynomial: one point is enough, and no points means "trust the device".

Its temperature arrives in Fahrenheit and is converted on receipt.

---

## 4. RAPT Pill

1. Select **RAPT Pill**.
2. Enter the MAC address, or press **Scan** and pick the device.

The same scan table is used here; the row you pick fills the MAC field.

The Pill reports gravity, temperature, acceleration and battery state of charge. The controller
derives the tilt angle from the acceleration, compensating for the Pill's axis orientation.

**Figure:** [Hydrometer Setup on a phone] `"YT-078-hydrometer-mobile.png"`

Pairing from a phone is the normal case — you are usually standing at the fermenter with the hydrometer
in your hand.

---

## 5. Calibration

Calibration is a two-column exercise: for a handful of real samples you enter what the device
reported and what the true gravity was. The controller (well, your browser) fits a curve through the
points.

**Figure:** [The calibration point dialog with two entered pairs] `"YT-075-gravity-calibration-dialog.png"`

1. Hydrometer Setup → **Calibration**.
2. For each sample: type the raw value (angle for iSpindel/Pill, SG for Tilt) and the true gravity
   measured with a hydrometer or a refractometer.
3. **Add**. Up to ten points.
4. **OK** when done. The fit is computed and the coefficients appear.
5. **Save** to store them.

**Figure:** [The setup page after a successful fit] `"YT-076-gravity-calibration-result.png"`

Three points is the practical minimum for a curve; two gives you a straight line; one gives an
offset. With no points the device's own value is used unchanged.

**Where the mathematics runs matters** for troubleshooting: the fit happens in the **browser**, and
only the resulting four coefficients are stored on the controller. If the page's script fails to load,
calibration cannot be performed even though the controller is healthy. The firmware contains a
regression routine, but it is not called.

---

## 6. The shared settings
| Setting | What it does |
|---|---|
| **Use Plato** | displays and stores gravity as °Plato instead of SG |
| **Gravity offset** | a constant added to the device's SG (only in device-SG mode) |
| **Calculated by BPL** | the controller applies the polynomial to the raw angle instead of trusting the device's gravity |
| **Temperature correction** | enables the correction polynomial |
| **Low-pass filter coefficient** | smoothing, 0.1 default, 0.15 for Tilt and Pill |
| **Stability threshold** | the default window used by profile steps that test stability |
| **Save** | stores the whole gravity configuration |

### "Calculated by BPL" explained

- **On**: the controller takes the raw angle (or Tilt's raw SG) and applies the stored polynomial to
  produce gravity. The device's own gravity field is ignored.
- **Off**: the controller trusts the gravity the device reports, adds the offset, and applies the
  temperature correction if enabled.

Use "on" when you have calibrated against your own hydrometer. Use "off" for GravityMon-style devices
that already compute a good gravity themselves.

### Plato

Stored values are always SG internally for the control paths; Plato is a display and input
convention. Switching it changes what you see and what you type, not what the controller compares.

---

## 7. Temperature correction of gravity

Fermentation gravity readings drift with temperature. The controller can apply a polynomial
correction, but in this build **there is no editor for those coefficients** — the field that looks
like it should hold them is never filled, and it is not saved.

**Figure:** [The temperature-correction controls and the inert formula label] `"YT-079-gravity-known-issue.png"`

What you can do today:

- Leave temperature correction off, and rely on the device's own compensation if it has one.
- Use the offline log viewer to fit a correction against the beer temperature and read the formula —
  the viewer can compute it, but the controller has no place to paste it back for gravity.

(The Scale page *does* accept a pasted formula; the gravity page does not. They are separate
mechanisms.)

---

## 8. Manual gravity

Two entries, different behaviour:

| Entry | Where | Status |
|---|---|---|
| **Original gravity** | Dashboard → click OG | works |
| **Current gravity** | Dashboard → click SG | **does not reach the controller** in this build |

The manual SG dialog sends a payload the gravity handler rejects, while the request has already been
answered with success. So the number never appears. Until that is fixed:

- set the OG by hand, and let a real hydrometer supply the current gravity, or
- post a gravity directly with `GET /sgset?sg=1.014`.

`/sgset` is not reachable from any page; it is an API call, documented in
[HTTP API](../reference/02-http-api.md).

---

## 9. The OLED hydrometer screen

On an OLED build (`OLED_LCD`, which also switches `ISPINDEL_DISPLAY` on) one of the display screens is
dedicated to the hydrometer rather than to the controller. It uses labelled icons and fields:

| Field | Meaning |
|---|---|
| SG | the gravity as received |
| temperature | the hydrometer's own temperature, in the display unit |
| battery | battery voltage, with a `V` label |
| tilt | the raw tilt value or angle the device reports |
| `Last seen` … `ago` | how long since the last report |
| `IP` | the controller's own address |
| two signal bars | the controller's Wi-Fi strength, then the hydrometer's |

The screen refreshes once a minute. A hydrometer that stops reporting leaves its last values on
display with a growing "last seen" time — that number, not the gravity, is what tells you the reading
is stale.

---

## 10. When readings stop arriving

Check, in this order:

1. **Is the device type correct?** A Tilt configured as an iSpindel never reports.
2. **Is the controller's Wi-Fi up?** iSpindel pushes; no network, no data.
3. **BLE range.** Tilt and Pill are low-power; a fridge door and a wall are often enough to stop them.
4. **The gravity range gate.** Values outside SG 0.5–2.0 are discarded silently. A device reading
   pure water at 1.000 passes; a dry sensor at 3.0 does not.
5. **Is the device battery flat?** The card's battery field is the quick answer.

More in [Sensors and gravity troubleshooting](../troubleshooting/03-sensors-and-gravity.md).

---

## 10. What is stored, what is lost
Kept:

- the device type, colour or address,
- the calibration points and the fitted coefficients,
- offset, filter, Plato flag, correction switches.

Lost on reboot:

- the live readings, until the device reports again,
- the iSpindel's self-reported name (it reverts to a generic label until the next packet),
- the original gravity in the live pipeline — it is stored with the batch data but not reloaded into
  the gravity card at boot, so the OG tile is empty after a restart until you re-enter it or open the
  log that contains it.

---

## Next

- [Keg scales](08-keg-scales.md) — the other measuring subsystem
- [Gravity pipeline](../reference/10-gravity-pipeline.md) — the equations and the range gates
