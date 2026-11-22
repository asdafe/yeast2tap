'use strict';
/*
 * Host-side check of the Independent-mode heater pulse PI.
 *
 * The arithmetic below mirrors TempControl::updateIndependentPulsePi() in
 * src/TempControl.cpp (same fixed-point scaling, same clamps) so the rules the
 * firmware relies on can be tested without a board.
 *
 * Run: node test/control_pulse_pi_sim.js
 */

const LSB = 32;                 // one DS18B20 step, 1/512 degC units
const DUTY_MAX = 50;            // %
const ONSEC_MAX = 300;
const ONSEC_DEFAULT = 120;
const OFFSEC_MIN = 60;
const OFFSEC_MAX = 21600;
const PEAK_WAIT_MAX = 2400;
const GUARD_FLOOR = 48;
const GUARD_MAX = 256;
const SAFETY_ABOVE = 128;
const INTEGRAL_MAX = 25 * 512 * 60;
const AMP_GAIN_NUM = 2;
const AMP_GAIN_DEN = 5;

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok - ' + msg);
}

class PulsePi {
  constructor(cc) {
    this.cc = Object.assign({ indPiKp: 20 * 512, indPiKi: 8 * 512, indPiPulseLsb: LSB,
      minHeatTime: 30, minHeatIdleTime: 60, maxHeatTime: 0 }, cc);
    this.set = 0;
    this.phase = 0; this.integral = 0; this.duty = 0;
    this.onTime = ONSEC_DEFAULT; this.offTime = 0;
    this.amp = 0; this.coast = 0; this.peak = null; this.cutTemp = null;
    this.cycleMin = null; this.belowPeak = 0; this.waitStart = 0;
    this.lastOff = 0; this.lastSec = 0; this.haveCycle = false;
    this.heaterOn = false; this.lastHeatOn = 0;
    this.clampOnTime();
  }
  clampOnTime() {
    let on = this.onTime;
    if (on < this.cc.minHeatTime) on = this.cc.minHeatTime;
    if (this.cc.maxHeatTime !== 0 && on > this.cc.maxHeatTime) on = this.cc.maxHeatTime;
    if (on > ONSEC_MAX) on = ONSEC_MAX;
    if (on < 1) on = 1;
    this.onTime = on;
  }
  guard() {
    let g = this.coast + (this.coast >> 2);
    if (g < GUARD_FLOOR) g = GUARD_FLOOR;
    if (g > GUARD_MAX) g = GUARD_MAX;
    return g;
  }
  timeSince(t) { return (t - this.lastSec) >>> 0; }
  elapsed(since, now) { return ((now - since) >>> 0); }
  update(secs, beerFast, beerSlow) {
    let dt = this.timeSince(secs);
    // timeSince uses lastSec; emulate C ticks.timeSince
    dt = ((secs - this.lastSec) >>> 0);
    if (dt === 0) dt = 1;
    if (dt > 60) dt = 60;
    this.lastSec = secs;

    const err = this.set - beerSlow;
    const pTerm = (this.cc.indPiKp * err) >> 18;
    let iTerm = this.cc.indPiKi > 0 ? (((this.integral / 60) | 0) * this.cc.indPiKi) >> 18 : 0;
    let unsat = pTerm + iTerm;
    const satHi = unsat > DUTY_MAX;
    const satLo = unsat < 0;
    if (!((err > 0 && satHi) || (err < 0 && satLo))) {
      this.integral += err * dt;
      if (this.integral > INTEGRAL_MAX) this.integral = INTEGRAL_MAX;
      else if (this.integral < -INTEGRAL_MAX) this.integral = -INTEGRAL_MAX;
      if (this.cc.indPiKi > 0) {
        iTerm = (((this.integral / 60) | 0) * this.cc.indPiKi) >> 18;
        unsat = pTerm + iTerm;
      }
    }
    if (unsat < 0) unsat = 0;
    if (unsat > DUTY_MAX) unsat = DUTY_MAX;
    this.duty = unsat;

    this.clampOnTime();
    let duty = this.duty;
    if (duty < 1) duty = 1;
    let off = Math.floor((this.onTime * (100 - duty)) / duty);
    if (off < this.cc.minHeatIdleTime) off = this.cc.minHeatIdleTime;
    if (off < OFFSEC_MIN) off = OFFSEC_MIN;
    if (off > OFFSEC_MAX) off = OFFSEC_MAX;
    this.offTime = off;

    const guard = this.guard();
    const halfAmp = this.amp > 0 ? (this.amp >> 1) : 16;
    const approaching = err > (guard << 1);
    const upper = approaching ? this.set - guard : this.set + halfAmp;
    const lower = approaching ? this.set - guard : this.set - halfAmp;

    if (this.cycleMin === null || beerSlow < this.cycleMin) this.cycleMin = beerSlow;

    if (this.phase === 1) {                        // HEAT
      this.heaterOn = true;
      const onFor = this.elapsed(this.lastHeatOn, secs);
      const safety = beerFast >= this.set + SAFETY_ABOVE;
      const atUpper = beerSlow >= upper;
      const expired = onFor >= this.onTime;
      if (safety || atUpper || expired) {
        this.heaterOn = false;
        this.lastOff = secs;
        this.phase = 2; this.peak = beerSlow; this.cutTemp = beerSlow;
        this.belowPeak = 0; this.waitStart = secs;
      }
      return;
    }

    if (this.phase === 2) {                        // WAIT_PEAK
      this.heaterOn = false;
      if (this.peak === null || beerSlow > this.peak) { this.peak = beerSlow; this.belowPeak = 0; }
      else if (beerSlow < this.peak) { if (this.belowPeak < 255) this.belowPeak++; }
      else this.belowPeak = 0;

      if (this.belowPeak >= 3 || this.elapsed(this.waitStart, secs) > PEAK_WAIT_MAX) {
        if (this.peak !== null && this.cutTemp !== null && this.peak > this.cutTemp) {
          const c = this.peak - this.cutTemp;
          this.coast = this.haveCycle ? ((this.coast * 3 + c) / 4) | 0 : c;
        }
        if (this.peak !== null && this.cycleMin !== null && this.peak > this.cycleMin) {
          const a = this.peak - this.cycleMin;
          this.amp = this.haveCycle ? ((this.amp * 3 + a) / 4) | 0 : a;
          const want = this.cc.indPiPulseLsb > 0 ? this.cc.indPiPulseLsb : LSB;
          if (a > 16) {
            const ratio = (want << 9) / a;
            let next = this.onTime + Math.floor((this.onTime * (ratio - 512) * AMP_GAIN_NUM) / (512 * AMP_GAIN_DEN));
            if (next < this.cc.minHeatTime) next = this.cc.minHeatTime;
            if (next > ONSEC_MAX) next = ONSEC_MAX;
            if (next < 1) next = 1;
            this.onTime = next;
          }
        }
        this.haveCycle = true;
        this.phase = 0; this.peak = null; this.cutTemp = null; this.cycleMin = beerSlow;
      }
      return;
    }

    // IDLE
    this.heaterOn = false;
    const gapElapsed = this.lastOff === 0 || this.elapsed(this.lastOff, secs) >= this.offTime;
    const nearTarget = beerSlow <= lower;
    if (gapElapsed && nearTarget && this.elapsed(this.lastHeatOn, secs) > this.cc.minHeatIdleTime) {
      this.phase = 1; this.heaterOn = true; this.lastHeatOn = secs; this.cycleMin = beerSlow;
    }
  }
}

// Very small plant: beer warms at a rate proportional to the pulse, cools slowly.
function simulate(cfg, seconds, startTemp) {
  const c = Object.assign({ indPiKp: 20 * 512, indPiKi: 8 * 512, indPiPulseLsb: LSB,
    minHeatTime: 30, minHeatIdleTime: 60, maxHeatTime: 0 }, cfg);
  const pi = new PulsePi(c);
  pi.set = 0;
  let T = startTemp;
  const pulses = [];
  let pulseStart = null;
  let maxUp = -1e9;
  for (let t = 1; t <= seconds; t++) {
    const fast = Math.round(T);
    const slow = Math.round(T);
    const wasOn = pi.heaterOn;
    pi.update(t, fast, slow);
    if (pi.heaterOn && !wasOn) pulseStart = t;
    if (!pi.heaterOn && wasOn) {
      pulses.push(t - pulseStart);
      if (pulses.length <= 3) maxUp = Math.max(maxUp, T);
    }
    // a pulse of the learned length moves the beer by ~1 LSB; idle cools it slowly
    if (pi.heaterOn) T = Math.min(T + LSB / Math.max(30, pi.onTime), 2000);
    else T = Math.max(T - LSB / 900, -2000);
  }
  return { pi, pulses, T };
}

console.log('pulse PI: duty ceiling and idle floor');
const a = simulate({}, 20000, -400);   // start 0.78 degC below the setting
assert(a.pi.duty <= DUTY_MAX, 'duty never exceeds ' + DUTY_MAX + '%');
assert(a.pi.offTime >= a.pi.onTime, 'idle gap is at least as long as the pulse');
assert(a.pi.offTime >= OFFSEC_MIN, 'offTime is not shorter than the 60 s floor');

console.log('pulse PI: 300 s hard cap');
const b = simulate({ maxHeatTime: 900 }, 20000, -1024 /* 2 degC below */);
let longest = 0;
for (const L of b.pulses) longest = Math.max(longest, L);
assert(longest <= ONSEC_MAX + 1, 'no pulse longer than 300 s (longest ' + longest + ' s)');
assert(b.pulses.length > 20, 'a 2 degC gap is closed by many pulses (' + b.pulses.length + ')');

console.log('pulse PI: 0.25 degC safety cut');
const pi = new PulsePi({ minHeatTime: 1, minHeatIdleTime: 1 });
pi.set = 0;
pi.phase = 1; pi.heaterOn = true; pi.lastHeatOn = 0; pi.onTime = 300;
pi.update(1, SAFETY_ABOVE, 0);           // fast probe at set + 0.25
assert(pi.heaterOn === false, 'heater is cut at beerFast >= set + 0.25 degC');

console.log('pulse PI: anti-windup');
const w = new PulsePi({});
w.set = 0;
for (let t = 1; t < 100000; t++) w.update(t, -2000, -2000);    // stuck far below
assert(w.integral <= INTEGRAL_MAX, 'integral stays within its clamp');
assert(w.duty === DUTY_MAX, 'duty saturates at the ceiling instead of winding up');

console.log('pulse PI: learning converges');
const l = simulate({}, 200000, -200);
assert(l.pi.haveCycle, 'at least one full cycle was measured');
assert(l.pi.onTime > l.pi.cc.minHeatTime, 'learned pulse is above the floor');
assert(l.pi.onTime <= ONSEC_MAX, 'learned pulse stays under the cap');

console.log('\nall pulse-PI checks passed');
