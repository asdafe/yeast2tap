# Known limitations

Things that are true of this build and that the documentation deliberately does not promise. Each one
was verified in the source; none is a configuration mistake.

---

## 1. Software defects you can hit

### Gravity-triggered capping fires immediately

The filtered-gravity value used by the capping logic is always invalid, because a local variable
shadows the member that should hold it. The capping code reads "invalid" as "target reached" and closes
the valve on the first evaluation.

**Workaround:** use time-based or manual capping.
**Impact:** the gravity trigger on the Control Mode page does not do what it says.

### Manual specific-gravity entry does nothing

The dashboard dialog posts a payload the gravity handler rejects, but the handler replies 200 before
parsing, so the interface reports success.

**Workaround:** set the OG instead (that works), or `GET /sgset?sg=…`.
**Impact:** the SG tile cannot be updated by hand.

### The original gravity is not restored after a reboot

OG is stored with the batch data and written into the log, but nothing loads it into the live gravity
value at boot.

**Workaround:** re-enter it, or open a log that contains it.
**Impact:** the OG tile, attenuation and ABV are blank after a restart.

### Gravity temperature correction has no editor

The coefficients exist and are applied, but no page writes them, and the field that looks like it
should is never populated and is not saved. Additionally the same coefficients are evaluated in °F on
one path and °C on another.

**Workaround:** leave it off.
**Impact:** gravity cannot be corrected for temperature from the interface.

**Figure:** [The inert temperature-correction field on Hydrometer Setup] `"YT-079-gravity-known-issue.png"`

---

## 2. Interface elements that do not work

| Element | Where | Reality |
|---|---|---|
| Pressure, CO₂, chamber-RH, target-RH and room-RH chart rows | Dashboard legend | permanently hidden by CSS; nothing unhides them |
| Pressure and humidity chart panels | Dashboard | same |
| LCD mirror block | Dashboard | the target elements no longer exist; the code that would fill them is inert |
| "Invalid Formula" label | Hydrometer Setup | always visible, never updated |
| "Tilt Temp. Correction" field | Hydrometer Setup | never populated, excluded from saving |
| Target-RH legend label | Dashboard | duplicate element id, so the label does not toggle its series |
| Humidity control card | Control Mode | shown even when no humidity data is available |

None of these is dangerous. They do mean that a reader following the interface's own labels can be
misled, which is why they are listed rather than ignored.

**Figure:** [One of the inert dashboard regions, shown for reference] `"YT-013-chart-legend-toggled.png"`

---

## 3. Deliberate scope limits

### One chamber, one beer

The device model has four chambers and six beers; only chamber 1 and beer 1 have runtime destinations.
A second beer sensor and per-beer actuator functions exist in the enum but cannot be installed.

### No pour detection

`eventThresholdGrams` and `maxPourMl` are stored, validated, backed up and never read. Consumption is
computed from the difference between daily records, not from pour events.

### No on-device CO₂ calculation

The CO₂ volume figure exists in the browser only — in the capping calculator and in the offline viewer.

### No gravity temperature-correction editor

See above. The scale has one; gravity does not.

### No TLS, no CSRF tokens, no rate limiting

The interface is plain HTTP with HTTP Basic authentication, on the assumption of a trusted network.

---

## 4. Security properties

These are documented as facts, not defects, because changing them is out of scope:

- **Several write endpoints need no authentication**, including `/pid` (which writes EEPROM),
  `/wificon`, `/gdc`, `/sgset`, `/gravity`, `/time`, `/rh`, `/ptc` and the log deletion route.
- **The firmware upload and the whole file manager on port 8008 are unauthenticated.**
- **`GET /mqtt` returns the broker password**, and `GET /log?data=1` returns the remote URL, which may
  contain a token.
- **The WebSocket write window is per IP and single-slot**, so a second client evicts the first, and
  anything behind the same NAT inherits the right to write.
- **All WebSocket replies are broadcast** to every connected client.

---

## 5. Hardware and pin caveats

### Scale pins and the rotary encoder

The Device Setup page suggests 25/26 and 27/33 for the two scales. Those pins are valid: the rotary
encoder was moved to 13/14/18 so both scales fit without re-wiring. A scale saved on 13, 14 or 18 is
rejected with a message naming the pin, because the encoder owns it.

**Figure:** [The scale pin selectors, with the encoder pins greyed out] `"YT-065-scale-pin-hints.png"`

### Device pins are not validated

Only scale pins are checked. A device on a flash or boot-strapping pin saves successfully and then
prevents the board from booting.

### DS2413 is output only

The sense mode is compiled out. A DS2413 cannot read a switch in this build.

### BTHome, RAPT-as-device and BME280 are not in the tested build

The interface lists the types; the code is compiled out. Only the `esp32-dev` environment enables
BTHome.

### The access point is open by default

Unless an AP password of at least eight characters is set, the fallback access point is an open
network. Shorter passwords silently produce an open network.

---

## 6. Reliability caveats

### The settings file is not written atomically

A power cut during a save truncates it. The loader then falls back to defaults, or migrates a known
smaller size. Device assignments and profiles are the usual casualties.

The scale history, by contrast, uses a temp/rename pattern and usually survives.

### `erasewifisetting` may not forget the network

The ESP32 keeps its own copy of the credentials in NVS, which that endpoint does not clear. The device
can rejoin the old network.

### A filesystem mount failure formats silently

The firmware formats on a failed mount and only logs it. Settings are then re-defaulted. This is the
"everything was fine and now it is not" scenario.

### Sampling sessions are RAM-only

A reboot ends a running session. Samples already written stay.

### The heater pulse PI forgets its measurements

Every reboot, mode change and switch toggle resets the learned pulse length, ripple and coast. The
three constants (`indKp`, `indKi`, `indPulse`) are stored.

---

## 7. Time

### A power cut makes the clock slow

The saved time is restored plus five minutes, so after a long outage the clock can be up to about an
hour behind until NTP or the browser corrects it.

### Negative time zones may be wrong

The local-time calculation adds a stored unsigned offset to a 64-bit time value. For time zones west of
UTC this is likely to produce a wrong local time, and the scale's daily scheduler depends on it.

**Verify on your device** if you are in the Americas. The documentation does not assert that it works.

---

## 8. What is *not* a limitation

Worth saying, because readers assume otherwise:

- **Single-chamber** does not mean single-function: heating, cooling, fan, light, door, humidity and
  glycol are all supported on that one chamber.
- **No local display is fine.** The display is optional; the web interface is the primary surface.
- **No hydrometer is fine.** Fixed setpoints and time-based profiles work without gravity.
- **The controller does not need internet access** for anything except NTP (and only for the clock) and
  remote logging, if you enable it.

---

## 9. Reporting a problem

If a behaviour contradicts this documentation, the code is the authority. Each reference page cites the
files it was derived from, so the fastest check is to look at the function named there in the version
you are running.

---

## Next

- [Troubleshooting](../troubleshooting/01-web-and-network.md)
