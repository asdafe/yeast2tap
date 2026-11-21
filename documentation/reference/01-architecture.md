# Architecture

One cooperative loop, a layered call stack, and two independent persistence systems. This page
describes the shape of the firmware so the rest of the reference makes sense.

---

## 1. Execution model

```
setup()                                  loop()
  ├── boot bookkeeping (RTC)               ├── 1 Hz control tick
  ├── settings load (/bpl.cfg)             │     ├── sensor update
  ├── filesystem mount                     │     ├── PiLink command drain
  ├── WiFi / mDNS / time                   │     ├── PID / state machine
  ├── HTTP server (port 80)                │     ├── outputs
  ├── WebSocket (/ws)                      │     └── display
  ├── update server (port 8008)            ├── brew keeper (profiles, 60 s)
  ├── device init + EEPROM                 ├── brew logger (60 s records)
  └── first sensor read                    ├── scale manager
                                           ├── MQTT client
                                           ├── remote logger
                                           ├── DuckDNS
                                           └── (loop repeats)
```

There are no application RTOS tasks. Everything runs on one thread, in `loop()`. Consequences:

- **No preemption.** A slow operation delays everything else, including HTTP responses.
- **Ordering is the design.** The control tick runs before the services, so the relays are updated
  with the freshest sensor data.
- **Timing is `millis()`-based**, with a 1 Hz tick driving the control logic and per-service
  intervals for everything else.

The one blocking gap worth knowing: the pressure sensor read uses a `delay()` between samples
(about 40 ms per read), which violates the project's own no-`delay()` rule. It is the only
user-visible violation.

---

## 2. Layers

```
┌────────────────────────────────────────────────────────────┐
│ Web UI  (HTML + JS, gzipped into flash)                    │
└──────────────┬─────────────────────────────────────────────┘
               │ HTTP :80 (AsyncWebServer)   WebSocket /ws
┌──────────────▼─────────────────────────────────────────────┐
│ Handlers                                                    │
│   BrewPiWebHandler   LogHandler   ExternalDataHandler       │
│   NetworkConfig      AppleCNA      (port 8008 update server)│
│   auth: HTTP Basic + /authz write window                    │
└──────────────┬─────────────────────────────────────────────┘
               │ PiLink byte protocol (one byte = one command)
┌──────────────▼─────────────────────────────────────────────┐
│ BrewPiProxy → PiLink → TempControl / DeviceManager /        │
│                        SettingsManager / BrewKeeper         │
└──────────────┬─────────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────────┐
│ Device layer      Persistence          Services             │
│  TempSensor        /bpl.cfg            BrewLogger           │
│  Actuators         /eeprom_*           ScaleManager         │
│  Environment       /notes.json         DataLogger           │
│  sensors, BLE      /log/*              MqttRemoteControl    │
│                    /scale_daily.log    DuckDNSUpdater       │
└────────────────────────────────────────────────────────────┘
```

### Why PiLink is in the middle

The original BrewPi split the controller (an Arduino) from the host (a Raspberry Pi) and spoke a
compact text protocol between them. This firmware kept the protocol as an internal bus:

- the WebSocket passes bytes straight into it,
- the serial console (output only) uses it,
- every reply is a line of text.

That is why a WebSocket command is a single character, and why `j{...}` uses a hand-written token
parser rather than a JSON document API. It also explains two quirks: replies are **broadcast to every
connected client**, and the serial port has no input path, so there is no serial recovery channel.

---

## 3. Boot sequence

1. **RTC bookkeeping**: read the reset reason and increment a boot counter in RTC memory. This
   survives a reset but not a power cycle.
2. **Settings**: load `/bpl.cfg`. On failure, defaults. On a size mismatch, run the migration chain.
3. **Filesystem**: mount LittleFS. **On mount failure the firmware formats it** and logs the fact.
4. **Wi-Fi**: start according to the saved mode; wait up to five seconds; start the fallback AP on
   failure.
5. **Time**: NTP if connected; otherwise restore the saved time plus five minutes.
6. **mDNS**: register the hostname.
7. **Servers**: HTTP on port 80, WebSocket on `/ws`, update server on 8008.
8. **Devices**: load the device list, install sensors and actuators, read once.
9. **Control**: force mode Off, then apply the stored mode.

Step 9 is worth remembering: the controller always starts **off** and then adopts the stored mode. A
mode that was running before a restart resumes.

---

## 4. Two persistence systems

They look similar and behave differently.

### `/bpl.cfg`

A raw dump of one `Settings` struct: system configuration, time info, gravity configuration, beer
profile, log indexes, auto-cap, parasite control, MQTT, Wi-Fi, BLE hydrometer, humidity, **scale
settings**.

- No magic number, no version field, no checksum.
- Migration is **by exact file size**: each historical size has a case that fills the new tail with
  defaults.
- Written by truncate-and-write, **not atomically**.

### `/eeprom_*`

The BrewPi "EEPROM" reimplemented as three files:

| File | Contents |
|---|---|
| `/eeprom_control_setting` | mode, setpoints, learned estimators |
| `/eeprom_control_constant` | PID, bands, filters, timers, units |
| `/eeprom_device_definition` | 16 device slots |

The constants file **does** migrate by size, through a chain of historical structs. The settings file
has no migration at all.

### Data files

| File | Contents | Write pattern |
|---|---|---|
| `/notes.json` | dashboard note, room label, keg notes | truncate + write |
| `/log/<name>` | binary brew log | append, flushed per record unless buffered |
| `/scale_daily.log` | 26-byte daily and sample records | append; temp+rename for prune and migration |

Only the last one uses the atomic pattern.

---

## 5. Threading and concurrency (such as it is)

There is one thread, but two contexts:

- **`loop()`** — everything described above.
- **The async web server callbacks** — HTTP and WebSocket events.

They interleave at `yield()` points inside the async stack. Two consequences:

- A handler that reconfigures a device (for example the scale settings POST) runs while `loop()` may
  be inside a filesystem write. The scale daily file mutations are serialised with a mutex for exactly
  this reason.
- A handler that reads a struct while `loop()` writes it can see a torn value. In practice the
  affected values are small integers and the consequences are cosmetic.

There is no locking around settings. That is a design choice inherited from the original, and it is
why settings are only written from handlers, never from the control tick.

---

## 6. Memory

| Region | Typical use |
|---|---|
| static RAM | ~66 KB of 320 KB (about 20 %) |
| heap | JSON documents, HTTP handlers, strings |
| flash (app) | ~1.75 MB of 1.77 MB (about 99 %) |
| filesystem | 576 KB |

The static figure is dominated by:

- the eight scale runtimes,
- the device manager's 16 slots,
- the log buffers,
- the LCD framebuffer if a display is enabled.

Flash is the binding constraint. Every embedded page is gzipped into the image, so a UI change costs
flash even when no C++ changes.

---

## 7. Where to look for what

| Question | File |
|---|---|
| HTTP handlers, auth, boot, loop | `yeast2tap.cpp` |
| PiLink protocol | `PiLink.cpp` |
| control algorithms | `TempControl.cpp` |
| profiles | `BrewKeeper.cpp` |
| devices and pins | `DeviceManager.cpp` |
| settings persistence | `BPLSettings.cpp` |
| control EEPROM | `FSEepromAccess.h`, `EepromManager.cpp` |
| brew log | `BrewLogger.cpp` |
| scales | `ScaleManager.cpp` |
| gravity | `ExternalData.cpp`, `Ble*Listener.cpp` |
| pressure / capping / humidity / glycol | `PressureMonitor.cpp`, `AutoCapControl.cpp`, `HumidityControl.h`, `ParasiteTempController.cpp` |
| networking and time | `WiFiSetup.cpp`, `TimeKeeper.cpp`, `DuckDNSUpdater.cpp` |
| remote logging and MQTT | `DataLogger.cpp`, `LogFormatter.cpp`, `MqttRemoteControl.cpp` |
| page map | `EmbeddedFiles.cpp` |

---

## Next

- [HTTP API](02-http-api.md)
- [Persistence](07-persistence.md)
- [Diagnostics](12-diagnostics.md)
