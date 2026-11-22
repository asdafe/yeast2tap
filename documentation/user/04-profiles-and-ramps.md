# Profiles and ramps

A profile replaces a fixed setpoint with a list of steps: hold 18 °C for two days, ramp to 20 °C over
three days, hold until the gravity reaches 1.010, then cold-crash. The controller walks the list and
re-asserts the current target.

---

**Figure:** [Beer control driven by a ramp profile, with the editor in place] `"YT-025-control-pid-beer-ramp.png"`

---

## 1. Turning it on

1. Control Mode.
2. **Controlled variable**: Beer.
3. **Setpoint source**: **Ramp profile**.
4. The profile editor appears below the PID panel.
5. Fill in the steps, press **Save**, then **Apply**.

If the profile is for a beer rather than a fridge, you are done. The fridge-ramp variant asks for an
extra confirmation because it is labelled experimental.

---

## 2. A step, field by field

**Figure:** [The step table with four filled rows] `"YT-027-profile-step-table.png"`

| Column | Unit | Meaning |
|---|---|---|
| °C | °C (or °F) | the target for this step |
| Condition | one letter | *when* the step ends |
| Days | days, 0.01 resolution | how long the step lasts (time-based conditions) |
| SG | gravity or attenuation | the gravity threshold (gravity-based conditions) |
| Stable | minutes / points | the stability window (stability-based conditions) |
| Start time | date-time | when the step begins |

Duration is always in **days**, with a 0.01-day granularity — 14.4 minutes. There is no hours field.
Ten steps maximum.

A `0.0` duration means "evaluate the condition immediately"; that is how ramp steps are written.

---

## 3. Conditions

**Figure:** [The condition dropdown with all eleven options] `"YT-028-profile-condition-options.png"`

| Letter | Ends the step when… |
|---|---|
| `t` | the time has elapsed |
| `g` | the gravity has fallen to the threshold |
| `s` | the gravity has been stable for the given window |
| `a` | time elapsed **and** gravity reached |
| `o` | time elapsed **or** gravity reached |
| `u` | time elapsed **or** gravity stable |
| `v` | time elapsed **and** gravity stable |
| `b` | gravity reached **or** stable |
| `x` | gravity reached **and** stable |
| `w` | time **and** gravity **and** stability |
| `e` | any of the three |
| `r` | **ramp** — interpolate from the previous step's temperature to the next step's |

Gravity thresholds can be written three ways:

- specific gravity, `1.010`
- Plato, when the gravity device is configured for Plato
- attenuation percentage, `75%`

Attenuation is resolved against the original gravity at evaluation time, so it survives a wrong OG
correction later.

**`r` is different.** It is not a hold, it is a transition: the target moves linearly from the
previous step's temperature to the next non-ramp step's temperature, over the given number of days.
That is how you write "cool from 20 to 4 °C over 3 days".

---

## 4. A worked example

An ale with a diacetyl rest and a cold crash:

| °C | Condition | Days | SG | Stable |
|---|---|---|---|---|
| 18.0 | t | 4.0 | | |
| 18.0 | g | 0.0 | 1.020 | |
| 20.0 | t | 2.0 | | |
| 20.0 | s | 0.0 | | 24 / 2 |
| 4.0 | r | 3.0 | | |
| 4.0 | t | 2.0 | | |

Read it as: hold 18 for four days; then hold 18 until the gravity drops to 1.020; then go to 20 for
two days; then stay at 20 until the gravity has been stable within 2 points for 24 hours; then ramp
down to 4 over three days; then hold 4 for two days.

The last step's temperature is what the controller keeps after the profile ends.

---

## 5. Starting and ending

- **Start date** with a **Now** button. A profile can be queued to start later; until then the
  current setpoint is held.
- On the last step the controller applies the final temperature **once** and latches the profile.
  Nothing further happens until you change mode, so a finished profile does not keep overwriting a
  manual change.
- Manual setpoint changes during a run are overwritten within **60 seconds**, because the profile
  re-asserts itself on that period. Change the profile instead of fighting it.

### Re-assertion details

Two numbers explain most "it ignored my edit" reports:

- the profile is applied at most once per 60 seconds,
- and only when the new target differs by more than 0.005 °C.

So a manual change is visible for up to a minute, then gone.

---

## 6. Easy Ramp

**Figure:** [The Easy Ramp wizard: from, to, days, start choice, mini chart] `"YT-042-easy-ramp-wizard.png"`

A shortcut that builds a three-step profile for you: hold the current temperature, ramp, hold the
target.

| Field | Meaning |
|---|---|
| From | starting temperature |
| To | target temperature |
| Days | the ramp length |
| Start | now, a date, or when a gravity is reached |

It writes the steps into the table, so you can inspect and edit them afterwards. If a profile already
exists, it asks before replacing it.

In Independent mode, Easy Ramp drives the **heater** setpoint — that is the mode where a controlled
ramp usually means "bring it up slowly".

---

## 7. Saving and reusing profiles

**Figure:** [The Load dialog with two saved profiles] `"YT-039-profile-list-dialog.png"`

- **Save** stores the profile in the current slot.
- **Save as** opens a one-field dialog for a name — letters, digits and underscore only.
- **Load** opens a list of every saved profile, each with a delete button, so a name can be reused or
  discarded without leaving the page.
- Ten profiles are kept.

Profiles are part of the settings file, so they survive reboots and OTA updates, and they are in the
Settings backup.

---

## 8. Gravity comes from somewhere

A gravity-conditioned step needs a live gravity value. That comes from a hydrometer or from a manual
entry. Without one:

- gravity steps never complete,
- time-only steps still work,
- the controller asks for an original gravity before starting a profile that needs it. The reminder
  offers three choices: start the profile without gravity, save a gravity value and start, or cancel.

---

## 9. After a reboot

An active profile is reconstructed by walking the steps from the start date, checking each one's
duration and condition. The catch: at boot there is no gravity value yet, so any step conditioned on
gravity evaluates false and the walk stops there.

Practical consequence: **a reboot in the middle of a gravity-conditioned profile restarts at the first
gravity-conditioned step.** Time-based profiles resume correctly.

---

## 10. The fridge-ramp variant

Fridge control can also follow a ramp. It is labelled experimental, it asks for confirmation, and the
warning should be taken literally: the beer follows whatever the fridge does, so an aggressive ramp
can overshoot badly.

**Figure:** [Fridge control driven by a ramp, with the experimental warning visible] `"YT-026-control-pid-fridge-ramp.png"`

---

## Next

- [Independent mode](05-independent-mode.md) — ramping the heater only
- [Profile engine](../reference/06-profile-engine.md) — evaluation order and edge cases
