# Dashboard

The page you will look at most. It answers three questions without a click: what are the
temperatures, what is the controller doing, and how much beer is left.

---

**Figure:** [The whole dashboard, with a fermentation running] `"YT-001-dashboard-full.png"`

---

## 1. Stat cards

**Figure:** [Beer, Fridge, Room and Status cards, close up] `"YT-009-stat-cards.png"`

| Card | Shows | Notes |
|---|---|---|
| **Beer Temp** | the beer probe reading | the one the PID acts on in Beer mode |
| **Beer Set** | the beer target | editable on the Control Mode page, not here |
| **Fridge Temp** | the fridge probe reading | |
| **Fridge Set** | the **computed** fridge target in Beer mode; the set target in Fridge mode | it moves by itself — that is normal |
| **Room Temp** | the room probe or a network-published value | the label next to it is renameable |
| **Status** | state chip, mode, recording indicator, Wi-Fi signal | |

Each card carries a checkbox. Unticking it removes that line from the chart below; it does **not**
stop the measurement or the control.

A missing reading shows `--`. One card can be empty while the others work.

---

## 2. The status chip

**Figure:** [The status card in three states: cooling, heating, idling] `"YT-010-status-states.png"`

The chip names the current state. The states you will actually see:

| State | Meaning |
|---|---|
| Idling | neither relay is on; this is the normal resting state |
| Heating | the heater output is on |
| Cooling | the cooler output is on |
| Waiting to heat / cool | inside a minimum-off or dead-time window |
| Measuring | a scale is taking its long measurement |
| Door open | the door switch is open (display only) |

The controller spends most of its life Idling. A compressor that runs continuously is a sign of
something else — an oversized chamber, a setpoint that cannot be reached, or a stuck relay.

---

## 3. The chart

**Figure:** [The chart with a hover tooltip and the full legend] `"YT-012-chart-tooltip.png"`

Data comes from the current brew log. With no log running you get the short in-memory ring instead,
which covers only the last couple of hours and is lost on reboot.

| Element | Meaning |
|---|---|
| solid line | beer temperature |
| dashed line | fridge temperature |
| dotted / long-dash lines | setpoints |
| extra series | gravity, filtered gravity, auxiliary temperature |
| right-hand axis | used by series with a different scale |

Hovering shows the timestamp and every visible value at that point.

### Toggling series

**Figure:** [One legend entry dimmed, its line gone] `"YT-013-chart-legend-toggled.png"`

Click a legend entry to hide its line. The entry stays in the legend, dimmed and struck through, so
you can bring it back. Hiding is a display setting only, and it resets when the page reloads.

---

## 4. Renaming the room label

**Figure:** [The room label in edit mode, text selected] `"YT-011-room-label-edit.png"`

The room card's label can be renamed in place:

1. **Double-click** the text.
2. Type the new name (up to 24 characters).
3. **Enter** or click away to save, **Esc** to cancel.
4. Saving an empty value restores the default.

A single click still toggles the chart line, so the card keeps working as before. The name is stored
with your notes, not in the settings file, and it survives reboots.

This is the only way to rename it; there is no field on any settings page.

---

## 5. Kegs

**Figure:** [The Kegs card with two kegs] `"YT-014-kegs-card.png"`

One row per configured scale:

- **fill graphic** — proportional to the remaining percentage
- **keg name** — editable here
- **Beer in keg** — the keg's contents label, editable
- **remaining** — litres and percent, computed from the weight, the empty-keg mass and the density
- **keg temperature** — the fridge probe at that moment
- **state** — stable, settling, no keg, no signal
- **notes** — per-keg free text, saved on blur

The card is always present, even with no scale configured, and shows placeholders in that case.

Weights and levels are explained in [Keg scales](08-keg-scales.md).

---

## 6. Gravity

**Figure:** [The gravity card: OG, SG, attenuation, ABV, change over time] `"YT-017-gravity-card.png"`

| Field | Meaning |
|---|---|
| Original Gravity | set once per batch, click to edit |
| Specific Gravity | the current reading from the hydrometer |
| Attenuation % | how much of the fermentable sugar has been consumed |
| ABV % | estimated alcohol by volume |
| 48 / 24 / 12 h | how much the gravity moved in each window |

Attenuation and ABV are computed from OG and SG. Without an OG, both stay blank — that is why the
controller asks for it before starting a gravity-driven profile.

Clicking the two gravity values opens the entry dialog.

---

## 7. The gravity device card

Only appears once a hydrometer is configured.

**Figure:** [The gravity device card for an iSpindel] `"YT-018-gravity-device-ispindel.png"`

It shows the device type, the raw angle or raw SG, battery, temperature, signal strength and the
time of the last report. The same card adapts to every hydrometer type — a Tilt shows raw SG where an
iSpindel shows an angle, and the RAPT Pill shows an angle derived from its accelerometer. A device
that stops reporting keeps its last values; only the timestamp stops moving.

---

## 8. Notes

**Figure:** [The notes card with a short note and the Save button active] `"YT-021-notes-card.png"`

A free-text field, 1000 characters, saved explicitly with **Save note**. It is not saved on blur, so
a note typed and abandoned is lost.

Notes are stored in `/notes.json` together with the room label and the per-keg notes.

---

## 9. The optional panes

Three side panes appear only when their subsystem is configured.

**Figure:** [All optional panes at once: glycol, spunding, pressure, gravity device] `"YT-022-dashboard-optional-panes.png"`

| Pane | Appears when | Shows |
|---|---|---|
| Glycol temperature control | a glycol-loop cooler is assigned and enabled | state, running time, target range |
| Spunding status | capping is configured | valve state and the active condition |
| Pressure | the pressure transducer is enabled | current psi |

They are covered in [Pressure, capping and humidity](09-pressure-capping-humidity.md).

---

## 10. Themes

**Figure:** [The theme swatches, with an alternate theme applied to the dashboard] `"YT-002-dashboard-theme-picker.png"`

Eight themes, chosen from the strip in the header. The choice is stored on the device and applies to
every page. It is a display setting only: nothing about the control behaviour changes.

The theme is read before the page paints, so there is no flash of the wrong colours on load.

---

## 11. On a phone

**Figure:** [The dashboard at phone width: stacked cards, hamburger nav, shorter chart] `"YT-004-dashboard-mobile.png"`

The layout reflows rather than shrinking: cards stack, the navigation becomes a menu button, and the
chart shortens. Nothing is hidden, so every control described on this page is reachable from a phone.

That matters in practice — the most common place to want the dashboard is standing next to the
fermenter.

---

## 12. The two buttons (ESP8266 builds)

An ESP8266 build has **no rotary encoder** — the pins it needs are the boot-strapping ones — so the
local menu is driven by two push buttons, up and down (`BREWPI_BUTTONS` is 1 only on ESP8266). The
ESP32 build compiles the menu out and uses the web interface instead.

| Action | Buttons |
|---|---|
| next menu item / change a value | short press of UP or DOWN |
| select / enter | press **UP and DOWN together** and release them at the same moment |
| change a value quickly | hold UP or DOWN |

Pressing UP+DOWN on the normal screen enters setup: the current item's name blinks to show it is
being edited. UP advances to the next item; UP+DOWN changes that item's value.

The menu is handled by the main loop rather than an interrupt, so a press that is too short can be
missed. Press a little longer than feels natural; the display updates within a fraction of a second,
not instantly.

---

## 13. What is *not* on this page
The markup contains legend rows for pressure, CO₂, chamber humidity, target humidity and room
humidity, and two chart panels for them. All of them are permanently hidden in this build: nothing
in the page removes the hiding class. **Pressure and humidity series cannot be displayed on the
dashboard**, even with the sensors working.

If you need those curves, they *are* recorded in the brew log and visible in the offline log viewer.

---

## Next

- [Control modes](03-control-modes.md)
- [Logging](10-logging-and-remote.md) — where the chart data comes from
