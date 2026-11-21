# Control problems

The controller is not doing what you expect. Almost every case here is a timer, a mode, or a
misread sensor — not a broken relay.

---

## 1. It never heats or cools

Work through these in order.

| Check | Where |
|---|---|
| Is control actually enabled? | Control Mode, the switch **and** Apply |
| Is the mode the one you think? | the summary line at the top of Control Mode |
| Is the setpoint reachable? | if it is already satisfied, Idling is correct |
| Is the sensor reading valid? | Dashboard, the corresponding card |
| Is an actuator assigned? | Device Setup, a device with the Heater or Cooler function |
| Is a timer holding it off? | the status chip says "waiting" |

**Figure:** [The status chip in its idle, heating and cooling states] `"YT-010-status-states.png"`

The single most common cause: the switch was flipped but **Apply** was not pressed. The switch is a
pending change.

**Figure:** [The Apply footer] `"YT-032-control-disabled.png"`

---

## 2. "Waiting" for ten minutes

The dead time between heating and cooling is **600 seconds** by default. After a heating cycle the
cooler can stay off for up to ten minutes, even if the fridge is far above its target.

That is compressor protection, not a fault. If it is too long for your hardware, lower `deadTime` in
Advanced settings — but understand what it protects against first.

The other timers, for reference:

| Timer | Default |
|---|---|
| minimum heating / cooling time | 180 s |
| minimum idle before the same output restarts | 300 s |
| dead time between heat and cool | 600 s |

---

## 3. The heater runs but the beer does not warm

The heater is on and the beer temperature does not move. In order of likelihood:

1. **The heater output is not the heater.** Check which function the relay is assigned to; a light
   output does not heat.
2. **"Light as heater" is set.** In that configuration the heater output is never energised and the
   light output carries the heat demand.
3. **The polarity is inverted.** The relay clicks off when it should be on. Flip the device's
   inverted setting.
4. **The element is too small** for the chamber, or the chamber leaks.
5. **The beer probe is not in the beer** and is reading ambient air.

---

## 4. The fridge overshoots

Falling below the target after a cooling cycle is normal — the evaporator keeps pulling heat after the
relay opens. The controller predicts this and cuts early, using the estimator bands.

If overshoot is large:

- the estimator bands (`coolTargetL`, `heatTargetH`…) may be too wide,
- the fridge probe may be badly placed (it should be in the air, not strapped to the evaporator),
- the minimum cooling time may be forcing cycles that are too long.

Changing the estimator bands is Advanced settings territory; read
[Control algorithm](../reference/05-control-algorithm.md) first.

---

## 5. The fridge setpoint keeps changing

In Beer control, the fridge setpoint is **computed by the PID**, every second. It is not a setting.

**Figure:** [Beer control: the fridge setpoint is the PID output, and it moves on its own] `"YT-023-control-pid-beer-fixed.png"`

If you want a fixed fridge temperature, switch the controlled variable to **Fridge**.

---

## 6. A profile is not advancing

| Cause | Check |
|---|---|
| the mode is not a ramp mode | summary line |
| the start date is in the future | the profile editor's start field |
| a gravity condition never becomes true | is a hydrometer reporting? |
| a stability condition never becomes true | the window is longer than you thought |
| the profile already ended | it latches at the last step and stops |

Reboot note: after a restart, a gravity-conditioned step evaluates false because there is no gravity
yet, so the walk stops at that step. Time-based profiles resume correctly.

**Figure:** [The step table with its condition column] `"YT-027-profile-step-table.png"`

---

## 7. My manual setpoint change was reverted

A running profile re-asserts its target every 60 seconds. A manual change survives at most a minute.

Change the profile instead, or switch the setpoint source to Fixed.

---

## 8. It cycles too often

Short cycles wear a compressor. Check:

- **idleRangeH / idleRangeL** — too narrow is the usual cause. Defaults are ±1.0 °C.
- **minimum cooling time** — raise it if your compressor needs longer runs.
- **minimum idle time** — raise it to space the cycles out.
- **the probe is too close to the evaporator**, so it sees the coil rather than the air.

---

## 9. Independent mode: both outputs run at once

That is allowed by design — there is no dead time in Independent mode. If you do not want it, move the
two targets further apart than their bands.

The status chip shows "Heating and cooling" when it happens.

---

## 10. Independent mode: the cooler chases the beer temperature

Check the **Glycol Chilling** option in Settings. It installs the beer probe as the fridge sensor's
backup, so a failed fridge probe makes the fridge reading equal the beer reading — and in Independent
mode the cooler then follows the beer.

Unset the option if that is not what you want.

---

## 11. The heater pulse PI is not helping

Give it three or four cycles. The first pulse is deliberately short by design, and the learner is
reset by:

- a reboot,
- a mode change,
- the heater becoming unavailable,
- disabling the switch.

**Figure:** [The heater control section] `"YT-031-predictive-heater.png"`

Also check that the **beer probe** is the one the heater zone uses; the learner observes the beer
temperature.

---

## 12. A relay clicks continuously

One click per second is the sensor alarm, not control: when the beer probe is lost, the buzzer (or the
assigned alarm output) toggles once per second rather than latching.

If it is an actual control relay clicking at that rate, something is wrong with the probe assignment
or the reading is oscillating around a threshold — check the sensor first, the bands second.

---

## 13. Everything was fine and then the settings changed themselves

A settings reset, usually after a power cut. The settings file is written non-atomically; a cut during
the write leaves a truncated file, and the loader falls back to defaults.

The scale settings have their own recovery path and usually survive; device assignments, control
constants and profiles may not.

See [Persistence](../reference/07-persistence.md) and [Recovery](06-recovery.md).

---

## 14. What the logs will tell you

The brew log records state and mode changes as they happen, so a chart of the last few hours usually
shows whether the controller was cycling or idle while you were watching.

**Figure:** [The offline viewer showing state annotations on a log] `"YT-124-viewer-log.png"`

---

## Next

- [Control algorithm](../reference/05-control-algorithm.md) — the exact rules
- [Sensors and gravity](03-sensors-and-gravity.md) — if the readings themselves are suspect
