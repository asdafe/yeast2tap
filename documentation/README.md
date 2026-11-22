# yeast2tap documentation

This directory is the complete documentation set for **yeast2tap**, a fermentation temperature
controller that runs entirely on one ESP32.

> **Hardware compatibility.** yeast2tap is electronically and sensor-wise fully compatible with
> BrewPiLess hardware: the same boards, sensors and default pin assignments can be used. The project
> itself has only been tested on the ESP32 WROOM 4 MB module.

**Firmware version documented:** the `0.2.4` build from this repository (reported by the device as
`VERSION_STRING`, and as the `ver` field in the status messages). If your device reports a different
version, check the release notes before relying on a detail here.

---

## Where to start

| You want to… | Read |
|---|---|
| Build the hardware and flash it the first time | [Installation](install/01-hardware.md) |
| Learn the dashboard and the control modes | [User guide](user/01-getting-started.md) |
| Set up a hydrometer or a keg scale | [Hydrometers](user/07-hydrometers.md) · [Keg scales](user/08-keg-scales.md) |
| Fix something that stopped working | [Troubleshooting](troubleshooting/01-web-and-network.md) |
| Integrate with another system over HTTP or MQTT | [Technical reference](reference/02-http-api.md) |

---

## Documentation set

### Installation

1. [Hardware](install/01-hardware.md) — what the firmware expects, and what it cannot tell you
2. [Wiring and pins](install/02-wiring-and-pins.md) — the pin rules, reserved GPIOs, HX711 wiring
3. [Build from source](install/03-build-from-source.md) — PlatformIO, the partition table, the UI pipeline
4. [Flashing](install/04-flashing.md) — USB, first boot, and the recovery path
5. [First run](install/05-first-run.md) — from a blank device to a controlling one
6. [Network](install/06-network.md) — station, access point, static IP, hostname
7. [OTA updates](install/07-ota.md) — the update page, the file manager, what survives
8. [Security](install/08-security.md) — the login model, and where it stops

### User guide

1. [Getting started](user/01-getting-started.md) — reaching the interface
2. [Dashboard](user/02-dashboard.md) — every card and control
3. [Control modes](user/03-control-modes.md) — off, beer, fridge
4. [Profiles and ramps](user/04-profiles-and-ramps.md) — schedules that follow time and gravity
5. [Independent mode](user/05-independent-mode.md) — separate heater and cooler control
6. [Devices](user/06-devices.md) — assigning sensors and actuators
7. [Hydrometers](user/07-hydrometers.md) — iSpindel, Tilt, RAPT Pill
8. [Keg scales](user/08-keg-scales.md) — calibration, daily history, temperature correction
9. [Pressure, capping and humidity](user/09-pressure-capping-humidity.md) — the optional subsystems
10. [Logging and remote logging](user/10-logging-and-remote.md) — local logs, the offline viewer, remote services
11. [Backup and restore](user/11-backup-restore.md) — what each backup really contains
12. [Maintenance](user/12-maintenance.md) — settings, updates, erase operations

### Troubleshooting

1. [Web interface and network](troubleshooting/01-web-and-network.md)
2. [Control problems](troubleshooting/02-control-problems.md)
3. [Sensors and gravity](troubleshooting/03-sensors-and-gravity.md)
4. [Scale problems](troubleshooting/04-scale-problems.md)
5. [Logs and storage](troubleshooting/05-logs-and-storage.md)
6. [Recovery](troubleshooting/06-recovery.md)

### Technical reference

1. [Architecture](reference/01-architecture.md)
2. [HTTP API](reference/02-http-api.md)
3. [WebSocket protocol](reference/03-websocket-protocol.md)
4. [`/getstatus` schema](reference/04-getstatus-schema.md)
5. [Control algorithm](reference/05-control-algorithm.md)
6. [Profile engine](reference/06-profile-engine.md)
7. [Persistence](reference/07-persistence.md)
8. [Device model](reference/08-device-model.md)
9. [Scale internals](reference/09-scale-internals.md)
10. [Gravity pipeline](reference/10-gravity-pipeline.md)
11. [Build and feature flags](reference/11-build-and-flags.md)
12. [Diagnostics](reference/12-diagnostics.md)

### Appendix

1. [Glossary](appendix/01-glossary.md)
2. [Known limitations](appendix/02-known-limitations.md)

---

## About the figures

Screenshots were planned in advance and each has a stable identifier and file name (`YT-001` …
`YT-132`). A figure appears in the text as:

**Figure:** [Dashboard — live temperatures, setpoints and controller state] `"YT-001-dashboard-full.png"`

The image files live in `docs/assets/screenshots/` and keep exactly the file name shown in the
reference, without a path. Captions describe what the figure shows; the surrounding text always
explains the topic on its own, so the manual remains usable without the images.

Where a planned figure could not be captured on the reference build — because it needs hardware the
bench unit does not have, or a state that would require changing a running fermentation — no reference
is left behind. `docs/assets/screenshots/README.md` lists those cases.

---

## Source of truth

This documentation is derived from the source code of this repository, not from upstream BrewPiLess
material. The `docs/` folder that ships with the project is inherited upstream documentation; it is
out of date in several places (filesystem size, log resume behaviour, HTTPS support, an endpoint
name). Where the two disagree, this documentation follows the code. The one exception is
`docs/J0.OtherUrl.md`, which documents the current `/getstatus` schema and the removal of `/fs`.

Each reference page cites the files and functions it was derived from, so a reader can verify a
statement against the build they actually have.
