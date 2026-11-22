# Keg scales

Up to eight HX711 load cells can report how much beer is left in a keg, how much was poured, and how
the weight drifts with temperature. This page covers calibration, the daily record, and the
temperature-correction workflow.

---

**Figure:** [The Scale page with a calibrated scale and a keg on the platform] `"YT-098-scale-main.png"`

---

## 1. What it measures, and what it computes

The controller reads raw counts from the HX711 and turns them into grams:

```
grams = (average counts + temperature correction − zero offset) / calibration factor
```

Then, for a keg:

```
litres of beer = max(0, grams − empty keg mass) / 1000 / beer density
```

Three calibrations feed that: the **tare** (zero offset), the **factor** (counts per gram), and
optionally the **temperature correction**. Plus the empty-keg mass and the density that you type.

---

## 2. Wiring and pins

HX711 DOUT and SCK on two free GPIOs per scale. Pins are assigned on Device Setup, not here.

**Figure:** [Two configured scale rows on Device Setup] `"YT-064-scales-section.png"`

Rules that matter:

- reserved pins are rejected,
- DOUT and SCK must differ,
- a pin cannot be shared between scales,
- input-only pins work for DOUT, never for SCK.

The two default pairs, 25/26 and 27/33, work as shipped. GPIO 13, 14 and 18 belong to the rotary
encoder and are rejected for a scale — see
[Wiring and pins](../install/02-wiring-and-pins.md#5-the-two-keg-scales-and-the-encoder).

On Device Setup the live value is **raw counts**; grams are computed here on the Scale page, because
this page is where the calibration lives.

---

## 3. Calibrating

Two steps, in this order.

### 3.1 Tare (zero)

1. Empty the platform. Nothing on it — not the keg.
2. **Zero empty platform**.
3. The controller averages 30 raw readings and stores the mean as the zero offset.

The platform's zero and the empty keg's mass are different things: the tare is the bare platform, the
empty-keg mass is the keg plus its fittings, entered separately.

### 3.2 Factor

1. Put a known mass on the platform — a 1 kg bag of sugar is fine, a real 5 kg weight is better.
2. Type the mass in **Known weight (g)**.
3. **Calculate factor**.
4. Wait. It averages 30 readings and checks that the load did not change during the measurement.

While it runs, the state line counts the readings it has taken (for example `Averaging 12/30`) and the
three action buttons are disabled, so a second press cannot start a competing measurement.

When it finishes, a summary dialog lists the resulting factor together with the statistics you need to
judge it: the two half-averages and their difference, the stability limit in force, the standard
deviation and the spread. Read that summary before accepting the result.

| Number | Good sign |
|---|---|
| First half vs last half difference | below the stability limit |
| Standard deviation | small relative to the factor |
| Spread | not dominated by a single spike |
| Factor | plausible for your load cell (a few hundred to a few thousand counts per gram) |

If it fails, the message says why:

- **unstable** — the load changed while averaging; wait a moment and retry,
- **no load** — the known mass barely changed the reading; check the platform,
- **not zeroed** — tare first,
- **timeout** — the scale stopped sending; check the wiring.

### 3.3 Stability limit

**Figure:** [The stability limit field with its gram equivalent] `"YT-101-scale-stability-limit.png"`

A raw-count threshold, 1000 by default, shown with its gram equivalent next to it. Calibration *and*
the daily measurement both use it.

- Too low: a still but noisy load cell keeps failing.
- Too high: a load that is actually changing is accepted.

Convert with the factor: a limit of 1000 counts at 1000 counts/g is 1 g of allowed drift per
half-measurement.

### 3.4 Keg data

**Figure:** [Empty keg mass, capacity, density] `"YT-102-scale-keg-settings.png"`

| Field | Meaning |
|---|---|
| Empty keg | the mass of the keg plus fittings, in grams |
| Capacity | nominal volume, in litres |
| Beer density | 1.010 for a typical ale, 1.020+ for a big beer |

Density converts mass to litres. Being 0.01 off is about a 1 % error in the litres figure.

---

## 4. The live reading

The big number on the Scale page is the gross weight. Its state line explains what the controller
thinks:

| State | Meaning |
|---|---|
| Settling | the sample ring is still filling |
| Stable | a valid reading |
| No keg | the weight is below the empty-keg threshold |
| No signal | the HX711 is not answering |
| Measuring | a long measurement is in progress |
| Disabled | the scale is switched off |

The status also names the device and the keg, and shows the keg temperature — the fridge probe, which
is also what the temperature correction uses.

**Figure:** [An uncalibrated scale: raw counts instead of grams] `"YT-109-scale-uncalibrated.png"`

An uncalibrated scale replaces the grams with raw counts and says so in the state line. A disconnected
HX711 reads `No signal - check HX711 wiring` instead, and the weight area stays empty rather than
showing a stale number.

---

## 5. The daily record

Once a day, at a configurable time (08:00 by default), each calibrated scale takes a long
measurement:

- 50 readings in 10 blocks of 5,
- each block reduced to its median, so a single spike cannot move the result,
- the result is the interquartile mean of the ten block medians.

If the load changed during the measurement, or the scale gave no readings, it retries after five
minutes, up to three attempts. A measurement that stays unstable is recorded and flagged `U`. If no
attempt gets any data, that day is skipped.

Each record stores: the day, the timestamp, the level in grams, the consumption since the previous
record, the flags, the raw counts, and the fridge temperature.

**Figure:** [Daily settings, export and reset] `"YT-104-scale-daily-settings.png"`

| Setting | Default | Meaning |
|---|---|---|
| Daily measurement time | 08:00 | when the record is taken |
| History days | 90 | retention, 1–365 |
| Sample every (min) | 2 | high-frequency sampling interval |
| for (hours) | 24 | sampling session length |

**Measure now** takes the same long measurement immediately and saves a *provisional* record for the
day in progress. The scheduled measurement replaces it.

**Keg changed** marks the next record as the start of a new keg: consumption is reported as zero and
the new level becomes the baseline. A rise of more than 2 kg does the same automatically.

---

## 6. Consumption

```
consumption = previous daily level − today's level
```

Only for real daily records: not for samples, not for days marked as a keg change, not for days with
no keg.

This means the first record after a keg change shows zero consumption, which is correct — there is
nothing to compare against yet.

---

## 7. The chart

**Figure:** [A week of history: consumption bars, and three lines per keg] `"YT-103-scale-history-chart.png"`

| Series | Axis | Meaning |
|---|---|---|
| Consumed (L) | left, bars | beer that left every keg that day, summed |
| `<keg>` left (L) | left, solid | beer remaining |
| `<keg>` weight (kg) | left, dashed | gross platform weight |
| `<keg>` raw | right | raw HX711 counts |

Click a legend entry to hide a line; the entry stays visible, dimmed, so you can bring it back. The
chart shows **all** kegs regardless of which one the selector above shows.

Annotations mark the odd days: **K** for a keg change, **R** for a consumption reset, **U** for a
measurement where the load changed.

Sample rows never appear on this chart. They are collected for the temperature-correction workflow
and are filtered out of the daily view.

---

## 8. Sampling sessions

**Figure:** [A sampling session running, with its countdown] `"YT-105-scale-sampling.png"`

The load cell's own reading drifts with its temperature. To measure that drift you need many
readings per hour at varying temperatures — which the daily record does not provide.

A sampling session does that:

1. Set an interval (1–120 minutes) and a duration (1–72 hours).
2. **Start sampling**. It asks before deleting the previous session's samples.
3. Each interval, every active calibrated scale takes one measurement and appends a record with the
   raw counts and the fridge temperature.
4. The session stops by itself at the end of the duration, or when you press **Stop**.

Three constraints:

- **The clock must be synchronised.** Without it the session cannot start and the page says so.
- **Starting a new session deletes the previous session's samples.** One file holds one experiment.
- **The session lives in RAM.** A reboot stops it; the samples already written stay.

---

## 9. Temperature correction

The workflow has four stages: collect, export, fit, paste back.

### 9.1 Collect

Run a sampling session with the keg left alone. The controller records raw counts against
temperature; nothing is corrected yet.

### 9.2 Export

**Export data** downloads `scale_daily.json` — the settings, all daily records, and all sample rows.
One file, one experiment.

### 9.3 Fit

Open the file in the offline log viewer (`y2tlogviewer.htm`, see
[Logging](10-logging-and-remote.md)). It recognises the export and switches to scale mode.

**Figure:** [The viewer in scale mode: weight and raw counts for the keg] `"YT-130-viewer-scale-mode.png"`

Then **Menu → Create Scale Temperature Correction**:

**Figure:** [The scale correction dialog: keg selector, degree, reference temperature, fitted curve] `"YT-131-viewer-scale-tc.png"`

- pick the keg (one formula per keg),
- pick degree 2 or 3,
- pick a reference temperature — the correction will be zero there,
- **Copy** puts the formula on the clipboard.

Choose the reference temperature as the temperature at which you want the scale to read "true" —
usually where you calibrated it, or the middle of your fermentation range.

### 9.4 Paste back

**Figure:** [The correction card with a formula stored] `"YT-107-scale-correction-filled.png"`

On the Scale page, with the right keg selected:

1. Paste into **Correction formula**.
2. **Save formula**.
3. The formula is stored for that keg and applied immediately.

The controller applies the correction to the live weight, to the daily measurement, and to tare and
factor calibration — so calibrating at any temperature produces constants as if taken at the
reference.

**Raw counts in the log stay uncorrected**, deliberately: that is what makes it possible to re-fit
later with a different reference temperature.

The formula is a polynomial in `t`, the fridge temperature in °C, and its result is a shift in raw
counts:

```
c(t) = c0 + c1·t + c2·t² + c3·t³
```

**Figure:** [The empty correction card] `"YT-106-scale-correction-empty.png"`

**Figure:** [A rejected formula: comma as decimal separator] `"YT-108-scale-correction-error.png"`

Only a dot is accepted. A comma, an exponent, a power above 3, or a coefficient beyond ±1,000,000 is
refused and nothing is saved.

### 9.5 A note on absolute level

Saving a formula shifts the reported level by a constant — the drift at the temperature the scale was
last zeroed. If the absolute level matters, re-zero the empty platform after saving. Until you do,
the next daily consumption entry absorbs the shift.

---

## 10. Reset history

**Reset history** deletes every daily record, the backup and temp files, stops a running measurement,
and restarts the consumption baseline from the current level. Settings and calibration are kept.

It is the right action when you change kegs and do not want the old curve in the chart.

---

## 11. On a phone

**Figure:** [The Scale page at phone width: the weight readout, the buttons and a shorter chart] `"YT-110-scale-mobile.png"`

The page is usable at the fermenter: the weight is the first thing on screen, and the three daily
actions sit right below it. Calibration needs a still platform and a free hand, so it is easier from a
laptop — but reading the level is not.

**Figure:** [The same page in a narrow viewport with the calibration panel expanded] `"YT-006-scale-mobile.png"`

---

## 12. What is stored

| Item | Where |
|---|---|
| pins, names, keg names | settings file |
| zero offset, factor, calibrated flag | settings file, per scale |
| stability limit | settings file, per scale |
| empty keg mass, capacity, density | settings file, per scale |
| retention, daily time, sampling interval and duration | settings file |
| temperature correction coefficients | settings file, per keg |
| daily and sample records | `/scale_daily.log`, binary |
| sampling session state | RAM only |

A Settings backup carries all of the settings; a `device.json` backup carries the pins and the
calibration but **not** the sampling settings or the correction coefficients. See
[Backup and restore](11-backup-restore.md).

---

## Next

- [Scale problems](../troubleshooting/04-scale-problems.md)
- [Scale internals](../reference/09-scale-internals.md) — the statistics and the record format
