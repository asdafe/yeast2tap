# WebSocket protocol

The interface does not poll for live values. It holds one WebSocket and speaks a byte-oriented
protocol inherited from BrewPi.

Endpoint: `ws://<device>/ws`. No credentials at connect time.

---

## 1. Framing

**A message is a sequence of one-byte commands.** Each byte is consumed separately.

- `c` asks for control constants.
- `j{"Kp":5}` is the command `j` followed by a JSON object; the `j` handler pulls the rest of the
  bytes from the same queue.
- Whitespace, CR, LF and telnet control bytes are ignored.

Because of that, the server inspects **every** byte of a frame for write commands before letting it
through — otherwise a frame starting with a harmless `t` could smuggle an `E` and erase the EEPROM.

---

## 2. Read commands

| Byte | Reply | Content |
|---|---|---|
| `t` | `T:` | current temperatures |
| `s` | `S:` | mode, beer setpoint, fridge setpoint, heat estimator, cool estimator, independent heater mode (`hystMode`) |
| `c` | `C:` | 33 control constants, see below |
| `v` | `V:` | control variables: error, integral, slope, P, I, D, peak estimates |
| `n` | `N:` | version, build number, build name, board, simulator flag |
| `l` | `L:` | the four lines currently on the local LCD, if one is fitted |
| `d` | `d:` | the device list |
| `h` | `h:` | hardware enumeration |

Reads need no authentication and are answered to whoever asked — but see §5, the answer is broadcast.

### The `C:` constant set

```
tempFormat tempSetMin tempSetMax pidMax
Kp Ki Kd iMaxErr
idleRangeH idleRangeL
heatTargetH heatTargetL coolTargetH coolTargetL
maxHeatTimeForEst maxCoolTimeForEst
minCoolTime minCoolIdleTime minHeatTime maxHeatTime
staleSensorSec oneWireRetryCount minHeatIdleTime deadTime
fridgeFastFilt fridgeSlowFilt fridgeSlopeFilt
beerFastFilt beerSlowFilt beerSlopeFilt
lah hs hystMode
```

These are the fields on the Advanced settings dialog. Temperature *differences* are stored in
1/512 °C steps, so an echoed value can differ from what you typed by less than one step — for
example `-0.05` echoes as `-0.05078125`. That is not an error.

---

## 3. Write commands

| Byte | Payload | Effect | Auth |
|---|---|---|---|
| `j` | `{key:value,…}` | writes control settings and constants | **yes** |
| `C` | – | load default constants | **yes** |
| `S` | – | load default settings | **yes** |
| `E` | – | initialise the EEPROM: wipe devices, restore defaults | **yes** |
| `U` | `{id,c,b,f,h,p,a,x,j,s,d,n}` | install or update a device | **yes** |
| `R` | – | restart | **yes** |
| `A` / `a` | – | alarm on / off | **yes** |
| `w` | – | disconnect Wi-Fi | **yes**, and not compiled on ESP32 |
| `Z` | – | zap the EEPROM | **yes**, debug builds only |

`j{...}` accepts the same keys the `C:` reply emits, plus the mode and setpoint keys. Values are
parsed as numbers, not validated against ranges, apart from two explicitly clamped fields.

`U{...}` is the device definition protocol; the attribute letters are documented in
[Device model](08-device-model.md).

---

## 4. The write window

```
client                          controller
  |  POST /authz (Basic)  ────────►  records IP, 30 minutes
  |  ◄──────── 200 {}
  |  ws.send('j{"Kp":5}') ────────►  allowed
```

Without a prior `/authz`:

```
  |  ws.send('j{"Kp":5}') ────────►  dropped
  |  ◄──────── E:"auth"
```

Details that matter:

- **One IP, one window.** A second client authenticating replaces the first. Anything behind the same
  NAT inherits the right to write.
- **The window is timed from the millisecond counter**, so a reboot closes it.
- **A refused frame is dropped whole**, not partially applied.
- **The browser re-authenticates automatically** using its cached Basic credentials when it sees the
  refusal.

---

## 5. Broadcast replies

`ESP8266_ONE` is defined in this build, so PiLink writes into a transmit buffer that the proxy drains
and broadcasts to **all** connected clients.

Consequences:

- Every reply is seen by every client. Two browsers both receive both `C:` answers.
- A client that only reads can observe another client's device list and LCD content.
- There is no per-client routing, so a reply cannot be addressed to the requester.

The greeting is an exception in the other direction: only the most recently connected client is
greeted, and only on the next loop pass.

---

## 6. Server-initiated messages

| Prefix | When | Content |
|---|---|---|
| `A:` | on connect; every 5 seconds; on log change; on a cap or EEPROM event | the main status document |
| `G:` | on connect if a gravity device is configured; echo of `/gravity` posts | gravity device settings |
| `W:` | on connect; on Wi-Fi events | mode, connected, SSID, IP, gateway, netmask |
| `T:` | BLE scan result | Tilt and Pill discoveries |
| `D:` | debug logging | free-form text |
| `E:"auth"` | a refused write | signals the browser to re-authenticate |

### The `A:` status document

The fields the interface depends on:

| Key | Meaning |
|---|---|
| `st` | state number |
| `sl` | state label |
| `md` | mode letter |
| `bt` / `bs` | beer temperature / setpoint, hundredths |
| `ft` / `fs` | fridge temperature / setpoint, hundredths |
| `rt` | room temperature |
| `tu` | unit (`C` or `F`) |
| `hm`, `tg`, `htr` | humidity mode, target, state |
| `ptc` | glycol control state |
| `pm`, `psi` | pressure mode, reading |
| `cap` | capping status object |
| `scale` | the lean scale block |
| `G` | gravity object: `u` (last update), `g`, `og`, `t`, `r`, `a`, `b`, `bp` |
| `log` | current log name |
| `rssi` | Wi-Fi signal |

A client that only needs a snapshot should use [`/getstatus`](04-getstatus-schema.md) instead of
implementing this stream.

---

## 7. A minimal client

```
connect ws://device/ws

on open:
   send "n"          -> N:{...}     version
   send "c"          -> C:{...}     constants
   send "s"          -> S:{...}     mode and setpoints
   (the server also starts pushing A:{...} every 5 s)

to change something:
   POST /authz       (with Basic credentials)
   send 'j{"mode":"b","beerSet":18}'
   -> S:{...} and C:{...} come back
```

Note the ordering: `/authz` first, then the write. And note that `A:` messages arrive whether you ask
or not.

---

## 8. Pitfalls

| Pitfall | Explanation |
|---|---|
| treating a frame as one command | every byte is a command; a frame can carry several |
| expecting a reply only to yourself | replies are broadcast |
| writing without `/authz` | the frame is dropped and `E:"auth"` comes back |
| assuming `/authz` is per session | it is per IP, and a reboot clears it |
| using `Z` or `e` | both are compiled out in release builds |
| relying on the serial port | it is output-only in this build |

---

## Next

- [HTTP API](02-http-api.md)
- [Device model](08-device-model.md) — the `U{...}` attributes
- [Control algorithm](05-control-algorithm.md) — the fields in `C:` and `V:`
