# Control algorithm

The exact rules behind "it heats and cools". Written so a reader can predict what the controller will
do, and so a reader who changes constants knows what they are changing.

---

## 1. The tick

Once per second, in this order:

1. read the sensors (filters, staleness, retries),
2. run the state machine for the current mode,
3. drive the outputs.

Everything below happens inside that one-second tick. There is no separate control task.

---

## 2. The two-stage structure

```
beer error ──► PID ──► fridge setpoint ──► hysteresis ──► relays
```

**Stage one** runs only in the beer modes (`b`, `p`). It converts "the beer should be 18.0" into "the
fridge should be 16.5".

**Stage two** runs in every active mode. It compares the fast-filtered fridge reading against that
setpoint plus an idle band and decides heating, cooling, or nothing.

In fridge mode (`f`) stage one is bypassed: the fridge setpoint is what you typed.

---

## 3. Stage one: the PID

```
beerDiff  = beerSet − beerSlowFiltered
beerSlope = slope of the beer reading, °C per hour

p = Kp × beerDiff
i = Ki × integral
d = Kd × beerSlope

fridgeSet = clamp(beerSet + p + i + d, lower, upper)
```

where the clamp bounds are:

```
lower = (beerSet ≤ tempSetMin + pidMax) ? tempSetMin : beerSet − pidMax
upper = (beerSet ≥ tempSetMax − pidMax) ? tempSetMax : beerSet + pidMax
```

### The integrator is not a textbook integrator

Three details differ from what a generic PID guide would tell you:

1. **It ticks every 61 seconds**, not 60. The counter increments each second and fires when it
   reaches 60, which takes 61 calls.
2. **It only integrates while the state is exactly Idle.** During heating or cooling it freezes.
3. **It has five anti-windup rules**:

| Condition | Effect on the integral |
|---|---|
| state is not Idle | frozen |
| absolute error ≥ `iMaxErr` | bled by −1/8 per tick |
| same sign, and the output is saturated high or low | blocked |
| same sign, and the fast fridge reading is more than 2 °C past the setpoint | blocked |
| opposite sign | double the change |

The practical result: the integrator removes a slow standing offset, and refuses to grow while the
output cannot act on it.

### Kd is negative on purpose

The default is −1.5. The derivative term is a **braking** term: when the beer is rising, it lowers the
fridge target so the controller stops pushing. A positive Kd would accelerate the approach and
overshoot.

### Filters

`beerSlowFiltered` and `readSlope()` come from a cascade of three filters per probe: fast, slow and
slope. Their coefficients are the six `*Filt` fields in Advanced settings. Changing them changes both
the noise and the delay of everything downstream, which is why they are behind the risk
acknowledgement.

---

## 4. Stage two: hysteresis

```
cooling starts when  fridgeFast > fridgeSet + idleRangeHigh
heating starts when  fridgeFast < fridgeSet + idleRangeLow
```

Defaults: `idleRangeHigh` = +1.0 °C, `idleRangeLow` = −1.0 °C. Between the bands, nothing runs. That
is the Idle state, and it is where the controller spends most of its time.

Two extra guards use half a sensor bit (about 0.03 °C) to avoid flapping exactly on a threshold.

### The timer states

```
COOLING ──(min cool time elapsed AND fridge at/below band)──► COOLING_MIN_TIME ──► IDLE
IDLE ──(min idle elapsed)──► can start again
HEATING ──mirror image──► HEATING_MIN_TIME ──► IDLE
```

And the dead time: after a heat cycle, cooling cannot start for `mutexDeadTime` (600 s), and vice
versa. That single number explains most "why is it waiting" questions.

| Constant | Default | Protects |
|---|---|---|
| `minCoolTime` | 180 s | the compressor |
| `minHeatTime` | 5 s | the element |
| `minCoolIdleTime` | 300 s | restart frequency |
| `minHeatIdleTime` | 120 s | restart frequency |
| `mutexDeadTime` | 5 s | heat↔cool transition |
| `maxHeatTime` | 50 s | runaway heating |
| `staleSensorSec` | 4 s | trusting a frozen probe |
| `oneWireRetryCount` | 1 | transient bus errors |

The shipped timing set is tuned for a two-zone cabinet, not for a generic fridge: short heater pulses
with a wide cooler band. The cooler keeps a full 300 s idle before restarting, because restart
frequency is what kills a compressor — the wide band already makes restarts rare, and the timer is
the guarantee. The one value to watch is `mutexDeadTime`, which is 5 s: in the classic PID modes
that field closes the heat-to-cool transition, and 5 s is not enough separation for a compressor.
Raise it to 600 s if you use those modes.

---

## 5. Peak estimation

After the relay opens, the fridge keeps moving. The controller predicts the overshoot:

```
estimated peak = fridgeNow + estimator × min(maxTimeForEstimate, idleTime) / 3600
```

and starts the *next* cycle early if the estimated peak will cross the target band. The estimator is a
rate of change per hour, learned per direction (heating and cooling separately).

The two threshold fields:

- `heatingTargetUpper` / `coolingTargetLower` — when to cut the current cycle,
- `heatingTargetLower` / `coolingTargetUpper` — where a cycle is considered finished.

The estimator then self-tunes:

| Situation | Adjustment |
|---|---|
| the peak overshot | estimator decreased by 17–33 % |
| the peak undershot | estimator increased by 20–50 % |

The estimators are persisted, so they survive a reboot and improve across batches.

---

## 6. Independent mode

No PID. Two thermostats:

```
COOLER: probe = fridge fast
        on  when fridgeFast > fridgeSet + coolTargetUpper      (+2.5 °C)
        off when fridgeFast ≤ fridgeSet + coolTargetLower      (−2.0 °C)

HEATER: probe = beer fast
        on  when beerFast < beerSet + heatTargetLower          (−0.051 °C)
        off when beerFast ≥ beerSet + heatTargetUpper          (+0.051 °C)
```

The same `heatTarget*` / `coolTarget*` fields are used, but here they are the on/off bands. In the PID
modes they are estimator thresholds. **One field, two meanings** — the single most confusing thing in
the configuration.

Timers:

- the cooler honours `minCoolTime` while on and `minCoolIdleTime` before restarting,
- the heater mirrors that with the heat equivalents,
- **`mutexDeadTime` is not used**, so both outputs can be on at once (state 11).

Disabling a zone is done by clearing its setpoint, not by a flag. The interface sends `null`.

---

## 7. The heater pulse PI

Active only in independent mode with the switch on, and only for heating. It does **not** use `Kp`,
`Ki`, `Kd`, `pidMax` or `iMaxError`; those belong to the beer→fridge cascade.

### Layer 1: duty

```
err  = beerSet - beerSlow
duty = clamp(indKp*err + indKi*∫err, 0, 50 %)
```

The integral is accumulated in seconds and clamped at ±25 °C·min. Integration is frozen when the
output is saturated in the same direction, against the 50 % ceiling (not 100 %). No derivative: at
1/16 °C quantisation it is noise.

### Layer 2: pulse train

```
onTime  = learned, clamped to [minHeatTime, maxHeatTime or 300 s]
offTime = onTime*(100 - duty)/duty, clamped to [minHeatIdleTime, 6 h]
```

Both `onTime` and `offTime` are recomputed every second from the current duty, so a growing error
shortens the pending gap. A pulse never exceeds **300 s**, whatever `maxHeatTime` holds.

### Approach vs hold

`guard = clamp(1.25 × measured coast, 1.5 sensor steps, 0.5 °C)`

- **Approach** (`err > 2×guard`): the pulse is cut when `beerSlow ≥ set − guard`.
- **Hold**: the beer sawtooths inside `set ± amp/2`; the pulse is cut at the upper edge and the next
  one starts at the lower edge, so the time-average sits on the setpoint.

### Learning

After each cut the slow filter is watched until three consecutive declining samples (or 40 min):

- `coast = peak − tempAtCut`
- `amp   = peak − cycleMin`
- next `onTime` is rescaled by `0.4 × (indPulseLsb/amp − 1)`

Peak tracking runs alongside the idle gap, so learning never delays the next pulse.

### Safety

The heater is cut whenever the fast beer reading reaches `set + 0.25 °C`, regardless of phase.

### Everything is RAM

Every field is reset by: a reboot, a mode change, the heater becoming unavailable, disabling the
switch, and the debug page's reset command. The three constants (`indKp`, `indKi`, `indPulse`) are
persisted in EEPROM with the other control constants.

---

## 8. Units and precision

- Internally: Celsius, fixed point with 9 fraction bits (1/512 °C), range −16…112 °C.
- Display: `tempFormat`, either `C` or `F`, converted at the boundary.
- Profiles: stored in hundredths of a degree in the profile's own unit, converted when the profile's
  unit differs from the live unit.
- JSON: setpoints and temperatures in hundredths on the flat protocol, decimal in `/getstatus`.

The 1/512 step is finer than the sensor resolution (0.0625 °C for a DS18B20), so the fixed point never
limits accuracy.

---

## 9. What can go wrong, in algorithm terms

| Symptom | Mechanism |
|---|---|
| oscillates slowly | integrator too strong, or idle bands too narrow |
| overshoots on start | estimator not yet learned, or minimum cooling time too long |
| never reaches target | `pidMax` clamps the fridge setpoint too close to the beer setpoint |
| long stalls | dead time, or a saturated `pidMax` |
| heats and cools alternately | independent mode with overlapping bands |
| integrator windup look | the bled integral is still large after a long excursion |

---

## 10. Changing constants safely

1. Write down the current values.
2. Change **one** number.
3. Let it run for at least three cycles.
4. Look at the log afterwards, not the live numbers — the log has state changes with timestamps.
5. Revert if it is worse.

The two numbers that most often need changing in a real build are `deadTime` (compressor protection)
and the idle bands (cycle frequency). The PID constants rarely need touching.

---

## Next

- [Profiles](06-profile-engine.md) — how the setpoint is chosen when a ramp is active
- [Control problems](../troubleshooting/02-control-problems.md)
