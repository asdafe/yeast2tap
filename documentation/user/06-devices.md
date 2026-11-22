# Devices

Every physical sensor, relay and switch the controller uses is assigned on one page. Nothing is
hard-wired at the factory, so this is the page that turns a blank ESP32 into a controller.

---

**Figure:** [The Device Setup page with a heater, a cooler and three probes assigned] `"YT-058-device-setup-full.png"`

---

## 1. The page in three parts

| Part | What it does |
|---|---|
| **Header actions** | refresh the hardware list, back up, restore, init/erase EEPROM |
| **Devices** | the assigned devices and the ones detected but unassigned |
| **Scales** | the HX711 keg-scale slots |

Refresh scans the 1-Wire bus and enumerates the candidate pins. It is safe to press at any time; it
does not save anything.

---

## 2. Slots and functions

There are **16 device slots**. A slot holds one thing: what it is, which hardware it is, and which
pin or address it uses.

**Functions** decide the role:

| Function | Type | Uses |
|---|---|---|
| Chamber Door | switch input | a door switch |
| Chamber Heater | actuator | the heating relay |
| Chamber Cooler | actuator | the cooling relay |
| Chamber Light | actuator | a light, or the heater output if "light as heater" is set |
| Chamber Temp | temperature sensor | the **fridge** probe |
| Chamber Fan | actuator | a fan, follows heating/cooling |
| Chamber Humidity | humidity sensor | chamber RH |
| Room Temp | temperature sensor | the ambient probe |
| Beer Temp | temperature sensor | the **beer** probe |
| Beer Capper | actuator | the spunding valve |
| PTC Cooler | actuator | the glycol-loop cooler |
| Humidifier / Dehumidifier | actuator | humidity control outputs |
| Room Humidity | humidity sensor | ambient RH |

Only **chamber 1** and **beer 1** are reachable, so multi-chamber builds are not supported even
though the slots exist.

Two functions in the enum have no destination and cannot be installed: a second beer sensor, and
per-beer heater/cooler outputs. If you add one, it will not appear as a working device.

---

## 3. Reading a device card

**Figure:** [An actuator card, fully expanded] `"YT-059-device-card-actuator.png"`

| Element | Meaning |
|---|---|
| Device number | the slot |
| Type chip | what the firmware classified it as |
| Live / Needs setup pill | whether it is installed and reading |
| **Function** | the role (see the table above) |
| **Device slot** | where it is stored |
| **Controller PIN** | only for user-added pin devices |
| chips (Type / GPIO / Address) | what the firmware sees |
| **Pin type** | inverted or not — for outputs |
| **Calibration** | an offset added to the sensor's reading |
| **Apply** / **Remove** | commit or free the slot |

A sensor card looks slightly different: the pin is replaced by the 1-Wire address, and the calibration
field is the prominent control.

**Figure:** [A 1-Wire sensor card: function, address, calibration, live value] `"YT-060-device-card-sensor.png"`

---

## 4. Adding a device

**Figure:** [The Add device picker with its three choices] `"YT-062-add-device-picker.png"`

Only three kinds can be created by hand:

- **Pin device** — a bare GPIO used as an input or an output,
- **Humidity sensor** — a DHT on a pin,
- **External sensor** — a temperature published over the network.

Everything else appears automatically when the hardware is present: DS18B20 sensors show up with
their addresses, DS2413 channels show up as two PIO outputs, and candidate actuator pins are listed by
the refresh.

**Figure:** [Installed devices above, detected-but-unassigned below] `"YT-063-detected-vs-installed.png"`

The counters ("N installed · M new") are the fastest way to see whether anything is waiting to be
assigned.

---

## 5. Pin warnings are not decoration

When you pick a pin, the page annotates the field with what that pin is already used for: boot pin,
serial, input only, the 1-Wire pin, the I²C pins, or the scale defaults. The warning appears as a small
chip under the selector and updates as soon as the choice changes, before any Apply.

The firmware does **not** validate device pins — it will save a heater on a flash pin and the board will
stop booting.

Duplicate pins are warned about and accepted. Two devices on one GPIO will fight.

Read [Wiring and pins](../install/02-wiring-and-pins.md) before assigning anything you are unsure of.

---

## 6. Polarity

Outputs have an **inverted / not inverted** setting. If a relay is energised when the controller says
it is off:

1. Do not rewire first.
2. Set the device to the opposite polarity.
3. Apply, and watch the relay click off.

Different relay boards switch on opposite logic levels, so this is a configuration step, not a fault.

---

## 7. Calibration offset

A temperature sensor can carry a small correction, in degrees, added to every reading. Use it when a
probe reads consistently high or low against a reference — not to compensate for a bad location.

Calibration on the sensor card is per device and stored with the device definition. It is included in
a device backup.

---

## 8. The Scales section

**Figure:** [Two configured scale rows] `"YT-064-scales-section.png"`

Each row: enable, scale name, beer-in-keg name, DOUT, SCK, live raw counts, and a remove button on
slots 2 and up. Up to eight scales.

The live value on this page is **raw HX711 counts**, not grams, even when the scale is calibrated.
Grams belong to the Scale page; this page is about wiring.

**Figure:** [The DOUT/SCK hints on a scale row] `"YT-065-scale-pin-hints.png"`

Scale pins *are* validated: reserved pins, equal DOUT/SCK, and reuse all fail the save with an error.

Calibration itself is on the Scale page — see [Keg scales](08-keg-scales.md).

---

## 9. Removing a device

Only user-added devices have a Remove button, and removing one frees the slot. Detected hardware
cannot be removed, only unassigned by setting its function to None.

Removing an actuator switches it **off** before detaching it, so a relay does not stay latched.

---

## 10. Init/Erase EEPROM

The red button wipes:

- control settings (mode, setpoints, estimators),
- control constants (PID, bands, filters, timers),
- **all device assignments**.

It keeps:

- Wi-Fi and system settings,
- scale settings and calibration,
- MQTT and remote logging,
- notes,
- scale history and brew logs.

After it finishes you get a confirmation and the page must be refreshed by hand — the device list on
screen is stale.

This is the tool for "start the hardware configuration over". It is not a factory reset, and it does
not touch your files.

---

## 11. Blocking overlay

While a refresh or a restore is running the page dims and blocks clicks. A refresh takes a second or
two because the 1-Wire bus has to be enumerated.

---

## Next

- [Hydrometers](07-hydrometers.md) — the other hardware page
- [Keg scales](08-keg-scales.md) — calibration and history
- [Device model](../reference/08-device-model.md) — the fields and validation rules
