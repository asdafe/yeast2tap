# Security

The honest version: yeast2tap assumes a trusted local network, and the documentation should not
pretend otherwise. This page lists what is protected, what is not, and what to do about it.

---

## 1. What protects what

| Surface | Protection |
|---|---|
| Changing settings (`POST /config`, `/theme`, `/notes` with LCD protection, `/scale` writes, `/mqtt`, `/psi`, `/log`, `/ptc` partly, `/cap`, `/tschedule`) | HTTP Basic, checked per request |
| WebSocket write commands | a 30-minute, single-IP window opened by `POST /authz` |
| Reading most state (`/getstatus`, `/scale`, `/notes`, `/theme`, `/mqtt`, `/log`, `/psi`, `/rh`, `/cap`, `/tschedule`, `/gdc`, whole pages) | none |
| Firmware update page | login required to see the form |
| Firmware upload itself | **none** |
| File manager and its file operations (port 8008) | **none** |
| `/pid` debug page | **none**, and it writes to EEPROM |

Two columns matter more than the rest: the OTA upload and the file manager are unauthenticated, and
the file manager can rewrite the settings file.

---

## 2. The login

- HTTP Basic. Credentials are the user and password on the Settings page.
- Default on a fresh device: **`yeast2tap` / `yeast2tap`**.
- They are stored in plain text in `/bpl.cfg`.
- They travel in clear text on every request, because the whole interface is plain HTTP.

Change the password on the first day. Anyone who can reach the device from a terminal can also list
the files and replace the firmware, so the password is a speed bump, not a perimeter.

---

## 3. The WebSocket write window

The interface talks to the controller over a WebSocket that carries no credentials by itself.
Instead:

1. The browser sends `POST /authz` with Basic credentials.
2. The controller records **one** IP address and marks it allowed to write for **30 minutes**.
3. Every WebSocket frame is inspected. If the frame contains a write command byte and the peer is
   not the allowed IP, the whole frame is dropped and the client is told to authenticate.

Consequences worth knowing:

- **The window is per IP, not per session.** Anything else behind the same NAT address inherits the
  right to write for those 30 minutes.
- **Only one IP is remembered.** A second client authenticating replaces the first; the first client
  then has to re-authenticate on its next write.
- **A reboot clears the window**, because it is timed with the millisecond counter.
- **Reads are always allowed**, and the controller broadcasts every reply to every connected client,
  so a passive client sees the answers to other clients' queries.

The browser shows a "login required to change settings" alert when the write window is closed and its
cached credentials do not open it again.

---

## 4. Endpoints with no authentication

This list is complete for the default build and is the practical definition of "trusted network".

**Writes without a login:**

| Endpoint | Effect |
|---|---|
| `POST /time` | sets the clock and the time zone |
| `POST /rh` | humidity mode and target |
| `POST /ptc` | glycol-loop control settings |
| `POST /wificon`, `GET /wifidisc` | network mode, credentials, static IP |
| `POST /gdc` | gravity device configuration |
| `GET /sgset` | sets the live gravity or the original gravity |
| `POST /gravity` | injects a hydrometer report |
| `GET /coeff` | calibration-point ignore mask |
| `GET /pid` | **writes control constants to EEPROM** and resets the heater learner |
| `GET /loglist.php` with `start=`, `stop=`, `rm=` | starts, stops and **deletes** brew logs |
| `POST :8008/flash` | replaces the firmware |
| every 8008 file endpoint | read, write, delete any file |

**Reads that leak something sensitive:**

| Endpoint | Leaks |
|---|---|
| `GET /mqtt` | the MQTT broker username and password |
| `GET /log?data=1` | the remote-logging URL, which often contains an API token |

That last pair is worth acting on: if you use MQTT, do not let the device be reachable from a
network you do not control, regardless of the web password.

---

## 5. What is redacted

The settings endpoint hides two secrets from unauthenticated callers:

- the admin password,
- the DuckDNS token.

Both appear normally once you are authenticated. Everything else in that response is public. The
Wi-Fi credentials are never exported at all — not even to an authenticated client.

One consequence for backups: an unauthenticated backup silently omits the password and the DuckDNS
token. Restoring it keeps the device's existing values for those fields instead of blanking them,
which is the safe behaviour, but it means the backup is not a complete copy.

---

## 6. Practical hardening

Ordered by effort against benefit:

1. **Change the password.** Two minutes, removes the trivial case.
2. **Set an AP password.** Stops the fallback access point from being an open network.
3. **Keep the device off guest networks and off the internet.** A VPN is the only safe remote
   access; port forwarding exposes unauthenticated write endpoints.
4. **Do not enable MQTT** unless you need it, and if you do, keep the broker on the same trusted
   network. The MQTT transport is plain TCP without TLS, and commands are retained, so a stale
   command can be replayed to a reconnecting device.
5. **Do not leave port 8008 reachable.** It holds the firmware upload and the file manager.

What you cannot fix from the interface, and should know about: there is no TLS, no CSRF token, no
rate limiting, and no way to disable the `GET /pid` endpoint.

---

## 7. If the device is exposed anyway

Assume the following are readable: the MQTT password, the remote-logging token, the notes, the keg
names, the gravity history, the brew logs, and the fact that the device exists. Assume the following
are writable: the firmware, every file, the clock, the network configuration, the gravity value,
the humidity and glycol settings, and the control constants.

Recovery, in order: change the MQTT and remote-logging credentials, change the web password, reflash
over USB, then re-enter the configuration from a backup taken before the exposure.

---

## Next

- [Network](06-network.md)
- [HTTP API](../reference/02-http-api.md) — the full endpoint table with its auth column
- [Known limitations](../appendix/02-known-limitations.md)
