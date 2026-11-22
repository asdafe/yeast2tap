# Scale problems

A keg scale is a load cell, a 24-bit amplifier and a lot of arithmetic. Most problems are wiring or
calibration order.

---

## 1. No signal

The HX711 is not answering. Check:

| Item | Detail |
|---|---|
| VCC | 3.3 V — some HX711 boards are 5 V only; check yours |
| GND | must be common with the ESP32 |
| DOUT → the configured pin | swapped pins produce exactly this symptom |
| SCK → the configured pin | |
| the load cell connected to E+/E− and A+/A− | |
| the solder joints | the most common cause by far |

Reading happens continuously, so "no signal" appears within about two seconds of the wiring being
wrong.

---

## 2. Raw counts appear instead of grams

**Figure:** [An uncalibrated scale: raw counts] `"YT-109-scale-uncalibrated.png"`

Expected when the scale is not calibrated, or when the factor is zero. The Scale page shows raw counts
until a factor exists.

On **Device Setup** the live value is always raw counts, even when calibrated — that page is about
wiring, and grams need the calibration that lives on the Scale page.

**Figure:** [Device Setup showing raw counts for a calibrated scale] `"YT-064-scales-section.png"`

---

## 3. Calibration fails

| Message | Cause | Fix |
|---|---|---|
| unstable | the load changed during the 30 readings | wait, retry |
| no load | the known mass barely moved the reading | check the platform and the value you typed |
| not zeroed | no tare yet | tare first |
| timeout | no readings during the averaging | wiring |

If it keeps failing while the platform is still:

- **raise the stability limit** (the raw-count threshold),
- check for vibration from a compressor or a pump,
- check that the HX711 board is not next to the relay.

---

## 4. The weight is off by a constant

Two candidates:

- **Empty keg mass** is set too high or too low. The *litres* figure depends on it; the *grams* figure
  does not.
- **Tare** was taken with something on the platform.

Re-tare with an empty platform, then re-check the empty-keg mass.

---

## 5. The weight drifts slowly during the day

That is the load cell's own temperature coefficient, and the reason the temperature-correction
workflow exists. Two options:

1. Accept it. It is usually a few tens of grams over a day.
2. Run a sampling session, export, fit in the viewer, paste the formula back. See
   [Keg scales](../user/08-keg-scales.md#9-temperature-correction).

---

## 6. Levels are wrong but the weight is right

Then the arithmetic inputs are wrong: empty-keg mass, capacity, or density. A density of 1.010 versus
1.020 is a 1 % error in litres.

**Figure:** [The keg settings fields] `"YT-102-scale-keg-settings.png"`

---

## 7. A day is missing from the chart

The daily measurement only runs when:

- the clock is synchronised,
- the scale is enabled and calibrated,
- the controller is powered at the configured time.

If the load was unstable, it retries three times five minutes apart; if all three fail, the last value
is recorded and flagged unstable. If no attempt got readings, the day is skipped.

Boot after the measurement time, with no record for the day? The controller measures immediately.

---

## 8. Sampling will not start

Requirements:

- the scale is enabled,
- at least one scale is calibrated,
- the clock is synchronised.

All three. The page shows the clock warning when that is the blocker: a note under the daily settings row
saying the clock is not synchronised, with the Start button having no effect until it is.

**Figure:** [The sampling row with its status] `"YT-105-scale-sampling.png"`

---

## 9. Sampling stopped by itself

- The duration expired. That is the design — sessions are bounded.
- The device rebooted. Session state is in RAM.
- The scale was reconfigured or disabled.
- The clock lost sync.

Samples already written stay in the file.

---

## 10. The correction formula is rejected

**Figure:** [A rejected formula] `"YT-108-scale-correction-error.png"`

| Input | Why it fails |
|---|---|
| `1,5 t` | comma as decimal separator — only a dot is accepted |
| `1e-3 t^2` | exponent notation |
| `t^4` | degree above 3 |
| `2000000 t` | coefficient beyond ±1,000,000 |
| `+` | no coefficient |

Paste the text the viewer's Copy button produced and it will be accepted; it emits plain decimals and
degree 3 at most.

---

## 11. The correction made things worse

Check the reference temperature. The formula is zero at the reference; if you fitted with a reference
in the middle of your range but the scale was zeroed at a very different temperature, the whole curve
shifts.

Also check that you applied it to the right keg — the formula is per keg, and the page applies it to
the selected one.

Finally: saving a formula shifts the reported level by a constant. If the absolute level matters,
re-tare afterwards.

---

## 12. The chart is empty

- No daily records yet.
- The chart shows daily records only; samples are filtered out.
- All records were pruned by the retention setting.
- Reset history was pressed.

**Figure:** [The history chart with a week of data] `"YT-103-scale-history-chart.png"`

---

## 13. Save rejected: pin problem

The firmware validates scale pins strictly: reserved pins, DOUT equal to SCK, a pin already used by
another scale. When a save is refused the page shows a single alert and writes nothing — the previous
pin assignment stays in force, so a failed save never leaves the scale half-configured.

GPIO 13, 14 and 18 are additionally blocked while the rotary encoder is enabled, which is the default on
ESP32. The suggested defaults 25/26 and 27/33 are outside that set, so the two scales fit as shipped.

If you need a third scale, pick a pin from 16, 17, 19, 32 or 33. The rejection alert names the refused
pin and the reason, e.g. `gpio 13 is reserved by the rotary encoder`.

**Figure:** [The scale pin hints] `"YT-065-scale-pin-hints.png"`

---

## 14. The scale reads a keg when there is none

The "no keg" threshold is `max(250 g, half the empty-keg mass)`. A heavy platform or a wrongly high
empty-keg mass makes an empty platform look like a keg.

Lower the empty-keg mass, or tare again.

---

## Next

- [Keg scales](../user/08-keg-scales.md)
- [Scale internals](../reference/09-scale-internals.md) — the statistics and flags
