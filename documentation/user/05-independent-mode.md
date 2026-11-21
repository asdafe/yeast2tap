# Independent mode

Two thermostats instead of one. The heater and the cooler each get their own probe and their own
target, and they are allowed to run at the same time.

---

**Figure:** [Independent mode with both zones on fixed setpoints] `"YT-029-control-independent-fixed.png"`

---

## 1. Why it exists

Beer control assumes one actuator fights the other: heat when the beer is cold, cool when it is warm,
never both. That breaks down when:

- the heater and cooler act on **different things** — for example a heater in the beer and a cooler in
  the fridge,
- a glycol loop is in play and the beer probe measures the loop rather than the beer,
- the two devices have very different thermal lags,
- you want a hard floor and a hard ceiling rather than a PID curve.

Independent mode gives up the "smart" cascade and hands you two plain thermostats. Less elegant,
much more predictable.

---

## 2. The two zones

| Zone | Probe | Setpoint field | Turns on when | Turns off when |
|---|---|---|---|---|
| **Cooler** | fridge probe | fridge setpoint | above setpoint + upper band (+0.2 °C) | at or below setpoint + lower band (−0.3 °C) |
| **Heater** | beer probe | beer setpoint | below setpoint + lower band (−0.2 °C) | at or above setpoint + upper band (+0.3 °C) |

Those four numbers are the `coolTargetH/L` and `heatTargetH/L` fields in Advanced settings — **and in
this mode they are the on/off bands, not the peak-estimator thresholds they are in PID modes.** Same
fields, different job. That is the single most confusing thing about this page.

Each zone has an **Enabled** checkbox. Disabling a zone sends an empty setpoint, which is how the
firmware represents "no target".

---

## 3. Both at once

Because there is no dead time in this mode, the two relays can be on simultaneously. The status chip
shows "Heating and cooling" when that happens.

That is not a fault, it is the design: if your heater works on the beer and the cooler works on the
ambient air, running both is exactly what you want.

If you do **not** want it, keep the bands apart: a band of ±0.2/0.3 °C around two targets that are
more than a degree apart will never overlap.

---

## 4. Minimum run times still apply

Each zone honours its own timers:

- minimum heating / cooling time (180 s default),
- minimum idle before the same output restarts (300 s),
- and a cooling zone that starts while the fridge is already cold still runs its full minimum time
  before it releases.

That last one catches people. It is a compressor-protection behaviour, not a bug.

---

## 5. The heater pulse PI

**Figure:** [The heater control section expanded, with the Off/On choice] `"YT-031-predictive-heater.png"`

Heating overshoots: the element and the heat band stay hot long after the relay opens, so the beer
keeps rising. The pulse PI handles that without needing to know the thermal constants, because it
measures the result of every pulse.

How it works:

1. **Duty.** A PI controller on the slow beer filter computes how much of the time the heater should
   be on. The duty is capped at 50 %, so every pulse is followed by at least as much idle time and the
   heat has time to spread through the beer before the next pulse.
2. **Pulse.** The duty is delivered as one short pulse. Its length is learned: the controller measures
   how far the beer actually rose after the previous pulse (peak minus trough) and rescales the pulse
   so the beer moves about one sensor step (0.0625 °C on a DS18B20).
3. **No single long pulse.** A pulse never exceeds **300 s**, however large the error. A 2 °C gap is
   closed by dozens of small pulses, each one observed, so the beer never sails past the setpoint.
4. **Approach and hold.** While the error is large, a pulse is cut early once the beer is within the
   measured coast of the target. Near the target the beer sawtooths between setpoint − ripple/2 and
   setpoint + ripple/2, which puts its *average* on the setpoint.
5. **Safety.** The heater is cut whenever the fast beer reading reaches setpoint + 0.25 °C.

With the switch **On**, three fields appear:

| Field | Default | Meaning |
|---|---|---|
| **Kp** | 20 | percent of duty per °C of error: how hard a gap pushes the heater |
| **Ki** | 8 | percent of duty per °C of error per minute: removes a standing offset |
| **Pulse** | 1 | the ripple a pulse should produce, in sensor steps (1 = 0.0625 °C on a DS18B20) |

Leave them alone unless the beer sawtooths visibly (**Pulse** too high) or never reaches the setpoint
(**Kp** or **Ki** too low). They are stored on the controller and survive a reboot; the cycle state
does not.

Things to know before enabling it:

- **The learned cycle is not persistent.** Duty, learned pulse length and peak live in RAM. A reboot, a
  mode change, or the heater disappearing restarts the learner from a deliberately short first pulse.
  The three constants (Kp, Ki, Pulse) are stored and survive a reboot.
- **It only affects heating.** The cooler stays a plain thermostat.
- **It needs the beer probe**, because that is what it observes.
- **The band should be on the fermenter.** This controller sizes pulses from what the beer does; a
  heater that only warms the air gives it almost nothing to measure. For an air heater, leave the
  switch Off and use the plain thermostat.
- **Minimum heat time and idle time still apply** as floors from Advanced Settings. A pulse is never
  longer than 300 s, and the heater is never on more than half the time.

Give it three or four cycles before judging it. The first pulse is deliberately short.

---

## 6. Heater on a ramp

**Figure:** [Independent mode with the heater driven by a ramp profile] `"YT-030-control-independent-ramp.png"`

The heater can follow a profile while the cooler stays on a fixed setpoint. That is the usual
combination for a slow warm-up: the profile raises the beer target a fraction of a degree per day, the
cooler guards the chamber ceiling.

The profile editor is the same one described in [Profiles and ramps](04-profiles-and-ramps.md), and
Easy Ramp writes into the heater target in this mode.

---

## 7. When *not* to use it

- If you have one fridge and one heating element and want the beer held at a temperature: use Beer
  control. It will be smoother and use less energy.
- If you are chasing a 0.1 °C setpoint: the two plain thermostats will oscillate more than a PID.
- If you have not identified which probe measures what: Independent mode makes that ambiguity
  dangerous, because the labels are literal. "Cooling target" always means the fridge probe, even if
  your glycol loop means something else by "fridge".

That last point deserves a warning of its own. In a glycol build, the configuration option "Glycol
Chilling" installs the **beer probe as the fridge sensor's backup**. If the fridge probe fails, the
fridge reading silently becomes the beer reading — and in Independent mode the cooler then chases
the beer temperature. Watch for this if your two zones start behaving identically.

---

## 8. Checking that it is working

1. Both zones Enabled, both setpoints set.
2. Apply.
3. Watch the status chip through a cycle: it should show heating, then idling, then cooling.
4. If only one ever runs, check that the other's probe is reading and that its setpoint is reachable.

**Figure:** [The status chip in its heating and cooling states] `"YT-010-status-states.png"`

---

## Next

- [Control algorithm](../reference/05-control-algorithm.md) — the exact comparison and timers
- [Control problems](../troubleshooting/02-control-problems.md)
