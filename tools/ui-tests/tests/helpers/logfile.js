// Builders for the BrewPiLess log format (LOG_VERSION 7) used by y2tlogviewer.
//
// The firmware writes a header, an optional device-info block, the calibration
// block and then a stream of period records: [0xF0, mask, 2 bytes per changed
// value]. Bit order is fixed by src/BrewLogger.h: five temperatures, aux temp,
// gravity/tilt, pressure. These helpers let the tests feed the viewer without a
// real controller.

export const TAG = {
  period: 0xf0,
  state: 0xf1,
  calibration: 0xf3,
  mode: 0xf4,
  originGravity: 0xf8,
  specificGravity: 0xfb,
  header: 0xff,
  sessionSummary: 0xe1,
};

/** Temperature as the firmware packs it: 1/100 degC, negatives offset from 22500. */
export function encodeTemp(celsius) {
  let value = Math.round(celsius * 100);
  if (value < 0) value = 22500 - value;
  return [(value >> 8) & 0x7f, value & 0xff];
}

/** Gravity as the firmware packs it: SG * 10000 (Plato * 100). */
export function encodeGravity(gravity, plato = false) {
  const value = Math.round(plato ? gravity * 100 : gravity * 10000);
  return [(value >> 8) & 0xff, value & 0xff];
}

/** Tilt angle in a calibrating log: degrees * 100. */
export function encodeTilt(angle) {
  const value = Math.round(angle * 100);
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * A v7 header. Defaults describe a celsius, non-calibrating, SG log with no
 * device-info payload, which is what a plain fermentation session looks like.
 *
 * `correction` adds a device-info block with the temperature correction the
 * firmware applied before logging (GDI type 3, four big-endian floats). The
 * gravity columns of such a log are "raw reading + correction".
 */
export function header({ startTime = 1700000000, interval = 60, calibrating = false, plato = false, fahrenheit = false, correction = null } = {}) {
  // The firmware starts from LOG_VERSION with the 0xE0 flag block already set
  // (0x20 = "not calibrating", 0x40 = "not plato") and XORs a bit to flip it;
  // the decoder reads a set bit as "no". Base for Fahrenheit already has 0x10.
  let tag = 0x07 | (fahrenheit ? 0xf0 : 0xe0);
  if (calibrating) tag ^= 0x20;
  if (plato) tag ^= 0x40;
  const st = startTime >>> 0;
  const out = [
    TAG.header, tag,
    (interval >> 8) & 0xff, interval & 0xff,
    (st >>> 24) & 0xff, (st >>> 16) & 0xff, (st >>> 8) & 0xff, st & 0xff,
  ];
  if (correction) {
    const payload = [3, 16];
    for (const c of correction) {
      const view = new DataView(new ArrayBuffer(4));
      view.setFloat32(0, c, false);
      payload.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    }
    out.push(1 + payload.length, 1 /* GravityDeviceIspindel */, ...payload);
  } else {
    out.push(1, 0); // device info block: length 1, type 0 (none)
  }
  out.push(TAG.calibration, 0); // no calibration points
  return out;
}

/** One period record. `values` is indexed like the log mask. */
export function periodRecord(values) {
  const order = ['beerSet', 'beerTemp', 'fridgeTemp', 'fridgeSet', 'roomTemp', 'auxTemp', 'gravity', 'pressure'];
  let mask = 0;
  const bytes = [];
  order.forEach((key, index) => {
    // In a calibrating log the gravity slot carries the tilt angle instead.
    const value = key === 'gravity' && values.tilt !== undefined ? values.tilt : values[key];
    if (value === undefined || value === null || Number.isNaN(value)) return;
    mask |= 1 << index;
    if (key === 'gravity') {
      bytes.push(...(values.tilt !== undefined ? encodeTilt(value) : encodeGravity(value, values.plato)));
    } else if (key === 'pressure') {
      const raw = Math.round((value + 100) * 10);
      bytes.push((raw >> 8) & 0x7f, raw & 0xff);
    } else bytes.push(...encodeTemp(value));
  });
  return [TAG.period, mask, ...bytes];
}

/**
 * A log with a changing gravity and a steady beer temperature, the shape a
 * fermentation session produces.
 */
export function fermentationLog() {
  const data = [];
  data.push(...header());
  data.push(TAG.mode, 'F'.charCodeAt(0));
  data.push(TAG.state, 1);
  data.push(...periodRecord({ beerSet: 20, beerTemp: 20, fridgeTemp: 19.5, fridgeSet: 19, roomTemp: 21, auxTemp: 20.5, gravity: 1.060 }));
  data.push(...periodRecord({ beerTemp: 20.1, fridgeTemp: 19.6, gravity: 1.052 }));
  data.push(...periodRecord({ beerTemp: 20.1, fridgeTemp: 19.4, gravity: 1.040 }));
  data.push(...periodRecord({ beerTemp: 20.2, fridgeTemp: 19.5, gravity: 1.031 }));
  return new Uint8Array(data);
}

/**
 * A log written while calibrating: the gravity slot carries the tilt angle and
 * the device temperature is logged only when it changed, exactly like the
 * firmware (BrewLogger::logData resets _extTemp after writing it).
 *
 * rows: [{ tilt, aux?, raw? }]  raw = SG reported out of band by the device.
 */
export function calibratingLog({ points = [], rows = [] } = {}) {
  const data = [];
  data.push(...header({ calibrating: true }));
  data.push(TAG.mode, 'F'.charCodeAt(0));
  data.push(TAG.state, 1);
  if (points.length) {
    data.push(TAG.calibration, points.length);
    for (const [raw, sg] of points) data.push(...encodeTilt(raw), ...encodeGravity(sg));
  }
  for (const row of rows) {
    const values = { beerSet: 20, beerTemp: 20, fridgeTemp: 19.5, fridgeSet: 19, roomTemp: 21, tilt: row.tilt };
    if (row.aux !== undefined) values.auxTemp = row.aux;
    data.push(...periodRecord(values));
    if (row.raw !== undefined) data.push(TAG.specificGravity, 0, ...encodeGravity(row.raw));
  }
  return new Uint8Array(data);
}

/**
 * The session summary block BrewLogger::_addSessionSummary writes when a log is
 * stopped: [0xE1, length] then the JSON bytes carried as [FillTag, byte] pairs,
 * 120 payload bytes per record.
 */
export function sessionSummary(summary, chunk = 120) {
  const bytes = new TextEncoder().encode(JSON.stringify(summary));
  const out = [];
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const n = Math.min(chunk, bytes.length - offset);
    out.push(TAG.sessionSummary, n);
    for (let i = 0; i < n; i++) out.push(0xf7, bytes[offset + i]);
  }
  return out;
}

/** Concatenate the chunk array that BrewChart.partial() returns. */export function concatChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
