# Glossary

Terms this documentation uses in a specific way. Where a word has a looser meaning elsewhere, the
definition here is the one the firmware implements.

---

## Control

**Beer control** — the mode where you set a beer temperature and the controller computes the fridge
temperature needed to reach it.

**Fridge control** — the mode where you set the fridge temperature directly.

**Independent mode** — two thermostats, one on the beer probe and one on the fridge probe, allowed to
run simultaneously.

**Setpoint** — a target temperature. The *beer* setpoint is yours; the *fridge* setpoint in beer mode
is computed.

**PID** — proportional-integral-derivative. Here it produces a fridge setpoint, not a duty cycle.

**Integrator** — the part of the PID that removes a standing offset. It ticks every 61 seconds and only
while idling.

**Idle band** — the temperature window around the fridge setpoint in which neither relay runs.

**Dead time** — the enforced pause between a heating cycle and a cooling cycle, 5 seconds by default
(600 s in earlier releases, and in the classic PID modes of those builds).

**Peak estimation** — predicting how far the fridge will overshoot after the relay opens, so the cycle
can be cut early.

**Heater pulse PI** — the independent-mode heater controller that delivers a measured PI duty as
short pulses, each sized from the ripple the previous pulse produced.

---

## Profiles

**Profile** — an ordered list of up to ten steps that drives the setpoint.

**Step** — a temperature plus a duration and a condition.

**Condition** — the rule that ends a step: time, gravity, stability, or a combination.

**Ramp step** — a step with condition `r` that interpolates between its neighbours instead of holding.

**Stability** — the gravity staying within a window of points for a window of time.

**Latch** — the flag that marks a profile as finished so it stops touching the setpoint.

---

## Hardware

**Device slot** — one of sixteen entries describing a sensor or actuator.

**Function** — the role of a slot: heater, cooler, beer probe, and so on.

**Hardware class** — the physical kind: bare pin, 1-Wire temperature, 1-Wire PIO, DHT, and so on.

**Tare** — zeroing the platform.

**Factor** — the calibration constant converting raw counts to grams.

**Stability limit** — the raw-count threshold used by both calibration and the daily measurement.

**Raw counts** — the uncalibrated 24-bit number from the HX711.

---

## Scale

**Daily record** — the one-per-day measurement that feeds the history chart.

**Provisional record** — a manual measurement for the day in progress, replaced by the scheduled one.

**Keg change** — a marked discontinuity: consumption resets and the new level becomes the baseline.

**Sample record** — a high-frequency record collected during a sampling session, flagged separately
and excluded from the daily chart.

**Sampling session** — a bounded period during which samples are taken at a fixed interval.

**Temperature correction** — a polynomial that shifts raw counts according to the fridge temperature.

**Reference temperature** — the temperature at which the correction is zero.

---

## Gravity

**OG** — original gravity, set once per batch.

**SG** — specific gravity, the current reading.

**Attenuation** — the fraction of fermentable sugar consumed, from OG and SG.

**ABV** — alcohol by volume, estimated from OG and SG.

**Device-SG mode** — the controller trusts the gravity the hydrometer reports.

**Calculated-by-BPL mode** — the controller applies the polynomial to the raw angle itself.

**Raw angle** — the hydrometer's tilt reading, before any conversion.

**Plato** — degrees Plato; a display and input convention, not a different internal value.

---

## Persistence

**Settings file** — `/bpl.cfg`, a raw dump of the whole configuration struct.

**EEPROM files** — `/eeprom_*`, the BrewPi control data reimplemented on the filesystem.

**Migration** — filling a shorter, older file with defaults for the fields it does not have.

**Atomic write** — writing to a temporary file and renaming it into place. Only the scale history does
this.

---

## Networking

**Station mode** — the device joins your network.

**Access point mode** — the device is its own network.

**Fallback AP** — the automatic access point created when the station connection fails.

**mDNS** — the `.local` name resolution. Not the same as a DHCP hostname.

**Write window** — the 30-minute, single-IP authorisation that lets a browser send WebSocket writes.

---

## Logging

**Brew log** — the binary file on the device with one record per minute.

**Log viewer** — the standalone HTML file that opens a brew log offline. Not served by the firmware.

**Remote logging** — periodic HTTP pushes to an external service, with no retry.

**Retained** — an MQTT message the broker keeps, so a new subscriber receives a stale value
immediately.

---

## Abbreviations

| Short | Full |
|---|---|
| AP | access point |
| BLE | Bluetooth Low Energy |
| DHT | the DHT11/12/21/22 temperature-humidity sensor family |
| HX711 | the 24-bit load-cell amplifier |
| NTP | network time protocol |
| OTA | over the air (firmware update) |
| PTC | parasite temperature control (the glycol loop) |
| RH | relative humidity |
| SG / OG | specific / original gravity |
| SSR | solid-state relay |
