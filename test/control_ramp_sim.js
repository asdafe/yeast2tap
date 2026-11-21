// Mirrors BrewProfile::tempByTimeGravity / _toNextStep for the easy-ramp shape.
// days are hundredths of a day. A zero-length time step is completed immediately,
// then the ramp uses that step's temperature as its start. A zero-length SG step
// stays until gravity is reached and is not skipped before it completes.
function daySeconds(days) { return days * 864; }
function run(steps, t, gravity) {
  var start = 0;
  var step = 0;
  var entered = 0;
  function duration(i) { return daySeconds(steps[i].d || 0); }
  function done(i, now) {
    var s = steps[i];
    var timeOk = duration(i) <= (now - entered);
    if (s.c === "t" || s.c === "r") return timeOk;
    if (s.c === "g") return gravity <= s.g;
    return false;
  }
  while (step < steps.length && done(step, t)) {
    entered += duration(step);
    step++;
    while (step < steps.length && steps[step].c !== "g" && duration(step) === 0) step++;
  }
  if (t < start || step >= steps.length) return null;
  if (steps[step].c === "r") {
    var prev = steps[step - 1].t;
    var next = steps[step + 1].t;
    var u = (t - entered) / duration(step);
    return Math.round((prev + (next - prev) * u) * 10) / 10;
  }
  return steps[step].t;
}
var steps = [{ c: "t", d: 0, t: 19 }, { c: "r", d: 300, t: 0 }, { c: "t", d: 100, t: 22 }];
var a = run(steps, 0, 1.05);
var mid = run(steps, 1.5 * 86400, 1.05);
var end = run(steps, 3 * 86400, 1.05);
var after = run(steps, 3.5 * 86400, 1.05);
if (a !== 19) throw new Error("ramp start " + a);
if (mid !== 20.5) throw new Error("ramp mid " + mid);
if (end !== 22 && after !== 22) throw new Error("ramp end " + end + " " + after);
var sg = [{ c: "g", d: 0, t: 19, g: 1.014 }, { c: "r", d: 200, t: 0 }, { c: "t", d: 100, t: 21 }];
if (run(sg, 86400, 1.02) !== 19) throw new Error("sg hold");
var sgRamp = run(sg, 86400, 1.01);
if (sgRamp !== 20) throw new Error("sg ramp " + sgRamp);
console.log("easy ramp curve ok", a, mid, end, after);
