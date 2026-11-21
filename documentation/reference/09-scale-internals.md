# Scale internals

The HX711 driver, the statistics behind a measurement, the record format, and the temperature
correction. This is the implementation behind [Keg scales](../user/08-keg-scales.md).

---

## 1. Reading the chip

```
for 24 bits:
    clock high, clock low, read the data pin
one extra pulse (gain 128, channel A)
```

Details that matter:

- interrupts are disabled during the read on ESP32 (a critical section),
- a clock high longer than about 60 µs powers the chip down, so the pulses are kept short,
- **no rate pin is driven** — the chip runs at its default rate,
- a saturated value is returned as "no reading", the same as a missing one,
- reading happens on every loop pass, not on a timer.

There is no averaging at this level; the filtering happens above.

---

## 2. The live value

An 8-sample ring is averaged:

```
netCounts  = mean(ring) + correctionCounts(fridgeC) − zeroOffset
grossGrams = netCounts / calibrationFactor
```

`grossGrams` is clamped to −500…+100000 g. `present` is `gross ≥ max(250 g, emptyKegMass / 2)`.

The states:

| State | Meaning |
|---|---|
| Disabled | scale off |
| NoKeg | below the threshold |
| Settling | the ring is filling |
| Stable | a valid reading |
| Measuring | a long measurement is running |
| NoSignal | the chip is not answering |

---

## 3. Long measurement

The daily record does not use the live value. It runs a dedicated measurement:

```
10 blocks × 5 samples
each block → median of its 5 samples
result     → interquartile mean of the 10 block medians
```

The interquartile mean drops the two lowest and two highest block medians. That gives a median-of-
medians that is robust against a single bad block and still uses most of the data.

Stability test:

```
halfDiff = |mean(blocks 6..10) − mean(blocks 1..5)|
stable   = halfDiff ≤ calibrationLimitCounts
```

The same limit is used by calibration, so tuning it affects both.

A measurement aborts with "no signal" if the chip gives nothing for two seconds.

---

## 4. Calibration statistics

30 readings, and these figures:

| Figure | Meaning |
|---|---|
| mean | the stored offset or the factor numerator |
| stdDev | deviation from the first sample, not from the mean of all |
| spread | max − min |
| halfDiff | mean of the last 15 minus mean of the first 15 |
| limit | the stability threshold at the time |

Failure conditions:

- `halfDiff > limit` → unstable,
- `|mean − zeroOffset| < max(100, 5·stdDev)` → no load.

Both thresholds are in **raw counts**, not grams. The interface talks about weight, so the "no load"
message can feel wrong when a small weight is applied — 100 counts at a 1000 counts/g factor is 0.1 g.

Tare stores `zeroOffset = mean + correction`. Factor stores `(mean + correction − zeroOffset) / known`.

---

## 5. The record format

26 bytes, packed:

```c
struct DailyRecord {
    uint32_t day;               // local calendar day
    uint32_t time;              // UTC epoch
    int32_t  levelGrams;
    int32_t  consumedGrams;
    uint8_t  scaleId;
    uint8_t  flags;
    uint8_t  version;
    uint8_t  reserved;
    int32_t  rawCounts;         // uncorrected; INT32_MIN = unknown
    int16_t  temperatureDeciC;  // INT16_MIN = unknown
};
```

| Flag | Meaning |
|---|---|
| 1 | provisional (a manual measurement for the day in progress) |
| 2 | keg change |
| 4 | unstable measurement |
| 8 | no keg |
| 16 | consumption reset |
| 32 | **sample** (a row from a sampling session) |

### Finding a record

The file is scanned linearly. The first record matching `(scaleId, day)` is overwritten when a final
measurement replaces a provisional one — except that **sample rows are skipped** in that scan, so a
final measurement can never overwrite a sample.

### Reading it

Readers that must ignore samples:

- recovery at boot (rebuilding the last final level),
- the daily replace scan,
- the dashboard chart.

`pruneDaily` needs no special case: samples age out with the normal retention.

---

## 6. Scheduling

```
if clock not synchronised       → return
if minute < dailyMinute         → return
for each active calibrated slot:
    if lastFinalDay >= today    → skip
    if a measurement is running → skip
    if a retry is pending and not yet due → skip
    start a scheduled measurement
```

Retries: a scheduled measurement that is unstable or gets no signal retries after five minutes, up to
three attempts. A measurement that never gets any data marks the day as done, so it does not retry
forever.

A **manual** measurement after the day's final belongs to the next day, and is stored as provisional.

Mutations of the file are serialised with a recursive mutex, because the web handlers and the loop both
touch it.

---

## 7. Temperature correction

```
c(t) = c0 + c1·t + c2·t² + c3·t³      t in °C, result in raw counts
```

Rules:

- all-zero coefficients mean "no correction" and take a fast path,
- the result is clamped to the 24-bit HX711 range,
- a non-finite input returns 0, never NaN,
- an invalid fridge temperature means no correction.

Applied at three points:

| Point | Why |
|---|---|
| live weight | what you see |
| long measurement | what is recorded |
| calibration | so constants come out as if measured at the reference temperature |

**Not applied to the stored raw counts.** That is deliberate: a later re-fit with a different reference
temperature is still possible.

### Where the coefficients come from

Fit offline against a sampling session — see
[Keg scales](../user/08-keg-scales.md#9-temperature-correction). The page accepts a formula in `t`
with coefficients up to ±1,000,000; anything outside that range is refused, and the firmware would zero
it anyway.

---

## 8. Sampling sessions

State, all in RAM:

```cpp
bool     active;
uint32_t startEpoch, endEpoch, nextEpoch;
```

Start requires: scale enabled, clock synchronised, at least one calibrated active scale. It then
**deletes every existing sample row** and sets the epochs.

Each pass:

```
if not active or clock unsynchronised → return
if now >= endEpoch                    → stop
if now < nextEpoch                    → return
nextEpoch = now + interval            (advanced before starting, so it cannot spin)
start a sample measurement on every idle calibrated scale
```

A sample measurement uses the same 10×5 block statistics as the daily one, writes an appended row with
the sample flag, and touches none of the daily bookkeeping.

A reboot ends the session; the samples stay.

---

## 9. Consumption

```
consumed = lastFinalGrams − grams
```

only when: not a sample, not no-keg, not a keg change, and a previous final exists.

Keg change is either explicit (the button) or a rise of more than 2000 g since the last final.

---

## 10. JSON shapes

### `GET /scale` (full)

Per slot: `id, configured, name, kegName, doutPin, clockPin, calibrated, calibrationLimitCounts,
zeroOffset, calibrationFactor, emptyKegGrams, capacityMl, beerDensityKgPerL, tempCorrection`,
plus runtime: `state, present, stable, rawCounts, grossGrams, remainingLiters, capacityLiters,
percent, temperatureC`, plus calibration and measurement job fields.

### `GET /scale?daily=<id>`

```json
{"records":[[day,time,levelG,consumedG,flags,scaleId,raw|null,tempC|null], …]}
```

`id ≥ 8` returns every keg. This is the shape the dashboard and the export use.

---

## 11. The two dead settings

`eventThresholdGrams` and `maxPourMl` are stored, validated, echoed and backed up. **Nothing reads
them.** There is no pour detection in this firmware.

They are harmless and they are in the backup, but a documentation page must not describe pour events
as a feature.

---

## 12. Testing a scale without hardware

The scale logic is a state machine over counts, so a bench test is:

1. short DOUT and SCK with a resistor to ground/adjustable supply,
2. watch the raw counts move,
3. calibrate with an arbitrary "known weight",
4. verify the arithmetic: `grams ≈ (counts − offset) / factor`.

If the counts move but the grams do not, the factor is the suspect.

---

## Next

- [Keg scales](../user/08-keg-scales.md)
- [Scale problems](../troubleshooting/04-scale-problems.md)
