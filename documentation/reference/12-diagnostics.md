# Diagnostics

What the device can tell you about itself, and how to read it.

---

## 1. The three diagnostic surfaces

| Surface | What it gives |
|---|---|
| `GET /getstatus` | live state, sensors, clock, heap, storage, restart history |
| `GET /pid` | the heater pulse-PI state, and a way to change two constants |
| the log | a history of state and mode changes with timestamps |

The Settings → Sysinfo dialog is a fourth, but it reports build and flash facts rather than runtime
state.

---

## 2. Boot diagnostics

`system.lastRestartReason` and `system.resetCount` come from RTC memory: they survive a reset and are
cleared by a power cycle.

| Reason | Meaning | Action |
|---|---|---|
| `power_on` | normal power-up | – |
| `software` | a commanded restart | – |
| `panic` | a crash | check the serial console, then the recent firmware change |
| `int_wdt` | interrupt watchdog | a blocking ISR or a long critical section |
| `task_wdt` | task watchdog | a blocking loop — a filesystem stall is the usual cause |
| `wdt` | watchdog, unspecified | as above |
| `brownout` | the supply dropped | power supply or relay inrush |
| `deep_sleep` | not used | – |
| `sdio` | unusual | – |
| `unknown` | not an ESP32, or the value was not read | – |

`resetCount` climbing over consecutive soft resets means the device is stuck in a cycle. A `brownout`
that repeats when a relay clicks is almost always the supply.

---

## 3. Health fields

### Sensors

```json
"sensors": { "beer": {"connected": true, "lastUpdate": 1790000000} }
```

- `connected: false` → never produced a valid reading since boot.
- `connected: true`, old `lastUpdate` → answered earlier, silent now.
- `lastUpdate: null` with `connected: true` → the clock is not synchronised, so no timestamp can be
  computed.

A probe that keeps flipping between connected and not is a wiring problem, not a firmware problem.

### Clock

```json
"clock": { "synced": true, "time": 1790000000, "localTime": "...", "timezoneOffset": 10800 }
```

`synced: false` explains:

- why scheduled scale measurements are not running,
- why sampling will not start,
- why sensor timestamps are null,
- why log timestamps look wrong.

### Heap

```json
"heap": { "free": 120000, "minFree": 90000, "largestBlock": 60000,
          "allocatedBlocks": 500, "freeBlocks": 40 }
```

| Signal | Meaning |
|---|---|
| `free` low and falling over hours | a leak |
| `minFree` far below `free` | a transient spike — often a large JSON document |
| `largestBlock` much smaller than `free` | fragmentation |
| `freeBlocks` low | many small allocations |

A healthy device sits with a large `largestBlock` and a stable `free`. A `largestBlock` under a few
kilobytes will make HTTP requests fail with 500s even though "there is free memory".

### Storage

```json
"storage": { "totalBytes": 589824, "usedBytes": 120000, "freeBytes": 469824 }
```

`totalBytes` other than 589,824 means a different partition table. Low `freeBytes` explains failing log
starts and missing settings persistence.

### WebSocket clients

`system.wsClients` above zero but the interface not updating suggests a browser tab holding a dead
socket. Reload it.

---

## 4. The `/pid` page

```
GET /pid?fmt=text
```

Reports the heater pulse-PI state: phase, duty, pulse and idle length, measured ripple and coast,
the learned guard, the integral and the three constants.

It also accepts query parameters that **write**: `hystMode` and `maxHeatTime` are stored to EEPROM, and
a reset command clears the learner.

Two warnings:

- It is a GET request that changes persisted state. Crawlers and preview services can trigger it.
- It has no authentication.

Treat it as a bench tool. Do not link it from a dashboard, and do not expose it.

**There is no screenshot of this page in the documentation set**, deliberately: it is not a supported
interface.

---

## 5. Reading the log for diagnosis

The brew log is a better diagnostic than the live page, because it has timestamps:

| You want to know | Look for |
|---|---|
| was it cycling while I was away | state tag changes |
| did the mode change | mode tag |
| did the clock jump | time-sync tag |
| did it restart | resume tag |
| was a probe missing | gaps in the temperature series |

**Figure:** [The offline viewer, showing state annotations along a run] `"YT-124-viewer-log.png"`

---

## 6. Error messages and codes

### HTTP

| Code | Meaning |
|---|---|
| 400 | the request could not be parsed |
| 401 | credentials required |
| 405 | wrong method |
| 406 | parsed but rejected (a range check failed) |
| 500 | a file or network operation failed |
| 501 | OTA update failed |

### Log start failures

The logger returns a numeric code with its 500. The codes distinguish: name already in use, index full,
not enough space, invalid name, filesystem error.

### Serial console

Output only in this build. It prints boot progress, the device enumeration, and debug lines if the
build enables them. There is no input path, so the console cannot be used to issue commands.

---

## 7. A diagnostic sequence for an unknown fault

1. `GET /getstatus` — note `system.uptime`, `lastRestartReason`, `resetCount`, `freeBytes`.
2. Look at `sensors`: is anything disconnected?
3. Look at `clock.synced`.
4. Look at `heap.largestBlock`.
5. Download the current log and open it in the viewer.
6. Compare the state changes against the times you did something.

Most faults announce themselves in step 1.

---

## 8. What is not exposed

| Missing | Why it matters |
|---|---|
| per-task stack usage | single-threaded; there are no tasks |
| CPU load | not measured |
| per-file sizes | only totals; use the file manager |
| historical heap | only the minimum is kept |
| I²C or 1-Wire bus scans on demand | the device refresh does this |
| Wi-Fi RSSI history | only the current value |

If you need any of those, the serial console with a debug build is the path.

---

## 9. Log message identifiers

Firmware log strings are enumerated in `LogMessages.h`: default constants loaded, default settings
loaded, EEPROM initialised, safe mode, invalid command, and similar. They appear on the serial console
and, for some, in the interface's log area.

They are useful for confirming that a boot did what you expected: "safe mode" in the log means the
settings were not found, which is the same event as "everything reverted to defaults".

---

## Next

- [`/getstatus` schema](04-getstatus-schema.md)
- [Recovery](../troubleshooting/06-recovery.md)
