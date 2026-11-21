# Web interface and network

The page does not load, the page loads but the values do not move, or the device vanished after a
router change. Work down this page in order — the first three checks solve most cases.

---

## 1. Nothing answers

### Is the device on the network at all?

Look for its access point in the Wi-Fi list.

- **`yeast2tap` present** → the device could not join your network and is in fallback AP mode. Join it
  and open `http://192.168.4.1`.
- **not present, and the device used to work** → it is probably on your network with a new IP. Check
  the router's client list.

### The phone has an address but the page does not open

Check the phone's address first: `192.168.4.x` means the AP and its DHCP are working, so the fault is
above the link layer. The usual culprit is the browser, not the device.

Chrome on Android probes `/generate_204` to decide whether a network has internet. The firmware
answers that path with `404`, so Chrome concludes "captive portal" and can stay in an
`ERR_TOO_MANY_RETRIES` loop while the device is reachable. Another browser opens the same address
immediately.

To clear it, grant Chrome the **Nearby devices** permission, force-stop Chrome and open
`http://192.168.4.1` again. Joining the network with mobile data switched off is the quickest way to
confirm the diagnosis.

### Fallback AP is the safety net

In station mode, if the connection does not come up within about eight seconds, the device starts its
own AP anyway and keeps retrying the station connection every minute. That is why a device with a
wrong password still appears in the Wi-Fi list.

### The AP is open when it should be protected

The AP password is only applied if it is at least eight characters. A shorter one silently produces an
open network. Set a longer password in Settings → "Enable AP password".

---

## 2. `yeast2tap.local` does not resolve

mDNS is convenient and unreliable.

- It only starts **after** a successful station connection.
- Android's system resolver has no mDNS support at all, so `.local` names never resolve there; use
  the IP address on a phone.
- Many networks filter multicast.
- Some clients deprioritise `.local` names.

Use the IP address. Find it in Settings → the network row, or in your router's list, or from the
initial status message.

**The hostname is not a DHCP hostname.** The firmware never registers a name with the DHCP server, so
your router will show the ESP32's default name rather than yours. That is expected.

---

## 3. The page loads but nothing updates

The HTML comes over HTTP, but the live values come over a WebSocket. When that socket never opens, the
page looks normal — the cards, chart and navigation all render — but every value stays at `--` and the
status chip keeps its loading text. There is no error banner for this; the empty values are the symptom.

| Symptom | Cause |
|---|---|
| cards show `--` forever | the WebSocket never connected |
| values froze at a moment in time | the socket dropped |
| controls do nothing, no error | writes were refused (see §5) |

Reload the page. If it persists, something between the browser and the device is blocking WebSocket
upgrades — a proxy, a reverse proxy without upgrade support, or a captive portal intercepting the
connection.

---

## 4. The page is stale after a change

Two known cases:

- After **Init/Erase EEPROM** the device list still shows the old devices. Refresh by hand; the
  confirmation message says so.
- After changing a setting that requires a restart, the page stays open across the reboot and can show
  pre-restart values until you reload.

---

## 5. Writes are refused

The write path is: the browser asks `/authz` for permission, the controller records the client IP for
30 minutes, then the WebSocket write goes through.

What breaks it:

- **The window expired** (30 minutes of no writes). The browser normally re-authenticates silently
  using its cached credentials; if it cannot, you get this alert.
- **Another client authenticated.** Only one IP is remembered, so a second browser or phone replaces
  the first.
- **A reboot.** The window is timed from the millisecond counter, so it resets.
- **The browser has no cached credentials** since the last restart.

Reload the page and log in again.

---

## 6. The device disappeared after a router change

The saved SSID no longer exists, so it fell back to its AP. Join the AP, then:

1. Settings → Network → scan → pick the new network → save, or
2. `POST /wificon` directly (that endpoint needs no login).

---

## 7. A 5 GHz network is not in the scan list

The ESP32 is a 2.4 GHz part. A 5 GHz-only SSID cannot be joined; enable a 2.4 GHz SSID on the router.

---

## 8. The IP changes after every reboot

You are on DHCP. Set a static address in the network dialog: IP, gateway, netmask and DNS. All four,
or leave all four empty.

**Figure:** [The static IP fields] `"YT-051-network-static-ip.png"`

---

## 9. `erasewifisetting` did not forget the network

Expected in some cases. The ESP32 keeps its own copy of the credentials in NVS, and the erase
endpoint only clears the firmware's copy. The radio may then rejoin the old network.

Workarounds: change the network from the Settings page instead of erasing it, or flash the board clean
over USB.

---

## 10. Slow page, or a request that never returns

The controller is a single cooperative loop. A blocking operation delays HTTP responses:

- a filesystem write during a log commit,
- a 1-Wire conversion,
- a BLE scan,
- a pressure read (this one blocks for tens of milliseconds by design).

Occasional slowness is normal. Requests that hang for ten seconds or more point at something else —
usually the filesystem, or an operation that never completed. Check
[Recovery](06-recovery.md).

---

## 11. Settings do not survive a reboot

That is the settings file failing to write, not a UI bug. Causes:

- the filesystem is full or corrupt,
- the settings write is not atomic, so a power cut mid-write truncates the file,
- a firmware change altered the stored layout and the migration replaced the tail with defaults.

Check Settings → Sysinfo for the free space, then see [Recovery](06-recovery.md).

---

## 12. Order of escalation

1. Reload the page.
2. Restart the device (`GET /restart`, logged in).
3. Join the fallback AP and fix the network.
4. Erase Wi-Fi and rejoin.
5. Format the filesystem on port 8008 if settings or logs refuse to write.
6. Reflash over USB.

---

## Next

- [Recovery](06-recovery.md) — steps 5 and 6 in detail
- [Security](../install/08-security.md) — why some "fixes" on this page need no login
