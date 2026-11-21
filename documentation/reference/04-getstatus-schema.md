# `/getstatus` schema

One read-only JSON document, grouped by what the values describe. It is the recommended integration
point: a single request, no authentication, no WebSocket.

```
GET http://<device>/getstatus
```

---

## 1. Shape

```json
{
  "mode": "b",
  "state": 0,
  "temperature": {
    "beer": 18.4, "beerSet": 18.0,
    "fridge": 17.2, "fridgeSet": 16.5,
    "room": 19.5, "unit": "C"
  },
  "control": {
    "heaterSet": null,
    "heaterActive": false, "heaterPassive": true,
    "coolerActive": false, "coolerPassive": true
  },
  "sensors": {
    "beer":   { "connected": true, "lastUpdate": 1790000000 },
    "fridge": { "connected": true, "lastUpdate": 1790000000 },
    "room":   { "connected": false, "lastUpdate": null }
  },
  "gravity": {
    "enabled": true, "device": "iSpindel", "plato": false,
    "og": 1.052, "sg": 1.014,
    "attenuation": 73, "abv": 5.1,
    "temperature": 19.5, "angle": 25.4,
    "rssi": -62, "battery": 3.95, "batteryPercent": 62, "batteryUnit": "V",
    "lastUpdate": 1790000000
  },
  "system": {
    "uptime": 3600, "lastRestartReason": "power_on", "resetCount": 3,
    "clock":   { "synced": true, "time": 1790000000,
                 "localTime": "2026-11-03 08:12:33", "timezoneOffset": 10800 },
    "heap":    { "free": 120000, "minFree": 90000, "largestBlock": 60000,
                 "allocatedBlocks": 500, "freeBlocks": 40 },
    "storage": { "totalBytes": 589824, "usedBytes": 120000, "freeBytes": 469824 },
    "wsClients": 1
  },
  "scale": [ { "id": 0, "measureGrams": 16400, "remainingLiters": 12.27 } ],
  "settings": {
    "tempFormat": "C", "tempSetMin": 1.0, "tempSetMax": 30.0, "pidMax": 10.0,
    "Kp": 5.0, "Ki": 0.25, "Kd": -1.5, "iMaxErr": 0.5,
    "idleRangeH": 1.0, "idleRangeL": -1.0,
    "heatTargetH": 0.299, "heatTargetL": -0.199,
    "coolTargetH": 0.199, "coolTargetL": -0.299,
    "maxHeatTimeForEst": 600, "maxCoolTimeForEst": 1200,
    "minCoolTime": 180, "minCoolIdleTime": 300,
    "minHeatTime": 180, "maxHeatTime": 0, "minHeatIdleTime": 300, "deadTime": 600,
    "fridgeFastFilt": 1, "fridgeSlowFilt": 4, "fridgeSlopeFilt": 3,
    "beerFastFilt": 3, "beerSlowFilt": 4, "beerSlopeFilt": 4,
    "lah": 0, "hs": 0, "hysteresisMode": 0,
    "staleSensorSec": 20, "oneWireRetryCount": 2,
    "indKp": 20.000, "indKi": 8.000, "indPulse": 1.000
  }
}
```

---

## 2. Top level

| Field | Type | Meaning |
|---|---|---|
| `mode` | string | one character: `o` off, `b` beer, `f` fridge, `p` profile, `i` independent, `t` test |
| `state` | number | the control state machine's current state |
| `scale` | array | one object per **configured** keg |
| `settings` | object | the control constants, i.e. what the advanced settings dialog edits |

### State numbers

| Value | State |
|---|---|
| 0 | Idle |
| 1 | Off |
| 2 | Door open |
| 3 | Heating |
| 4 | Cooling |
| 5 | Waiting to cool |
| 6 | Waiting to heat |
| 7 | Waiting for peak detection |
| 8 | Cooling, minimum time |
| 9 | Heating, minimum time |
| 11 | Heating and cooling (independent mode) |

---

## 3. `temperature`

All values are in the controller's configured unit, and `unit` says which. A sensor with no valid
reading yields `null`, never a sentinel number.

| Field | Meaning |
|---|---|
| `beer` | beer probe |
| `beerSet` | current beer target (`null` in fridge mode) |
| `fridge` | fridge probe |
| `fridgeSet` | fridge target; in beer mode this is the **PID output** |
| `room` | room probe or network-published value |
| `unit` | `C` or `F` |

---

## 4. `control`

| Field | Meaning |
|---|---|
| `heaterSet` | the heater target, only meaningful in independent mode; `null` otherwise |
| `heaterActive` | the heater output is energised now |
| `heaterPassive` | a heater is configured but not energised |
| `coolerActive` | the cooler output is energised now |
| `coolerPassive` | a cooler is configured but not energised |

`Passive` distinguishes "there is an actuator and it is off" from "there is no actuator at all". A
build with no cooler assigned reports `coolerPassive: false`, which is what a monitoring system needs
to know.

---

## 5. `sensors`

One object per logical sensor:

| Field | Meaning |
|---|---|
| `connected` | has this sensor ever produced a valid reading since boot |
| `lastUpdate` | epoch seconds of the last valid reading, or `null` |

`lastUpdate` is `null` when the sensor never read **or** when the clock is not synchronised — the
controller will not invent a timestamp.

`connected: true` with an old `lastUpdate` means the probe answered earlier and has since gone quiet;
the control loop treats it as valid for `staleSensorSec` seconds (20 by default) after the last
reading.

---

## 6. `gravity`

The same values the dashboard card shows.

| Field | Type | Meaning |
|---|---|---|
| `enabled` | bool | a hydrometer is configured |
| `device` | string | `iSpindel`, `Tilt`, `Pill`, or a generic label |
| `plato` | bool | the controller is configured for Plato |
| `og` | number / null | original gravity, always as SG |
| `sg` | number / null | current gravity, always as SG |
| `attenuation` | int / null | percent |
| `abv` | number / null | percent by volume |
| `temperature` | number / null | the hydrometer's own temperature, converted to the display unit |
| `angle` | number | tilt angle or raw value, device-dependent |
| `rssi` | int / null | signal strength; `null` when the value never arrived |
| `battery` | number / null | volts for an iSpindel, percent for a Pill |
| `batteryPercent` | int / null | estimated state of charge |
| `batteryUnit` | string | `V` or `%` |
| `lastUpdate` | epoch / null | last report |

Values are `null` rather than omitted, so a consumer can distinguish "no data" from "field unknown to
this firmware".

Gravity is only reported when it is in the plausible range; an out-of-range device reading is dropped
before it reaches this document.

---

## 7. `system`

| Field | Meaning |
|---|---|
| `uptime` | seconds since boot |
| `lastRestartReason` | why the device started |
| `resetCount` | consecutive resets without a power cycle |
| `clock.synced` | NTP or browser time has been applied |
| `clock.time` | epoch seconds |
| `clock.localTime` | formatted local time |
| `clock.timezoneOffset` | seconds east of UTC |
| `heap.free` | current free heap |
| `heap.minFree` | lowest free heap seen since boot |
| `heap.largestBlock` | largest allocatable block |
| `heap.allocatedBlocks` | heap block count in use |
| `heap.freeBlocks` | free heap block count |
| `storage.totalBytes` | filesystem size |
| `storage.usedBytes` | used |
| `storage.freeBytes` | free |
| `wsClients` | connected WebSocket clients |

`lastRestartReason` values: `power_on`, `software`, `panic`, `int_wdt`, `task_wdt`, `wdt`,
`deep_sleep`, `brownout`, `sdio`, `unknown`.

The heap and storage block replaces the removed `/fs` endpoint, and the storage figures are what you
check before starting a long log.

---

## 8. `scale`

One entry per configured keg:

| Field | Meaning |
|---|---|
| `id` | slot number |
| `measureGrams` | the last long measurement, or `null` |
| `remainingLiters` | beer remaining, or `null` when the keg is absent or the scale is uncalibrated |

The lean block is deliberate: the dashboard only needs these three values, and the full scale state is
on `GET /scale`.

---

## 9. `settings`

The control constants — everything the **Advanced settings** panel on the config page edits. They are
the same names, units and decimal places as the WebSocket `C` response (`PiLink::jsonOutputCCMap`), so a
client that already parses `C` can read this block with the same field names.

| Field | Unit | Meaning |
|---|---|---|
| `tempFormat` | `C` / `F` | display and setpoint unit |
| `tempSetMin`, `tempSetMax` | ° | allowed setpoint range |
| `pidMax` | ° | cap on the PID output (the fridge setpoint offset) |
| `Kp`, `Ki`, `Kd` | — | PID gains |
| `iMaxErr` | ° | clamp on the error that feeds the integrator |
| `idleRangeH`, `idleRangeL` | ° | classic modes: cool / heat start offsets around the setpoint |
| `heatTargetH`, `heatTargetL` | ° | classic: peak-estimator thresholds; independent: heater on/off bands |
| `coolTargetH`, `coolTargetL` | ° | the same, for the cooler |
| `maxHeatTimeForEst`, `maxCoolTimeForEst` | s | how long the peak estimator watches |
| `minCoolTime`, `minHeatTime` | s | minimum on-time |
| `minCoolIdleTime`, `minHeatIdleTime` | s | minimum off-time |
| `maxHeatTime` | s | maximum heater on-time, `0` = unlimited |
| `deadTime` | s | wait after a state change before the estimator is trusted |
| `fridgeFastFilt`, `fridgeSlowFilt`, `fridgeSlopeFilt` | — | fridge filter `b` values |
| `beerFastFilt`, `beerSlowFilt`, `beerSlopeFilt` | — | beer filter `b` values |
| `lah` | 0/1 | light used as heater |
| `hs` | 0/1 | rotary encoder half steps |
| `hysteresisMode` | 0/1 | independent mode: `1` enables the heater pulse PI |
| `indKp` | %/degC | pulse-PI proportional gain (independent heater) |
| `indKi` | %/(degC*min) | pulse-PI integral gain (independent heater) |
| `indPulse` | sensor steps | ripple target of one pulse, 1 step = 0.0625 degC |
| `staleSensorSec` | s | how long the last good reading is held after a failed read |
| `oneWireRetryCount` | — | extra attempts after a failed 1-Wire read |

Temperature **differences** (`pidMax`, `iMaxErr`, the bands and the targets) carry three decimals;
absolute temperatures (`tempSetMin`, `tempSetMax`) carry one. Both are the internal 1/512 °C steps
rounded for display, so a value you read back can differ from what was written in the last digit.

This block is read-only. Writing it means the WebSocket `C` command or the advanced settings dialog —
there is no HTTP endpoint for it.

---

## 10. Compatibility notes

- **This schema is newer than the flat one.** Older integrations that read `beerTemp`, `fridgeSet` or
  `lastRestartReason` at the top level must move to the grouped paths.
- **Fields are stable names**, but new groups or new members may be added. A consumer should ignore
  unknown keys.
- **Nulls are meaningful.** Treating `null` as zero is the most common integration bug: a `null`
  `fridge` means "no reading", not 0 °C.
- **No authentication.** Anything that can reach the device can read this.

---

## 11. Polling advice

| Need | Interval |
|---|---|
| dashboard mirror | 5 s (or use the WebSocket) |
| home automation | 15–60 s |
| logging to an external system | 60 s, matching the brew log |

Each request allocates a JSON document and serialises it, so a one-second poll from several clients is
wasteful on this hardware. Once a minute is plenty for anything except a live mirror.

---

## Next

- [HTTP API](02-http-api.md) — the write endpoints
- [Diagnostics](12-diagnostics.md) — how to read the system block
