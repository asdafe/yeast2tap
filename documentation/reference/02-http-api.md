# HTTP API

Every endpoint the firmware serves, with its authentication requirement. The auth column is the most
important one: several endpoints that change state need no login at all.

Base: `http://<device>/` on port 80, unless stated. Authentication is HTTP Basic with the web
credentials.

---

## 1. Status and identity

| Method | Path | Auth | Request | Response | Effect |
|---|---|---|---|---|---|
| GET | `/getstatus` | no | – | grouped JSON, see [schema](04-getstatus-schema.md) | – |
| GET | `/time` | no | – | `{"t":"YYYY-MM-DD hh:mm:ss","e":epoch,"o":offsetSeconds}` | – |
| POST | `/time` | **no** | `time=<epoch>`, `off=<seconds>` | `{}` | sets clock and time zone |
| GET | `/theme` | no | – | `{"theme":"…"}` | – |
| GET | `/config?cfg` | optional | – | full configuration; password and DuckDNS token **only if authenticated** | – |
| GET | `/config` | no | – | redirect to `config.htm` | – |

## 2. Configuration writes

| Method | Path | Auth | Request | Response | Effect |
|---|---|---|---|---|---|
| POST | `/config` | **yes** | `data=<json>`; add `nb` to skip the restart | `{}` / 406 / 400 | system configuration; may restart |
| POST | `/theme` | **yes** | `data={"theme":"…"}` | `{}` / 406 | theme |
| POST | `/notes` | only if "always ask for password" | `data={"dash":…,"room":…,"keg":{…}}` | `{}` / 406 / 500 | dashboard note, room label, keg notes |
| GET | `/notes` | no | – | `{"dash":…,"room":…,"keg":{…}}` | – |
| POST | `/tschedule` | **yes** | `data=<beer profile json>` | `{}` / 406 | the ramp profile |
| GET | `/tschedule` | no | – | profile JSON | – |
| POST | `/mqtt` | **yes** | `data=<json>` | `{}` / 406 | MQTT configuration |
| GET | `/mqtt` | **no** | – | full MQTT settings **including the broker password** | – |
| POST | `/log` | **yes** | `data=<json>` | `{}` / 406 | remote logging configuration |
| GET | `/log?data=1` | **no** | – | remote logging settings **including the URL, which may hold a token** | – |

## 3. Auth

| Method | Path | Auth | Effect |
|---|---|---|---|
| POST | `/authz` | **yes** | marks the caller's IP as allowed to write over WebSocket for 30 minutes |
| GET | `/authz` | – | 405 |

Only one IP is remembered. A second authenticated client replaces the first.

## 4. Gravity

| Method | Path | Auth | Request | Response | Effect |
|---|---|---|---|---|---|
| POST | `/gravity` | **no** | iSpindel/GravityMon JSON body | 200 sent **before** processing | injects a hydrometer report |
| GET | `/gdc?data` | no | – | gravity configuration | – |
| POST | `/gdc` | **no** | raw JSON body | `{}` / 400 | rewrites gravity configuration |
| GET | `/sgset?sg=<float>` | **no** | 0.5–1.5 | `{}` / 406 | sets the live specific gravity |
| GET | `/sgset?og=<float>` | **no** | 0.5–1.5 | `{}` / 406 | sets the original gravity |
| GET | `/coeff?a0=…&a1=…&a2=…&a3=…&pt=…` | **no** | – | `{}` / 406 | stores an ignored-calibration-point mask only; **does not apply coefficients** |
| GET | `/tcmd?scan=1` / `?scan=0` | **no** | – | `{}` | start/stop a Tilt BLE scan |
| GET | `/pill?scan=1` / `?scan=0` | **no** | – | `{}` | start/stop a Pill BLE scan |

The `/gravity` report must contain **name, temperature, angle, battery and RSSI**. A partial report is
discarded, but the response has already been sent, so a client cannot tell.

## 5. Scale

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/scale` | no | – | full settings plus live runtime for all eight slots |
| GET | `/scale?daily=<id>` | no | id 0–7, or ≥8 for every keg | `{"records":[[day,time,level,consumed,flags,scale,raw,temp],…]}` |
| POST | `/scale` | **yes**, except `action:"kegName"` when LCD protection is off | `data={"action":…,…}` | `{}` / `{"error":…}` |

Actions:

| Action | Extra fields | Effect |
|---|---|---|
| `settings` (default) | full settings object | saves scale settings, reapplies configuration |
| `tare` | `id` | zero the platform |
| `calibrate` | `id`, `knownWeightGrams` | compute the factor |
| `measure` | `id` | take a long measurement now |
| `kegChange` | `id` | mark the next record as a new keg |
| `resetHistory` | – | delete all daily records |
| `sampleStart` | – | start a sampling session |
| `sampleStop` | – | stop it |
| `kegName` | `id`, `kegName` | rename the keg |

Unknown action → 406. Malformed JSON → 400.

## 6. Pressure, capping, humidity, glycol

| Method | Path | Auth | Request | Response | Effect |
|---|---|---|---|---|---|
| GET | `/psi` | no | – | pressure settings | – |
| GET | `/psi?r=1` | no | – | `{"a0":<raw adc>}` | live raw count for calibration |
| POST | `/psi` | **yes** | `data={"mode","a","b","adc","gn"}` | `{}` / 406 | pressure configuration |
| GET | `/cap` | no | – | `{"m":mode[,"at":epoch][,"sg":sg]}` | – |
| POST | `/cap` | **yes** | `psi=<n>` and one of `cap=0\|1`, `at=<epoch>`, `sg=<float>` | `{}` / 400 | target pressure, manual cap, cap-at-time, cap-on-gravity |
| GET | `/rh` | no | – | `{"m":mode,"t":target}` | – |
| POST | `/rh` | **no** | `m=<mode>&t=<target>` | `{}` / 400 | humidity mode and target |
| GET | `/ptc` | no | – | glycol control settings | – |
| POST | `/ptc` | **no** | `c=<json>` | `{}` / 406 | glycol control settings |

## 7. Logs

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/loglist.php` | **no** | – | status JSON: filesystem, recording state, log list |
| GET | `/loglist.php?start=<name>` | **no** | optional `raw=1`, `wobf=0\|1` | `{}` or 500 with an error code |
| GET | `/loglist.php?stop=1` | **no** | – | `{}` |
| GET | `/loglist.php?rm=<n>` | **no** | index | `{}` — **deletes the log** |
| GET | `/loglist.php?dl=<n>` | **no** | index | the binary log, as an attachment |
| GET | `/chart.php?offset=&index=` | **no** | – | incremental chart data, with a `LogOffset` header; 204 when nothing new |

## 8. Files and system

| Method | Path | Auth | Request | Effect |
|---|---|---|---|---|
| POST | `/list` | **yes** | `dir` | JSON file list |
| DELETE | `/rm` | **yes** | `path` | delete a file |
| POST | `/fputs` | **yes** | `path`, `content` | write any file, creating directories |
| GET | `/restart` | **yes** | – | restart after three seconds |
| GET | `/erasewifisetting` | **yes** | – | clear the saved station credentials and restart |
| GET | `/wifiscan` | **no** | – | trigger a scan; results arrive over WebSocket |
| POST | `/wificon` | **no** | `nw`, `pass`, `ip`, `gw`, `nm`, `dns` | change network and credentials |
| GET | `/wifidisc` | **no** | – | switch to AP mode in RAM (not saved) |
| GET | `/pid` | **no** | `k=v` pairs, `fmt=text` | debug page; **writes EEPROM** |

## 9. Port 8008

| Method | Path | Auth | Effect |
|---|---|---|---|
| GET | `/systemupdate` | **yes** | upload form |
| POST | `/flash` | **no** | writes the firmware to the inactive slot and restarts |
| GET | `/filemanager` | **no** | file manager page |
| GET | `/list?dir=` | **no** | file listing |
| PUT / DELETE / POST | `/edit` | **no** | create, delete, upload |
| GET | `/fsformat` | **yes** | format the filesystem |
| GET | anything else | **no** | serve a file from the filesystem, or 404 |

## 10. Removed or never present

| Path | Status |
|---|---|
| `/fs` | removed; the numbers are in `getstatus.system.heap` and `.storage` |
| `/format-spiffs` | documented upstream, but the endpoint is `/fsformat` |
| `/getline`, `/getline_p` | macros exist, never registered |
| `/brewing.json`, `/brewpi.cfg` | listed as static paths, never written |

---

## 11. Response conventions

| Code | Meaning here |
|---|---|
| 200 | success, usually `{}` |
| 204 | no new chart data |
| 302 | redirect to the `.htm` page |
| 400 | missing or malformed parameter |
| 401 | credentials required |
| 405 | wrong method |
| 406 | JSON parsed but rejected by validation |
| 500 | file or network operation failed |
| 501 | OTA update failed |

`406` versus `400` is the useful distinction: 400 means "I could not read this", 406 means "I read it
and it is not acceptable". Settings that fail their range checks return 406 and change nothing.

---

## Next

- [WebSocket protocol](03-websocket-protocol.md)
- [`/getstatus` schema](04-getstatus-schema.md)
- [Security](../install/08-security.md) — why the auth column matters
