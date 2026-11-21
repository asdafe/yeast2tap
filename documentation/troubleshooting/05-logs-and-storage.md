# Logs and storage

The brew log will not start, the filesystem fills up, the history is missing, or remote logging sends
nothing.

---

## 1. The log will not start

| Cause | Check |
|---|---|
| ten logs already exist | Logs → the table; delete one |
| not enough free space | the free/used/total line on the page |
| invalid name | up to 24 characters, letters/digits/dash |
| the log index is full | delete a log; the index holds ten |

The logger refuses to start when the free space would fall below about 16 KB after the first record.
That reserve exists so the filesystem never fills completely — a full LittleFS cannot save settings
either.

---

## 2. Recording stopped in the middle

- **Space ran out.** The logger force-ends the session rather than filling the disk.
- **The device restarted.** The session resumes on the next boot, so this shows as a gap, not a stop.
- **The log was stopped** from the page, or from `GET /loglist.php?stop=1`, which needs no login.

A gap in a log that then continues is the resume marker; the viewer draws it as a break.

---

## 3. The chart on the dashboard is empty but the log exists

- The chart reads the **current** log; opening the page with a different log selected shows that one.
- Before the first record arrives there is nothing to draw.
- A log with only a header and no records draws an empty chart.

---

## 4. The filesystem is full

Symptoms: settings will not save, logs will not start, the interface is slow.

**Figure:** [Filesystem free/used/total on the Logs page] `"YT-080-logs-idle.png"`

1. Delete old logs.
2. Reduce the scale history retention (Scale → history days).
3. Export the scale history first if you want to keep it.
4. If it is still full and nothing explains it, format the filesystem on port 8008 — you lose logs and
   notes, not your device configuration.

What occupies the 576 KB, typically:

| Item | Typical size |
|---|---|
| settings file | about 2.6 KB |
| control EEPROM files | a few KB |
| notes | under 1 KB |
| one brew log | 6 bytes per minute → ~9 KB per day → ~65 KB per week |
| scale daily records | 26 bytes per record → tiny |
| scale samples during a session | 26 bytes per sample: 720/day/keg at 2 min |

A three-week fermentation at one record per minute is around 190 KB. Two of those plus samples fills
the partition.

---

## 5. Remote logging sends nothing

| Check | Detail |
|---|---|
| enabled | the switch, and the card expanded |
| period | at least 60 s; 900 for Brewfather and Brewer's Friend |
| URL scheme | the interface refuses `https://` |
| URL correctness | a wrong host fails silently; there is no retry and no error in the UI |
| service preset | each preset builds its own payload; a custom format is ignored by the fixed services |
| the endpoint | test it with `curl` from another machine first |

**There is no retry and no queue.** A failed push is gone. If you see periodic gaps, the endpoint is
the problem.

**Figure:** [The remote logging card, generic HTTP] `"YT-084-remote-logging-generic.png"`

---

## 6. Remote logging works but the values are wrong

- **Units**: temperatures are sent in the display unit.
- **Gravity**: `%g` is SG, `%p` is Plato.
- **Placeholders**: an unknown placeholder is left as-is or blanked, depending on the service type.
- **Fixed services**: ThingSpeak and the others map fixed fields; a custom template does nothing there.

---

## 7. MQTT publishes but nothing arrives

| Check | Detail |
|---|---|
| broker reachable | the device needs a route to it |
| credentials | the broker user/password, not the web login |
| base topic | the topics are `<base>/<key>` |
| retained flag | a retained value is delivered late to a new subscriber, so it can look like a delay |
| QoS | 1; a broker with a low queue limit can drop |

Reporting and remote control are separate switches. Publishing can be on while control is off.

---

## 8. MQTT control commands are ignored

- **Mode**: control must be enabled in the MQTT settings (mode "control" or "both").
- **Topic path**: the configured path must match exactly.
- **Payload**: a setpoint is parsed as a number; a value in the wrong unit changes the wrong thing.
- **Retained commands**: a retained command is re-applied on every reconnect — sometimes that is why a
  setpoint keeps coming back.

---

## 9. The downloaded log will not open

- It is **binary**, not text. A text editor shows garbage; that is expected.
- It opens in `y2tlogviewer.htm`, the standalone viewer.
- A truncated download (the browser gave up) does not open.
- A log from a much older firmware version may not parse; the viewer expects the current format.

**Figure:** [The viewer with a log loaded] `"YT-124-viewer-log.png"`

---

## 10. The scale history disappeared

- **Retention**: records older than the configured days are pruned once a day.
- **Reset history** deletes everything.
- **A keg change** does not delete anything, but consumption restarts from zero.
- **Sampling sessions** are separate and do not appear on the daily chart.

**Figure:** [The daily settings row: retention, sampling, export and reset] `"YT-104-scale-daily-settings.png"`

---

## 11. Notes disappeared

`/notes.json` is a plain file. It is removed when the last note is cleared, and it is wiped by a
filesystem format. It is not part of `device.json`, but it *is* part of the Settings backup.

---

## 12. Everything vanished after a power cut

Two separate mechanisms, and both are visible in the same event:

1. **The settings file** is written non-atomically. A cut during a write leaves a truncated file, the
   loader falls back to defaults, and the device comes up unconfigured.
2. **The scale history** uses a temp/backup/rename pattern, so it usually survives — the boot recovery
   restores the backup if the rename was interrupted.

So "I lost my settings but my keg history is still there" is a coherent outcome, not a contradiction.

---

## Next

- [Recovery](06-recovery.md) — what to do about it
- [Persistence](../reference/07-persistence.md) — the write patterns and the migration rules
