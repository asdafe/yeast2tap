# Control modes

Four modes are usable from the interface, and one more exists only for the serial protocol. This page
explains what each one does to the relays, and when to pick it.

---

**Figure:** [Control Mode, PID, beer control, fixed setpoint — the usual starting point] `"YT-023-control-pid-beer-fixed.png"`

---

## 1. The four modes

| Mode | What you set | What the controller does |
|---|---|---|
| **Off** | nothing | both relays off, no control |
| **Beer (PID)** | the beer temperature you want | computes the fridge temperature needed and holds it |
| **Fridge (PID)** | the fridge temperature you want | holds the fridge there; the beer follows |
| **Independent** | a heater target *and* a cooler target | two thermostats, each on its own probe |

Profile scheduling is a *source* for the setpoint, not a fifth mode: you can run beer control from a
fixed value or from a ramp, and the same for the heater in Independent mode.

---

## 2. Off

Turning the **Control enabled** switch off and pressing **Apply** puts the controller in Off.

What actually happens: both setpoints are cleared, both relays are released, and the state machine
falls to Idling. The displayed state is "Idling", not "Off" — a harmless quirk of the state machine,
worth knowing so you do not go looking for a broken mode indicator.

**Figure:** [The Apply footer: the switch and the button both matter] `"YT-032-control-disabled.png"`

**The switch alone does nothing.** It is a pending change until Apply is pressed. This is deliberate:
starting a compressor by accident is worse than an extra click.

---

## 3. Beer control (PID)

You set the beer temperature. Every second the controller:

1. measures how far the beer is from the target,
2. measures how fast it is moving,
3. computes the fridge temperature that will close that gap without overshooting,
4. holds the fridge at that computed value with a hysteresis loop.

The number you see in **Fridge Set** is step 3. It changes on its own. Editing it does nothing,
because it is recomputed immediately.

### What the three constants do

| Constant | Effect in practice |
|---|---|
| Kp | how hard it reacts to the current error |
| Ki | how it removes a slow, persistent offset |
| Kd | how much it brakes when the beer is already moving |

The defaults (5, 0.25, −1.5) suit a well-insulated fermentation fridge with a few litres of thermal
mass. The negative Kd is intentional: it is a braking term, not a mistake.

Do not tune these until you have read [Control algorithm](../reference/05-control-algorithm.md). The
integrator runs on a 61-second period and only while idling, so advice written for a generic PID does
not transfer directly.

**Figure:** [Advanced settings, upper half: the PID constants and limits] `"YT-055-advanced-settings-top.png"`

---

## 4. Fridge control (PID)

**Figure:** [PID with the fridge as the controlled variable] `"YT-024-control-pid-fridge-fixed.png"`

You set the fridge temperature and the controller holds it with a hysteresis loop. The beer reaches
whatever temperature that fridge produces — slower, and with no compensation for fermentation heat.

When to use it:

- cold crashing, where you want the chamber at a specific temperature,
- a chamber used for something other than beer,
- as a fallback when the beer probe is unavailable.

In this mode the beer probe is not required for control. A profile can also drive the fridge setpoint,
but that combination is labelled experimental: choosing it shows an **Experimental feature** chip on the
page and a confirmation dialog before Apply, warning that fridge ramps are still in testing.

---

## 5. How the relays are actually switched (both PID modes)

The PID does not switch anything. It only produces a fridge setpoint. A separate hysteresis stage
compares the fast-filtered fridge reading against that setpoint plus an idle band:

- **cooling starts** when the fridge rises above the setpoint by the upper idle band,
- **heating starts** when it falls below the setpoint by the lower idle band,
- between the bands, nothing runs.

Defaults are ±1.0 °C. They are the `idleRangeH` / `idleRangeL` fields in Advanced settings.

On top of that, four timers prevent short-cycling:

| Timer | Default | Purpose |
|---|---|---|
| minimum cooling time | 180 s | a compressor cycle must run at least this long |
| minimum heating time | 180 s | same for heat |
| minimum idle after cooling | 300 s | wait before restarting the same output |
| minimum idle after heating | 300 s | same |
| dead time between heat and cool | 600 s | never switch straight from one to the other |

The dead time is the one that surprises people. After a heating cycle the cooler can stay off for up
to ten minutes, and the fridge setpoint being far away does not shorten it.

---

## 6. Peak estimation

The controller learns how much the fridge overshoots after the relay turns off, and stops early so
the peak lands on the setpoint. It measures the overshoot per hour, multiplies by how long the
output has been idle, and cuts the cycle when the predicted peak crosses a threshold.

Those thresholds are the `heatTarget*` and `coolTarget*` fields. **In the PID modes they are
estimator thresholds; in Independent mode the same fields are the on/off bands.** One field, two
meanings — a real source of confusion.

The estimators self-tune and are saved, so they get better across batches.

---

## 7. Choosing a mode

| Situation | Mode |
|---|---|
| normal ale or lager fermentation | Beer, fixed setpoint |
| diacetyl rest, cold crash, step changes | Beer, ramp profile |
| chamber used for cold storage | Fridge, fixed setpoint |
| separate heating and cooling devices that must not fight | Independent |
| a build where the beer probe measures the glycol loop | Independent |
| debugging relays | Off, then switch outputs by hand (**not** test mode) |

### On a phone

**Figure:** [Control Mode at phone width: the method selector and the stacked PID panel] `"YT-005-control-mobile.png"`

The page stacks vertically and keeps every control. Changing a setpoint from the fermenter is the
common case, and it needs no scrolling tricks.

---

## 8. Test mode does not exist in the interface

There is a fifth mode character, `t`, that freezes the relays in their last state. No page sends it,
and nothing in the interface exposes it. Mentioning it here is a warning, not an instruction: it can
only be reached by writing the protocol directly, and it leaves outputs latched.

---

## 9. The summary line

At the top of the page, one line restates the current selection — mode, variable, source, setpoint,
and whether control is enabled. It is the fastest way to confirm that Apply did what you intended,
especially when you have been switching between modes.

Under the Apply button, a note reports the outcome of the press itself:

| Note | Meaning |
|---|---|
| `Applying...` | the write was sent and the page is asking the controller what it now holds |
| `Applied.` | the controller answered with the values you asked for |
| `Not applied: mode, beer setpoint did not stick.` | the controller answered with something else |
| `No confirmation from the controller.` | no answer arrived within a few seconds |
| `No changes to apply.` | the selection already matches the controller |

The check is a read-back, not a guess: after writing, the page sends `s` and compares the `S:` reply
with what it asked for. That is why "Applied." means the controller stored the value, not merely that
the message left the browser. The comparison tolerates the 1/512 °C storage step, so an echoed
`18.50` still counts as `18.5`.

The summary line also reports when there is nothing to apply, which is the normal state after a
successful Apply:

**Figure:** [The Apply footer reporting that no changes are pending] `"YT-121-control-no-changes.png"`

---

## Next

- [Profiles and ramps](04-profiles-and-ramps.md) — driving the setpoint over time
- [Independent mode](05-independent-mode.md) — two thermostats
- [Control algorithm](../reference/05-control-algorithm.md) — the equations
