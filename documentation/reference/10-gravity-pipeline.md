# Gravity pipeline

From a wireless hydrometer to a number on the dashboard and a point in the log.

---

## 1. Sources

| Source | Transport | Entry point |
|---|---|---|
| iSpindel / GravityMon | HTTP POST to `/gravity` | the external-data handler |
| Tilt | BLE advertisement | the Tilt listener |
| RAPT Pill | BLE advertisement | the Pill listener |
| Manual OG | the dashboard dialog | `/gravity` with the `og` flag |
| Manual SG | `/sgset` (no UI) | the API |

BTHome sensors are **not** gravity sources: they report temperature and humidity, and they are not
compiled into this build anyway.

---

## 2. The report

### iSpindel

```json
{ "name": "...", "temperature": 19.5, "angle": 25.4,
  "battery": 3.95, "RSSI": -62, "gravity": 1.014 }
```

The controller acknowledges immediately and parses afterwards. **All five of name, temperature, angle,
battery and RSSI must be present**; a report missing one is discarded. Gravity itself is optional.

Temperature units: the report may carry a unit hint; F and K are converted on receipt.

### Tilt

The advertisement carries gravity (thousandths) and temperature (°F). The controller converts the
temperature and treats the gravity as SG — Tilt does not report an angle in the same sense.

### Pill

The advertisement carries gravity (a float, thousandths), temperature (kelvin × 128), acceleration and
battery. The controller derives an angle from the acceleration, compensating for the Pill's axis
orientation.

---

## 3. The pipeline

```
report
  ├─ update last-seen time, tilt angle, RSSI, battery, temperature
  ├─ store the tilt with the pending calibration point
  ├─ if "calculated by BPL":
  │     correction = c0 + c1·T + c2·T² + c3·T³
  │     gravity = poly(raw + correction)
  │  else:
  │     gravity = reported + offset + poly(beerTemp) if temperature correction is on
  ├─ range gate: SG 0.5–2.0 (Plato −1–99)
  ├─ low-pass filter
  ├─ update the profile engine with the gravity
  └─ hand the value to the logger
```

### The polynomial

```
sg = c0 + c1·raw + c2·raw² + c3·raw³
```

with up to ten calibration points and a degree-1/2/3 fit chosen by point count. With fewer than two
points the coefficients are the identity.

**The fit happens in the browser.** The firmware stores the coefficients; the regression runs in the
Hydrometer Setup page's JavaScript. The firmware's own regression routine exists but the call site is
commented out.

### The filter

A one-pole exponential moving average:

```
y += β · (x − y)
```

β comes from the gravity settings, 0.1 by default, forced to 0.15 for Tilt and Pill. Higher β means
faster tracking and more noise.

### The range gate

Readings outside SG 0.5–2.0 are dropped **silently**. That is why a hydrometer can be clearly
reporting and the dashboard still shows nothing: the value was rejected before it reached any consumer.

---

## 4. Temperature correction, and its two unit conventions

The same four coefficients are used in two places with different temperature inputs:

| Path | Temperature fed in |
|---|---|
| "calculated by BPL" (raw angle) | the hydrometer's own temperature, in the **display unit** |
| device-reported SG | the **beer** temperature, converted to **°C** |

The shipped default coefficients were fitted in °C. So the second path is consistent with them and the
first is not, unless the display unit is °C.

There is also a **second, different** correction — the standard density-vs-temperature normalisation
applied to SG in °F around a 68 °F reference, inside the polynomial evaluation. It is a separate
mechanism from the `tiltCorrectionCoeff` array, even though both are called "temperature correction" in
the interface.

Practical advice: leave the correction off unless you fitted it yourself, and if you do fit it, do it in
°C.

**There is no editor for these coefficients.** The field on the page is never populated and is not
saved. Treat gravity temperature correction as unavailable in this build.

---

## 5. Where the value goes

| Consumer | What it uses |
|---|---|
| dashboard gravity card | SG, OG, attenuation, ABV |
| dashboard device card | temperature, angle, battery, RSSI, last update |
| `/getstatus` `gravity` block | the same values, plus `enabled` and `device` |
| brew log | a gravity record when it changes, plus an OG record |
| profile engine | gravity conditions and stability |
| capping | the gravity trigger (currently broken, see below) |
| remote logging | `%g`, `%p` |
| MQTT reporting | `gravity`, `plato` |

---

## 6. Known defects in this path

Three, all verified in the code and all affecting what the documentation may promise:

**1. Gravity-triggered capping fires immediately.** The filtered-gravity member is shadowed by a local
variable during assignment, so the "filtered" accessor always returns invalid. The capping logic reads
that accessor and concludes the target has been reached. Use time-based or manual capping.

**2. Manual SG entry from the dashboard does nothing.** The dialog posts a payload without the five
required fields; the handler has already answered 200, so the UI shows success. OG entry works, and
`/sgset` works.

**3. The OG is not restored at boot.** It is stored with the batch data and written into the log, but
nothing loads it into the live gravity object, so the OG tile is empty after a restart.

None of these is a configuration mistake; they are documented in
[Known limitations](../appendix/02-known-limitations.md).

---

## 7. Stability

Used by profile conditions, not by any filter:

```
stable = |max(gravity over window) − min(gravity over window)| ≤ stablePoint
         over the last stableTime minutes
```

Both values come from the profile step; the "stability threshold" on the Hydrometer Setup page is only
a default for new steps.

The Gravity page label reads as if it controlled filtering. It does not.

---

## 8. Calibration data flow

```
user enters (raw, true gravity) pairs in the browser
    ↓
browser fits a polynomial
    ↓
browser writes the four coefficients into the settings form
    ↓
POST /gdc  →  stored in the settings file
    ↓
firmware applies them to every subsequent report
```

The controller never sees the points, only the coefficients. That means:

- the calibration cannot be re-derived on the device,
- changing the coefficient set invalidates nothing else,
- the points are only preserved if the page keeps them in the settings object.

---

## 9. Persistence

| Item | Where | Survives reboot |
|---|---|---|
| device type, colour, MAC | settings file | yes |
| calibration points and coefficients | settings file | yes |
| offset, filter, Plato flag, correction switches | settings file | yes |
| live gravity, angle, RSSI, battery | RAM | no |
| iSpindel's self-reported name | RAM | no, until the next report |
| OG (live) | RAM | no |
| OG (batch) | settings file + log | yes, but not loaded into the live value |
| gravity history | brew log | yes |

---

## 10. A minimal integration

To feed gravity from your own system:

```
GET /sgset?sg=1.014
```

That sets the live gravity, which updates the dashboard, the profile engine, remote logging and the
log. No authentication needed, so keep the device on a trusted network.

To feed a full report instead (so the device card is populated too), post the iSpindel shape to
`/gravity` with all five fields.

---

## Next

- [Hydrometers](../user/07-hydrometers.md)
- [Sensors and gravity troubleshooting](../troubleshooting/03-sensors-and-gravity.md)
- [Known limitations](../appendix/02-known-limitations.md)
