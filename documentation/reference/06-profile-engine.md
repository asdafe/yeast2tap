# Profile engine

The schedule that drives the setpoint. This page is the implementation: data model, evaluation order,
timers and the restart behaviour.

---

## 1. Data model

```
BeerTempSchedule {
    ScheduleStep steps[10];
    time_t  startDay;
    uint8_t numberOfSteps;
    char    unit;            // 'C' or 'F' the profile was written in
    uint8_t flags[8];        // packed switches
}

ScheduleStep {               // 12 bytes
    int16_t  temp;           // hundredths of a degree
    uint16_t days;           // hundredths of a day
    union { uint16_t sg; uint16_t attenuation; } gravity;
    struct { uint8_t stableTime; uint8_t stablePoint; } stable;
    uint8_t  attSpecified;
    char     condition;
}
```

`days` in hundredths gives a 0.01-day resolution, 14.4 minutes. There is no hours field anywhere.

### The packed flags

| Byte | Meaning |
|---|---|
| 0 | target: 0 beer, 1 fridge |
| 1 | independent heater follows the profile |
| 2 | start policy: 0 = set start to now on entering a ramp mode, 1 = keep `startDay` |
| 3 | latch: the profile has finished and its final temperature was applied |

---

## 2. When the engine runs

```
if (mode == 'p')                          run
else if (mode == 'f' && target == fridge) run
else if (mode == 'i' && heaterRamp)       run
else                                      do nothing
```

Then three early exits:

- the latch is set → do nothing until the mode is re-entered,
- less than 60 seconds since the last write → do nothing,
- the new target differs from the current one by less than 0.005 °C → do nothing.

That last pair is why a manual change survives up to a minute: the profile only re-asserts on its own
schedule, and only when the value actually moved.

---

## 3. Evaluation

Each pass:

1. Find the current step by walking from the start.
2. Ask the step whether it is finished.
3. If finished, advance; if the advance runs off the end, latch.
4. Otherwise compute the target for *now* (a ramp interpolates; a hold returns the step's temperature).
5. Write it, suppressing the side effects of a manual setpoint change.

### Walking the steps

```
timeEnterCurrentStep = startDay
for each step:
    if (timeEnterCurrentStep + step.duration <= now) and step.condition_is_satisfied:
        timeEnterCurrentStep += step.duration
        continue
    else:
        this is the current step
```

Note the conjunction: a step advances only when **both** its duration has elapsed and its condition
holds. A time-only step has an always-true condition; a gravity-only step has a zero duration.

---

## 4. Conditions

| Letter | Satisfied when |
|---|---|
| `t` | time only |
| `g` | gravity ≤ threshold |
| `s` | gravity stable for the window |
| `a` | time **and** gravity |
| `o` | time **or** gravity |
| `u` | time **or** stable |
| `v` | time **and** stable |
| `b` | gravity **or** stable |
| `x` | gravity **and** stable |
| `w` | time **and** gravity **and** stable |
| `e` | time **or** gravity **or** stable |
| `r` | ramp — no condition of its own, it interpolates |

### Gravity threshold forms

| Written as | Interpreted as |
|---|---|
| `1.010` | specific gravity |
| `2.5` with Plato enabled | degrees Plato |
| `75%` | attenuation against the original gravity |

The attenuation form is resolved at evaluation time from `OGPoints`, so correcting the OG later does
not invalidate a profile.

### Stability

Stable means: the gravity has moved by no more than `stablePoint` in the last `stableTime` minutes. The
values come from the step; the *default* comes from the gravity configuration's "stability threshold"
field, which is why that field exists on the Hydrometer Setup page even though it does not filter
anything.

Note: the same field does **not** influence gravity filtering. That is a documentation-level
distinction worth making, because the label suggests otherwise.

---

## 5. Ramps

A step with condition `r` is a transition, not a hold:

```
target(t) = prevTemp + (nextTemp − prevTemp) × (t − stepStart) / duration
```

`nextTemp` is the next non-ramp step. `prevTemp` is the previous non-ramp step. That is why an Easy
Ramp produces exactly three steps: a hold, a ramp, a hold.

A ramp step with zero duration is degenerate — avoid it.

---

## 6. End of profile

When the walk runs past the last step:

1. the last non-ramp step's temperature is applied **once**,
2. the latch flag is set and saved,
3. the engine stops touching the setpoint.

So a finished profile leaves the controller at the final temperature, and a manual change afterwards
sticks.

Leaving and re-entering a ramp mode clears the latch. If the start policy is "now", the start date is
also reset.

---

## 7. Restart behaviour

After a reboot:

- the mode is restored from the control settings,
- the profile is reconstructed by walking from `startDay`,
- **the gravity is invalid at boot**, so any gravity-conditioned step evaluates false and the walk
  stops there.

Two practical outcomes:

| Profile | After a reboot |
|---|---|
| time-only steps | resumes exactly |
| any gravity or stability step before the current position | restarts at the first such step |

That is not a bug to work around so much as a consequence of having no gravity at boot. If a batch
matters, prefer time-based steps until the gravity device has reported once.

---

## 8. Start policies

| Policy | Behaviour |
|---|---|
| "now" (default) | entering a ramp mode sets `startDay` to the current time |
| "keep" | the stored `startDay` is used, so a profile can be queued |

The distinction matters after a power cut: with "now", a reboot restarts the clock on the schedule.

---

## 9. Writing profiles from the API

`POST /tschedule` with `data=<json>`:

```json
{
  "s": 0,
  "v": 2,
  "u": "C",
  "t": [
    { "c": "t", "d": 400, "t": 1800 },
    { "c": "g", "d": 0,   "g": 1.020 },
    { "c": "r", "d": 300 },
    { "c": "t", "d": 200, "t": 400 }
  ],
  "tg": 0,
  "hr": 0,
  "sp": 0
}
```

| Key | Meaning |
|---|---|
| `s` | start epoch (0 = now) |
| `v` | format version |
| `u` | unit `C` or `F` |
| `t[]` | steps: `c` condition, `d` duration in hundredths of a day, `t` temperature in hundredths, `g` gravity, `s`/`x` stability |
| `tg` | target: 0 beer, 1 fridge |
| `hr` | independent heater follows the ramp |
| `sp` | start policy |

Ramp steps omit `t` — they interpolate from their neighbours.

Validation rejects unknown condition letters and durations that would overflow.

---

## 10. Where the profile lives

In the settings file, so it survives reboots and OTA updates, and it is included in the Settings
backup. A named profile saved with "Save as" is a separate file in the filesystem, listed by `/list`
and fetched by name.

---

## Next

- [Profiles and ramps](../user/04-profiles-and-ramps.md) — the user-facing view
- [Control algorithm](05-control-algorithm.md) — how the setpoint is used
