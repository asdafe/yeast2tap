# Device model

Sixteen slots, a function and a hardware class per slot, and a JSON attribute alphabet inherited from
BrewPi. This page is the data model behind the Device Setup page.

---

## 1. The slot

```
struct DeviceConfig {
    uint8_t chamber;          // 0 = none, 1 = the first chamber
    uint8_t beer;             // 0 = none, 1 = the first beer
    DeviceFunction  deviceFunction;
    DeviceHardware  deviceHardware;
    union {
        bool     invert;
        bool     deactivate;
        uint8_t  pinNr;
        uint8_t  pio;
        int8_t   calibration;
        uint8_t  humiditySensorType;
        uint8_t  address[8];
    } hw;
};
```

The union is packed: several members share bytes, because a slot only ever needs one of them. `pio` and
`calibration` in particular share a byte — a DS2413 channel number and a temperature calibration are
never needed at once.

**Sixteen slots.** `MAX_DEVICE_SLOT` is exactly the array length, so slot 16 does not exist.

---

## 2. Functions

| Value | Name | Type | Target |
|---|---|---|---|
| 1 | Chamber Door | switch input | door sensor |
| 2 | Chamber Heater | actuator | heater output |
| 3 | Chamber Cooler | actuator | cooler output |
| 4 | Chamber Light | actuator | light output |
| 5 | Chamber Temp | temperature sensor | **fridge probe** |
| 6 | Chamber Room Temp | temperature sensor | room probe |
| 7 | Chamber Fan | actuator | fan output |
| 8 | Chamber Humidity | environment sensor | chamber RH |
| 9 | Beer Temp | temperature sensor | **beer probe** |
| 10 | Beer Temp 2 | temperature sensor | **no target** |
| 11 | Beer Heat | actuator | **no target** |
| 12 | Beer Cool | actuator | **no target** |
| 13 | Beer SG | – | no device |
| 14 | Beer Capper | actuator | spunding valve |
| 15 | PTC Cool | actuator | glycol cooler |
| 16 | Chamber Humidifier | actuator | humidifier |
| 17 | Chamber Dehumidifier | actuator | dehumidifier |
| 18 | Chamber Room Humidity | environment sensor | room RH |

The three "no target" entries exist in the enum and appear in the interface choices, but have no
destination in the runtime, so they cannot be installed successfully. Multi-beer control is not
implemented; only chamber 1 and beer 1 are reachable.

---

## 3. Hardware classes

| Value | Class | Physical part |
|---|---|---|
| 0 | none | empty slot |
| 1 | pin | a bare GPIO: relay, SSR, switch, DHT data pin |
| 2 | 1-Wire temp | **DS18B20** |
| 3 | 1-Wire PIO | **DS2413**, two channels, **output only** |
| 5 | external sensor | a temperature published over HTTP |
| 6 | environment temp | the temperature channel of a DHT |
| 7 | BME280 | I²C, **not compiled in this build** |
| 8 | BTHome humidity | BLE, **not compiled in this build** |
| 9 | BTHome thermometer | BLE, **not compiled in this build** |
| 10 | RAPT thermometer | BLE, **not compiled in this build** |

Class 4 is a gap in the enum, not a missing feature.

The "not compiled" entries exist in the interface but produce no working device in the `esp32`
environment, because `SupportBTHomeSensor` and `EnableBME280Support` are off there.

---

## 4. The JSON attribute alphabet

The `U{...}` command and the `d:` reply use single letters.

| Letter | Field | Meaning |
|---|---|---|
| `i` | id | slot number |
| `c` | chamber | chamber index |
| `b` | beer | beer index |
| `f` | function | the function enum |
| `h` | hardware | the hardware enum |
| `p` | pin | GPIO number, bus pin, I²C address, or 0/1 selector |
| `x` | invert | output polarity |
| `d` | deactivate | device is disabled |
| `a` | address | 8-byte 1-Wire ROM, or a 6-byte BLE MAC |
| `n` | pio | DS2413 channel |
| `j` | calibration | temperature offset, in 1/16 of a degree |
| `s` | humidity type | DHT model or BLE broadcast format |
| `v` | value | a live reading, reply only |
| `t` | type | the derived device type, reply only |
| `w` | write | used by the camera-light toggle |

**Omitted attributes keep the slot's previous value.** That is a deliberate design and the reason a
partial `U{...}` updates one field instead of rebuilding the device. It also means a backup that omits
a field does not clear it on the same device.

---

## 5. Validation

`isDeviceValid` checks five things:

1. chamber index within range,
2. beer index within range,
3. function within range,
4. the owner matches — a beer function needs a beer index, a chamber function needs a chamber,
5. the hardware class is assignable for that function.

Plus: a 1-Wire device must name a valid bus pin.

**What is deliberately not checked** (each is marked as unfinished work in the source):

- duplicate functions per chamber or beer,
- GPIO uniqueness across devices,
- 1-Wire address uniqueness,
- DS2413 address + channel uniqueness.

That is why the interface warns and the firmware accepts. It is also why a duplicate assignment can
produce two devices fighting over one relay.

---

## 6. The pin model

| Signal | Where it comes from |
|---|---|
| actuator candidates | a fixed list of pins, index 0–6 |
| sensor candidates | the door pin only |
| 1-Wire bus | the single fixed bus pin |
| scale pins | per scale, validated separately |

The legacy AVR pin enumerator (`heatingPin`, `coolingPin`) is still compiled in but nothing on ESP32
consults it. Device pins are whatever the slot says.

---

## 7. Install and uninstall

**Install**: build the object, wire it into the runtime global for that function, store the config.

**Uninstall**: switch the actuator **off** first, delete the object, restore the default placeholder.

That order matters — deleting an actuator without switching it off leaves the pin at its last level,
so a heater stays on with nothing controlling it. It is a one-line difference that was worth fixing.

---

## 8. The camera-light toggle

`d` with `{"id":-2,"write":1}` toggles the camera light through the device list command. It is an
undocumented corner of the protocol, and it means `d` is not strictly a read command.

---

## 9. What a device backup contains

`device.json` captures, per slot: `i c b f h p` always, plus `a x j s d n` where the hardware type
makes them meaningful.

What it does not capture: nothing device-related. The omissions are in the *scale* block, not here.

Restoring onto a **different** board is where the conditional attributes matter: a DS18B20's address
travels, so the sensor is found again; a BLE MAC travels for a Pill but not for every sensor type in
this build; a pin number travels and may not be free on the new board.

---

## 10. Common mistakes

| Mistake | Effect |
|---|---|
| assigning two devices to one GPIO | both act on the same pin |
| using a flash pin | the board stops booting |
| assigning the heater as "Chamber Light" | it only heats if "light as heater" is set |
| expecting `Beer Temp 2` to work | no destination in the runtime |
| assuming a BTHome sensor will appear | not compiled in this build |
| leaving polarity wrong | the relay works backwards |

---

## Next

- [Devices](../user/06-devices.md) — the page
- [Wiring and pins](../install/02-wiring-and-pins.md) — the pin rules
