# Wiring and pins

The firmware has two very different attitudes to pins, and knowing which is which saves hours:

- **Scale pins are validated by the firmware.** A reserved or duplicated pin makes the save fail
  with an error.
- **Device pins are not validated by the firmware at all.** The Device Setup page warns you, but it
  will happily save a heater on a flash pin, and the board then fails to boot.

This page lists the rules, where they come from, and the safe choices.

---

## 1. Fixed pins

These are compiled in and cannot be changed from the interface.

| Signal | GPIO | Notes |
|---|---|---|
| I²C SDA | 21 | LCD / OLED / BME280 |
| I²C SCL | 22 | |
| 1-Wire bus | 23 | every DS18B20 and DS2413 shares it |
| Buzzer | 4 | optional |
| Door switch | 34 | optional, input only |
| Rotary encoder A / B / switch | 13 / 14 / 18 | optional, enabled by default on ESP32 |
| Pressure ADC | 36 | optional, ADC1 only; ADS1115 alternative on I²C |

---

## 2. Pins that must never be used for a device

| GPIO | Why |
|---|---|
| 6, 7, 8, 9, 10, 11 | connected to the SPI flash; using them bricks the boot |
| 1, 3 | UART0, used by the USB serial console |
| 0, 2, 5, 12, 15 | boot-strapping; a relay holding one of these at the wrong level prevents boot |
| 34, 35, 36, 39 | input only — usable as a sensor input, never as an output |

The first four rows are fatal. The fifth is a design constraint, not a fault.

**The firmware does not block any of these for devices.** If you assign a heater to GPIO 6, the save
succeeds and the board stops booting. The Device Setup page shows a warning chip next to the pin
selector; treat it as binding.

---

## 3. What the interface offers for a device pin

The device pin chooser offers:

```
0 1 2 3 4 5 12 13 14 15 16 17 18 19 21 22 23 25 26 27 32 33 34 35 36 39
```

…and marks 34, 35, 36 and 39 as "input only". It also shows contextual warnings:

- boot pin (0, 2, 5, 12, 15)
- serial / USB (1, 3)
- input only (34, 35, 36, 39)
- the fixed 1-Wire pin (23)
- the I²C pins (21, 22)
- the rotary-encoder pins (13, 14, 18)
- the pins the scale defaults suggest (25, 26, 27, 33)

A pin already used by another device on the page is flagged too, but only as a warning — duplicate
assignment is not rejected anywhere in the firmware.

**Practical rule:** pick from 16, 17, 19, 25, 26, 27, 32, 33 and avoid anything that is already
spoken for. That set is large enough for a heater, a cooler, a fan and a light with room to spare;
25/26 and 27/33 are also the two keg-scale defaults, so leave them alone if you want scales.

---

## 4. Scale pins are validated — this is the strict path

The Scale section on Device Setup offers a different, filtered list. The firmware rejects:

| Rule | Behaviour |
|---|---|
| GPIO outside 0–39 for DOUT, or above 33 for SCK | save rejected |
| DOUT equal to SCK on the same scale | save rejected |
| a pin already used by another scale | save rejected |
| any pin in the reserved list below | save rejected |
| capacity below 1 L, or density outside 0.8–1.3 kg/L | save rejected |

Reserved for scales:

```
0 1 2 3 5 6 7 8 9 10 11 12 15 20 21 22 23 24 28 29 30 31 37 38
```

Plus, **when the rotary encoder is enabled** (the default on ESP32): **13, 14, 18** — the encoder's
pins come from `rotaryAPin` / `rotaryBPin` / `rotarySwitchPin` in `src/Config.h`, so a custom build
that moves them blocks the moved pins instead.

Input-only pins 34, 35, 36, 39 are offered for DOUT but not for SCK, because SCK has to drive the
line.

---

## 5. The two keg scales and the encoder

The two scale defaults are **25/26 for scale 1 and 27/33 for scale 2**, and they are usable as
shipped: the rotary encoder was moved off 25/32/33 to **13/14/18** precisely so both scales fit
without re-wiring.

- The Device Setup page offers 25/26/27/33 for scales and greys out the encoder pins.
- A scale saved on GPIO 13, 14 or 18 is rejected: those belong to the encoder.
- `rotaryAPin`, `rotaryBPin` and `rotarySwitchPin` are `#ifndef`-guarded in `src/Config.h`, so a
  custom board can move the encoder from `platformio.ini` (e.g. `-DrotaryAPin=5`) without editing
  the source; the scale validation follows whatever the build uses.

The rejection message names the pin and the reason, for example
`gpio 13 is reserved by the rotary encoder`, and the Device Setup alert shows it.

If the encoder is not fitted at all, build with `-DBREWPI_ROTARY_ENCODER=0`; the three pins then
become ordinary free GPIOs and can host a third and fourth scale.

---

**Figure:** [A scale row on Device Setup, showing the DOUT/SCK selectors and the suggested default pins] `"YT-065-scale-pin-hints.png"`

The hint text next to each selector is where the 25/26 and 27/33 suggestions come from. Read it as a
suggestion, not a reservation — the firmware's own validation is the authority.

---

## 6. HX711 wiring

| HX711 pin | Connect to |
|---|---|
| VCC | 3.3 V (check your board: some are 5 V only) |
| GND | common ground with the ESP32 |
| DT / DOUT | the scale's DOUT GPIO |
| SCK | the scale's SCK GPIO |
| E+ / E− | load-cell excitation |
| A+ / A− | load-cell signal |

Two details from the driver:

- The firmware reads channel A at gain 128 by clocking 24 bits plus one gain pulse. It never drives
  a rate pin, so the chip runs at its default rate.
- Reading happens on **every pass of the main loop**, not on a timer. There is no interrupt, so a
  slow filesystem write simply delays the next sample.
- A saturated reading (the load cell beyond ±full scale) is discarded exactly like a missing one.

Keep the load-cell leads short and away from the mains side. The counts are microvolt-level.

---

## 7. Relay and SSR wiring

The controller output is a logic signal. Whether that signal switches a mechanical relay module, an
SSR, or a transistor is your decision, and the code only cares about polarity:

- Each actuator has an **inverted / not inverted** setting, because different boards switch on
  opposite levels.
- Heating and cooling should be on **different** outputs, and both must be able to be off at the
  same time.
- The fan output, if used, follows either heating or cooling — it is not separately controllable.

Never switch mains through a bare ESP32 pin. Use a proper relay/SSR with isolation.

---

## 8. Pressure transducer

Two options:

1. **On-board ADC**: analogue output into GPIO 36. This pin is ADC1, which is the only ADC bank that
   keeps working with Wi-Fi on.
2. **ADS1115** on the I²C bus at address 0x48, channel 0, with a selectable gain from ±6.144 V down
   to ±0.256 V.

The transducer's own output range decides which gain is correct. The Pressure page documents the
conversion as `psi = (adc − b) × a`, and both constants are produced by the two-step calibration.

---

## 9. A safe starting assignment

For a build with heating, cooling, two probes and one keg scale:

| Device | Function | Pin |
|---|---|---|
| DS18B20 #1 | Beer Temp | 1-Wire 23 (address-based) |
| DS18B20 #2 | Chamber Temp | 1-Wire 23 (address-based) |
| Relay 1 | Chamber Heater | 16 |
| Relay 2 | Chamber Cooler | 17 |
| HX711 | Scale 1 | DOUT 25, SCK 26 |
| HX711 | Scale 2 | DOUT 27, SCK 33 |

Leave 19 and 32 free for a fan or a light. GPIO 13, 14 and 18 belong to the rotary encoder.

---

## 10. ESP8266 builds

The same source also builds for the ESP8266 targets, and the wiring rules there are different enough
to deserve their own table. Their defaults come from `Config.h` (`BOARD == BrewShield`), not from the
ESP32 layout above.

| Signal | NodeMCU label | GPIO | Set by |
|---|---|---|---|
| 1-Wire bus | D6 | 12 | `oneWirePin` |
| Cooling relay | D5 | 14 | `coolingPin` |
| Heating relay | D7 | 13 | `heatingPin` |
| Buzzer | D0 | 16 | `BuzzPin` |
| Door switch | D8 (D4 when capping is off) | 15 (2) | `doorPin` |
| Up button | D3 | 0 | `UpButtonPin` |
| Down button | D4 | 2 | `DownButtonPin` |
| I²C SDA / SCL | D2 / D1 | 4 / 5 | fixed |

Three traps that only exist on this hardware:

- **GPIO 0, 2 and 15 decide the boot mode.** Pull GPIO0 and GPIO2 up and GPIO15 down, or the board
  can come up in the bootloader instead of running the firmware. A relay wired to one of them can
  hold the board in the wrong state at power-on.
- **GPIO 16 (D0) has no internal pull-up**, so a button there needs an external resistor.
- **A rotary encoder cannot be wired straight to the ESP8266.** Its positions hold GPIO0/2/15 in
  states that prevent boot. The supported workaround is a PCF8574 I²C expander
  (`RotaryViaPCF8574` / `ButtonViaPCF8574` in `Config.h`); the encoder also does not work with an
  OLED display.

The ESP8266 build has **two push buttons instead of an encoder**, enabled by default
(`BREWPI_BUTTONS 1` only when `ESP8266`). Their operation is in
[The dashboard](../user/02-dashboard.md#12-the-two-buttons-esp8266-builds).

---

## Next

- [Build from source](03-build-from-source.md)
- [First run](05-first-run.md) — where these assignments are made
- [Device model](../reference/08-device-model.md) — the enums and validation rules behind the page
