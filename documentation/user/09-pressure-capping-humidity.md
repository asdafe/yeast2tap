# Pressure, capping and humidity

Three optional subsystems. Each needs extra hardware and each is switched on independently. If you do
not have the parts, skip the page — nothing else depends on them.

---

## 1. Pressure

A pressure transducer lets the controller read the pressure in a spunding valve or a pressure-capable
fermenter, and optionally act on it.

### Enabling it

The Pressure page is hidden until you turn it on: Settings → **Pressure page** card → On. That also
enables the sensor.

**Figure:** [The Pressure page enable card in Settings] `"YT-049-settings-pressure-nav.png"`

Turning the page off disables the sensor but keeps the calibration, so re-enabling does not mean
recalibrating.

### The page

**Figure:** [The Pressure page with the transducer enabled and calibrated] `"YT-094-pressure-page.png"`

| Field | Meaning |
|---|---|
| Enable Pressure Transducer | master switch |
| Use ADS1115 | read through the external I²C ADC instead of the ESP32's own |
| Gain | ADS1115 range; must bracket the transducer's output |
| Control Pressure | act on the reading rather than only reporting it |
| b | the zero/atmospheric intercept, in ADC counts |
| a | psi per count |
| Calibrate | the two-step wizard |

The conversion is `psi = (adc − b) × a`, printed on the page so you can check the arithmetic yourself.

### Calibrating

**Figure:** [Step 1: with no pressure applied] `"YT-095-pressure-cal-step1.png"`

1. Vent the system — no pressure at all.
2. Press **Calibrate step 1**. The controller stores the current ADC count as `b`.
3. Apply a known pressure — a regulated air supply or a gauge you trust.
4. Type that pressure in psi.
5. Press the step-2 button. The controller computes `a`.

The dialog walks through the two steps in order and shows the live raw ADC count, so you can see the
zero value settle before you commit it. Step 1 is captured with the system vented; step 2 needs the
real pressure applied and typed in psi.

Two points are enough because the relationship is linear. If the reading drifts afterwards, redo step
1 — the zero point moves with temperature and sensor ageing.

**Figure:** [The Pressure page with the transducer switched off] `"YT-097-pressure-disabled.png"`

---

## 2. Capping (spunding)

A spunding valve on a servo or a solenoid lets the controller release pressure at a chosen moment.
That is what "capping" means here: closing the blow-off so the beer carbonates itself.

### Hardware

You need an actuator assigned to **Beer Capper** on Device Setup. Without it, the capping card stays
hidden and the mode reads "none".

### The three trigger modes

Control Mode → expand **Advanced controls** → **Capping control**.

**Figure:** [The advanced controls card in its collapsed state, where the optional subsystems live] `"YT-033-advanced-controls-collapsed.png"`

**Figure:** [All three advanced cards: capping, glycol, humidity] `"YT-034-advanced-controls-expanded.png"`

**Gravity**

The Gravity tab holds a single target-SG field. Set a target specific gravity and the valve closes when
the gravity falls to it.

⚠ **Known issue:** in this build the gravity value the capping logic reads is always invalid, so
gravity-triggered capping fires immediately rather than waiting for the target. Use the time or
manual mode until that is fixed. See [Known limitations](../appendix/02-known-limitations.md).

**Time**

The Time tab replaces the SG field with a date-and-time picker. Set a date and time — the valve closes
then. This is the reliable mode and the one most brewers want ("cap it 36 hours after pitching").

**Manual**

The Manual tab has a single open/closed switch and no schedule at all: it opens or closes the valve now.
That is also the way to test the actuator before trusting a schedule.

### Target pressure and the CO₂ calculator

**Figure:** [The carbonation calculator: volumes, temperature, resulting psi] `"YT-038-carbonation-dialog.png"`

Enter the CO₂ volumes you want and the beer temperature; the calculator gives the psi to target. The
formula is the standard carbonation table fit, and it runs in the browser — the controller never
computes CO₂ itself.

### Pressure-assisted capping

If both capping and pressure are enabled, the controller adjusts the **physical** valve while the cap
is logically on:

- above the target pressure, it opens;
- below it, it closes.

What it does **not** do: there is no hard over-pressure limit, no fallback when the sensor fails, and
no watchdog. If the transducer dies, the pressure logic simply stops acting. Size your relief valve as
if the controller were not there.

**Figure:** [The spunding status pane on the dashboard] `"YT-022-dashboard-optional-panes.png"`

---

## 3. Glycol loop control (PTC)

A separate thermostat for a glycol loop or a second cooling circuit, with its own target and its own
timers. It is independent of the fermentation control.

### Hardware

An actuator assigned to **PTC Cooler**. Then the card appears in Advanced controls.

| Field | Meaning |
|---|---|
| Target | the temperature the loop should reach |
| Start temperature | where the loop must rise to before cooling starts again |
| Minimum cooling time | how long a cooling cycle runs at least |
| Minimum idle time | how long between cycles |

### What it measures

It reads the **room probe**, not the beer or the fridge probe. On a glycol build that probe is usually
in the glycol reservoir. If your room probe is in the air, this control is measuring the wrong thing —
check before trusting it.

### Interaction with fermentation control

None, by design. Two separate loops. What does interact is the "Glycol Chilling" option on the Settings
page: it installs the **beer probe as the fridge sensor's backup**, so if the fridge probe fails, the
fridge reading becomes the beer reading. That surprises people; it exists because in many glycol
builds the beer probe is the one measuring the loop.

---

## 4. Humidity

Humidifier and dehumidifier outputs with a target relative humidity.

### Hardware

A humidity sensor (DHT on a pin, or a BLE sensor if the build enables it) plus actuators assigned to
**Humidifier** and **Dehumidifier**.

**Figure:** [The humidity control card: mode and target RH] `"YT-046-humidity-control.png"`

| Field | Meaning |
|---|---|
| Mode | Off, or Control |
| Target relative humidity | the %RH to hold |

### How it decides

The controller compares the reading against the target with a dead band, runs the matching output for a
minimum time, then waits a minimum idle time. The idle times matter: a humidifier that cycles every
few seconds destroys its own membrane.

### The dashboard rows are hidden

The dashboard markup contains humidity legend rows and a chart panel, and they are permanently hidden
in this build. You will see humidity in the **brew log** and in the offline viewer, not on the
dashboard chart.

Also note the duplicate element id on that page: the "Target RH" legend label does not toggle its
series. Cosmetic, but it looks like a bug because it is one.

---

## 5. What is stored

| Subsystem | Stored | Lost on reboot |
|---|---|---|
| Pressure | mode, ADC type, gain, `a`, `b`, target psi | the current reading |
| Capping | mode and the active condition (time or gravity) | the logical state; the relay is re-driven on the next evaluation |
| Glycol | target, start temp, minimum times, enabled | the cycle timing |
| Humidity | mode, target | the current state |

---

## 6. Enabling order that avoids surprises

1. Wire and assign the device on Device Setup first — the cards stay hidden until then.
2. Enable the pressure page in Settings before configuring the transducer.
3. Calibrate the pressure sensor before enabling "Control Pressure".
4. Configure capping last: it acts on hardware that can hold pressure.

---

## Next

- [Logging](10-logging-and-remote.md) — pressure and humidity are recorded in the log
- [HTTP API](../reference/02-http-api.md) — the `/psi`, `/cap`, `/ptc`, `/rh` endpoints
