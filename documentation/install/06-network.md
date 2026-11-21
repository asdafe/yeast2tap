# Network

The controller can be a Wi-Fi client, its own access point, or both at once. Understanding which
mode it is in explains most "I cannot reach it" situations.

---

## 1. The three modes

| Mode | Behaviour | When to use |
|---|---|---|
| **Station** | joins your network; no access point | normal operation |
| **Access point** | creates `yeast2tap`; no uplink | bench setup, no infrastructure |
| **Station + AP** | joins your network *and* keeps its own AP | setup on a network you cannot easily join from, or a safety net |

The mode is a Settings field. It is stored in the settings file, so it survives reboots.

**Fallback behaviour is automatic.** In station mode, if the connection is not up after about eight
seconds, the device starts a backup access point anyway and retries the station connection every
minute. That is why a device with the wrong Wi-Fi password still appears as `yeast2tap` in the list
of networks — it is reachable, just not connected.

---

## 2. Names and discovery

- **Hostname / network name** is one Settings field. It names the access point and the mDNS record
  (`<name>.local`), and it is what the header of every page shows.
- **It is not the DHCP hostname.** The firmware never registers a hostname with the DHCP server, so
  your router's client list will show the ESP32's default name, not yours.
- mDNS is started after a successful station connection. On networks where multicast is filtered, or
  on iOS versions that deprioritise `.local`, use the IP address instead.

**Finding the IP:** Settings → the Network row shows the current station IP once connected. The
initial status message also carries it, and `/getstatus` reports it under the Wi-Fi block.

---

## 3. Joining a network

**Figure:** [The network dialog: scan results, manual entry, and the static IP fields] `"YT-050-network-dialog.png"`

1. Settings → **Network**.
2. Press scan and wait. Results arrive over the WebSocket, not by reloading the page.
3. Select an SSID, or type one by hand for a hidden network.
4. Enter the password.
5. Save.

The device saves the credentials twice: in its own settings file and in the ESP32's Wi-Fi NVS. The
NVS copy is what the radio uses; the settings copy is what the interface shows and what the backup
contains.

### 2.4 GHz only

The ESP32 in this build is a 2.4 GHz part. A 5 GHz-only SSID will not appear and cannot be joined.

### Static IP

Fill IP, gateway, netmask and DNS in the same dialog. All four or none: a partial set is not
meaningful. Leaving them at `0.0.0.0` means DHCP.

Static addressing is the right choice for a controller that other systems poll (MQTT, remote
logging, `/getstatus`), because it survives router reboots in a predictable way.

---

## 4. The access point

- SSID = the hostname (`yeast2tap` by default).
- **Open unless "Enable AP password" is set** and the password is at least eight characters. A
  shorter password silently produces an open network — the firmware does not warn.
- The AP address is `192.168.4.1`.
- A minimal captive portal answers DNS for any name and replies to Apple's connectivity probe, so a
  phone usually pops up the login page by itself.

Captive portals are convenient and slightly hostile: an open AP named `yeast2tap` broadcasts that
there is an unconfigured controller nearby. Set the AP password if the device lives anywhere other
than your own bench.

---

## 5. Forgetting a network

Two different operations, often confused:

| Action | Endpoint | What it clears | What it keeps |
|---|---|---|---|
| **Erase Wi-Fi setting** | `GET /erasewifisetting` (authenticated) | the saved station SSID and password | everything else: static IP, mode, hostname, logs, scale data |
| **Erase all settings** | Device Setup → Init/Erase EEPROM | control constants, control settings, **all device assignments** | Wi-Fi, system config, MQTT, scale settings and calibration, notes, history |

So "erase Wi-Fi" leaves the device in station mode with no credentials — it will fall back to its
access point on the next boot. "Init/Erase EEPROM" does not touch Wi-Fi at all.

There is a known caveat: the ESP32 also keeps credentials in its own NVS store, and the erase
endpoint does not clear that. A device may therefore rejoin the old network after "erasing" Wi-Fi.
If that happens, change the network from the Settings page instead of erasing, or flash the board
clean over USB.

---

## 6. Reaching it from outside the house

There are three realistic options, and the documentation does not recommend one over another
because the right answer depends on your network.

1. **VPN into your LAN.** Nothing on the device changes; the interface is plain HTTP and assumes a
   trusted network. This is the only option that does not expose it.
2. **Port forwarding.** Possible, and unsafe: there is no TLS, the login is HTTP Basic, and several
   endpoints require no authentication at all. See [Security](08-security.md) for the list.
3. **DuckDNS**, which the firmware supports directly: domain, token, update interval. It only keeps
   a DNS name pointed at your current public IP. It does not add any protection, and the update is
   sent over plain HTTP with the token in the URL.

DuckDNS is configured on the Settings page. The update runs at the configured interval (30 minutes
by default) and only when enabled.

---

## 7. Wi-Fi problems and what they mean

| Symptom | Likely cause |
|---|---|
| the AP does not appear | the device is connected to a network already, so no fallback AP exists — find it by IP |
| the AP appears but the password is refused | the AP password is shorter than 8 characters, so the AP is actually open |
| connected, but `yeast2tap.local` does not resolve | mDNS filtered, or the client is on a different subnet |
| the IP changes after every reboot | DHCP; set a static address |
| the device disappears after a router change | the saved SSID no longer exists; it is in fallback AP mode |
| a 5 GHz network is not in the scan list | expected |

---

## Next

- [Security](08-security.md) — what is and is not protected
- [OTA updates](07-ota.md) — the second port you also need to reach
- [Web and network troubleshooting](../troubleshooting/01-web-and-network.md)
