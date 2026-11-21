# Logging and remote logging

Two separate things with confusingly similar names:

- **the brew log** — a binary file on the controller, one record per minute, downloaded by hand;
- **remote logging** — periodic HTTP pushes to an external service.

They are configured on the same page and are independent.

---

## 1. The local brew log

**Figure:** [The Logs page with no session running] `"YT-080-logs-idle.png"`

### Starting a session

1. Type a name. Up to 24 characters; letters, digits, dashes.
2. Decide the two options:
   - **Write on buffer full** — accumulate before writing. Fewer flash writes, more data at risk on a
     power cut.
   - **Record angle/raw** — store the hydrometer's raw value as well as the computed gravity.
3. **Start Logging**.

While a log is running the start form is replaced by the session itself: the log's name, its start date
and time, and a **Stop Logging** button. That is why you cannot start a second log without stopping the
first, and why the form looks different once recording begins.

The controller checks free space and the ten-log limit before it starts.

### While recording

**Figure:** [An active session with its title, start time and Stop button] `"YT-082-logs-recording.png"`

The card keeps the same shape but swaps the start controls for the running session's title, its start
timestamp and a single **Stop Logging** button.

One record per minute containing whatever changed: temperatures, setpoints, state, mode, gravity,
pressure, humidity. Between records, nothing is written.

**A session resumes after a reboot.** This is worth knowing because the opposite is often assumed: if
the controller restarts mid-fermentation, logging continues and appends a resume marker to the same
file.

### The records

| Entry | When |
|---|---|
| header | once, at the start |
| periodic record | every 60 seconds |
| state / mode change | when it happens |
| calibration data | when a calibration point is added |
| time sync | when the clock jumps by more than ten minutes |
| resume | after a restart |

There are no user annotations. The file format defines an event tag, but nothing writes it.

### Space

- The filesystem is 576 KB and shared with the settings, notes and scale history.
- There is no per-file limit; the logger stops itself when the free space would fall below about
  16 KB.
- Up to ten logs. Delete one to make room for another.

### Downloading and deleting

**Figure:** [The log table with download and delete buttons] `"YT-083-log-list.png"`

Download gives you the raw binary file. It opens in the offline viewer, not in a text editor.

If the log cannot start, the controller says why in a single alert: the name is already in use, the
ten-log limit is reached, there is not enough free space, or the name is invalid. Nothing is created in
any of those cases.

Deletion is immediate and unauthenticated — see [Security](../install/08-security.md).

---

## 2. The offline log viewer

The viewer is **not served by the controller**. It is a standalone HTML file, built into
`htmljs/dist/<language>/y2tlogviewer.htm`, that you open from your own computer and point at a
downloaded log.

**Figure:** [The viewer with a fermentation log loaded] `"YT-124-viewer-log.png"`

What it does:

| Feature | Detail |
|---|---|
| Charts | temperature, gravity, state, pressure, CO₂ volumes, humidity |
| Gravity fit | fit a curve against device or beer temperature, and copy the formula |
| Temperature correction | same, anchored at a reference temperature |
| Crop / Save As | write a smaller log for the range in view |
| Export | CSV for a spreadsheet |
| Scale mode | read a `scale_daily.json` export and fit the keg correction |

**Figure:** [The viewer's menu, with every entry available] `"YT-132-viewer-menu.png"`

**Figure:** [The viewer with no file loaded] `"YT-123-viewer-empty.png"`

### The gravity fit

**Figure:** [The calibration pane: points, ignore flags, fit graph, formula] `"YT-125-viewer-calibration.png"`

Useful when the controller's own calibration was done badly: fit on the real data, copy the
coefficients, and enter them on the Hydrometer Setup page.

### The temperature correction

**Figure:** [The correction dialog: source, degree, reference temperature] `"YT-126-viewer-tempcorrection.png"`

**Figure:** [The correction graph: raw points, fitted curves, corrected series, formula and Copy] `"YT-127-viewer-tempcorrection-graph.png"`

This computes a gravity correction formula. Note the asymmetry mentioned in
[Hydrometers](07-hydrometers.md): the Scale page accepts a pasted formula, the gravity page does not.

### Crop and export

**Figure:** [The crop dialog over a zoomed chart] `"YT-128-viewer-crop.png"`

**Figure:** [The export dialog] `"YT-129-viewer-export.png"`

Cropping re-encodes the same binary format, so a cropped log reopens in the viewer and keeps its
gravity.

### Scale mode

**Figure:** [A `scale_daily.json` open in scale mode] `"YT-130-viewer-scale-mode.png"`

Opening a scale export switches the viewer to a keg chart and enables the scale correction dialog —
covered in [Keg scales](08-keg-scales.md).

---

## 3. Remote logging

Periodic HTTP pushes to a service you choose.

**Figure:** [The remote logging card on Generic HTTP] `"YT-084-remote-logging-generic.png"`

### The five services

| Service | Type | What it sends |
|---|---|---|
| **Generic HTTP** | free-form | a URL with your own template, GET/POST/PUT |
| **ThingSpeak** | fixed fields | eight channel fields you map |
| **Ubidots** | fixed fields | token + device |
| **Brewfather** | fixed endpoint | ID and device label |
| **Brewer's Friend** | fixed endpoint | API key and beer |

**Figure:** [The ThingSpeak pane with field mapping] `"YT-085-remote-logging-thingspeak.png"`

**Figure:** [The Brewfather pane] `"YT-086-remote-logging-brewfather.png"`

**Figure:** [The Ubidots pane] `"YT-087-remote-logging-ubidots.png"`

**Figure:** [The Brewer's Friend pane] `"YT-088-remote-logging-brewersfriend.png"`

### The template language

For generic HTTP you write the payload yourself with placeholders. The **Notations…** link under the
format box opens a table of every placeholder and what it inserts, so you do not have to memorise the
list below:

| Placeholder | Value |
|---|---|
| `%b` / `%B` | beer temperature / beer setpoint |
| `%f` / `%F` | fridge temperature / fridge setpoint |
| `%r` | room temperature |
| `%g` / `%p` | gravity in SG / in Plato |
| `%a` / `%t` | hydrometer angle / temperature |
| `%v` / `%u` | battery voltage / percentage |
| `%m` / `%M` | mode / state |
| `%P` | pressure |
| `%H` | hostname |

Combined with `POST` and a JSON content type, that is enough for most home-grown endpoints.

### Interval

Checked once a second against the configured period. The interface enforces a minimum of 60 seconds,
and 900 for Brewfather and Brewer's Friend because those services reject faster updates.

**There is no retry and no queue.** A failed push is lost; the next interval tries again with fresh
data. If your endpoint is unreliable, that is visible as gaps.

### HTTPS

The ESP32 build can do HTTPS, but the interface refuses to save an `https://` URL. Use plain HTTP to a
local endpoint, or terminate TLS in front of it.

---

## 4. MQTT

Two directions on one broker.

**Figure:** [The MQTT card, collapsed] `"YT-090-mqtt-collapsed.png"`

**Figure:** [The MQTT card expanded: broker, reporting, remote control] `"YT-091-mqtt-expanded.png"`

### Reporting

Publishes the same values the dashboard shows, either as individual topics under a base path or as
one JSON document per period. Quality of service 1, retained.

Retained means the broker keeps the last value, so a new subscriber gets data immediately. It also
means a stale value can look current — check the timestamp field.

### Remote control

| Topic | Accepts |
|---|---|
| mode | `0`–`3`, or the letters `o` `f` `b` `p` |
| beer setpoint | a number in the display unit |
| fridge setpoint | a number |
| PTC target | a temperature |
| cap | digits for a target psi, or `on` / `off` |

Any publisher that can write to those topics can change your fermentation. There is no payload
authentication and the transport is plain TCP.

**Retained commands are a trap:** if you publish a setpoint with the retain flag, the device re-applies
it every time it reconnects. Publish commands without retain.

### Security

The MQTT broker password is readable by anyone who can reach `GET /mqtt`, without a login. Keep the
device on a trusted network. See [Security](../install/08-security.md).

---

## 5. What goes where

| You want | Use |
|---|---|
| a permanent record on the device | the local brew log |
| a chart of the past weeks | the local log, viewed offline |
| a copy in the cloud | remote logging |
| home automation integration | MQTT reporting |
| to change the controller from another system | MQTT remote control, or the HTTP API |

The local log is the only one that keeps history after a reboot. Remote logging only pushes the
present.

### On a phone

**Figure:** [The Logs page at phone width] `"YT-092-logs-mobile.png"`

The Logs page is usable at phone width: starting, stopping and checking the file list all work. The
viewer itself is a desktop tool — the file is easier to open on a computer.

---

## Next

- [Backup and restore](11-backup-restore.md) — the logs are *not* in either backup
- [Logs and storage troubleshooting](../troubleshooting/05-logs-and-storage.md)
