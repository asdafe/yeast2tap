var gdcurl = "/gdc";
const DTTilt = 2;
const DTiSpindel=1;
const DTPill = 3;
const MaxCalPoint=10;

function toFixed() {
    var texts = document.querySelectorAll("input[type=text]");
    for (var i = 0; i < texts.length; i++) {
        texts[i].onchange = function() {
            // Expand exponent notation (1e-3) to plain decimals, and refuse a
            // comma instead of letting it become NaN.
            if (this.value.match(/[\-\d\.]+e[\+\-][\d]+/)) {
                var v = Num.parse(this.value);
                if (v !== null) this.value = v.toFixed(9);
                else Num.mark(this, true);
            }
        };
    }
}

function fromSetting(points){
    var pts=[];
    for(var i=0;i<points.length;i++){
        var raw = (window.device==DTTilt)? points[i][0]/10000:points[i][0]/100;
        var gravity= window.plato? points[i][1]/100:points[i][1]/10000;
        pts.push([raw,gravity]);
    }
    return pts;
}

function toSetting(points){
    var pts=[];
    for(var i=0;i<points.length;i++){
        var raw = (window.device==DTTilt)? points[i][0]*10000:points[i][0]*100;
        var gravity= window.plato? points[i][1]*100:points[i][1]*10000;
        pts.push([Math.round(raw),Math.round(gravity)]);
    }
    return pts;
}

function fill(setting) {
    window.device=setting.dev;
    window.plato =setting.plato;
    for (var name in setting) {
        var ele = Q("input[name=" + name + "]");
        if (ele) {
            if (ele.type == "checkbox") ele.checked = setting[name];
            else ele.value = setting[name];
        }
    }
    // The classic page has no Tilt/Pill controls, but a controller previously
    // configured for one still reports color/mac. Writing into a null element
    // would abort fill() and leave every later setting at its markup default.
    var colorEl = Q("#tiltcolor");
    if(typeof setting["color"] != "undefined" && colorEl) colorEl.value = setting.color;
    if(typeof setting["calpts"] != "undefined"){
        TCEditor.setPoints(fromSetting(setting.calpts));
    }
    var macEl = Q("#pilladdr");
    if(typeof setting["mac"]!= "undefined"){
        if (macEl) macEl.innerHTML = pillAddress(setting["mac"]);
        window.pMAC = setting["mac"];
    }
    // The correction coefficients live in the EEPROM, not in the text box, so
    // rebuild the formula the user typed earlier from what came back.
    window.tiltCoeffs = (setting["ttce"] && setting["ttce"].length >= 4) ? setting["ttce"] : null;
    window.tiltCoeffUnit = setting["ttceunit"];
    renderTiltFormula();
    if (typeof renderFormulaNote === "function") renderFormulaNote();

    // GravityMon is 0 = auto (follow the name the device reports), 1 = on,
    // 2 = off. The checkbox shows the effective state.
    window.gravityMonSetting = (typeof setting["gravitymon"] === "number") ? setting["gravitymon"] : 0;
    window.gravityMonDetected = !!setting["gravitymondetected"];
    applyGravityMon();
}

// The controller reports "gravitymondetected" from the name the hydrometer sends.
function gravityMonActive() {
    if (window.gravityMonSetting === 1) return true;
    if (window.gravityMonSetting === 2) return false;
    return !!window.gravityMonDetected;
}

function applyGravityMon() {
    var box = Q("#gravitymon");
    if (box) box.checked = gravityMonActive();
    var calNote = Q("#gravitymon-cal-note");
    if (calNote) calNote.hidden = !gravityMonActive();
}

/* ---------- temperature correction formula ------------------------------ */

// y = c0 + c1*t + c2*t^2 + c3*t^3, the same shape ExternalData::_remoteHydrometerReport
// evaluates. Fixed notation is required: the firmware's number parser rejects
// exponent form, and coefficients arrive as float32 noise (0.0030552861280739307),
// so round them — but never below the point where JS would switch to 5e-7.
function coeffText(v) {
    var n = Number(v);
    if (n === 0) return "0";
    var s = String(Number(n.toPrecision(10)));
    if (s.indexOf("e") >= 0) s = n.toFixed(12);
    return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function tiltFormulaText(c) {
    if (!c || c.length < 4) return "";
    var text = coeffText(c[0]);
    for (var i = 1; i < 4; i++) {
        var v = Number(c[i]);
        if (!v) continue;
        text += (v < 0 ? " " : " +") + coeffText(c[i]) + (i === 1 ? "*t" : "*t^" + i);
    }
    return text;
}

function renderTiltFormula() {
    var box = Q("#tilt-correction-formula");
    if (!box) return;
    box.value = tiltFormulaText(window.tiltCoeffs);
}

// Parses "c0 + c1*t + c2*t^2 + c3*t^3" (in any term order, * optional).
// Returns [c0,c1,c2,c3] or null when the text is not a polynomial in t.
function parseTiltFormula(text) {
    var s = String(text == null ? "" : text).replace(/\s+/g, "");
    if (s === "") return [0, 0, 0, 0];
    if (s.indexOf(",") >= 0) return null;
    var out = [0, 0, 0, 0];
    var rest = s;
    while (rest.length) {
        var m = /^([+-]?)(\d*\.?\d*)(\*?t(?:\^(\d+))?)?/.exec(rest);
        if (!m || m[0] === "") return null;
        var sign = m[1] === "-" ? -1 : 1;
        var numText = m[2];
        var hasT = !!m[3];
        var power = hasT ? (m[4] === undefined ? 1 : parseInt(m[4], 10)) : 0;
        if (numText === "" && hasT) numText = "1";
        if (numText === "" || power > 3) return null;
        out[power] += sign * Number(numText);
        rest = rest.slice(m[0].length);
    }
    for (var i = 0; i < 4; i++) if (!isFinite(out[i])) return null;
    return out;
}

function getFormula(){
    var pts = TCEditor.getPoints();
    var coes;
    if(pts.length < 2){
        coes= [0,1,0,0];
    } else {
        var poly = regression('polynomial', pts, (pts.length > 3) ? 3 : ((pts.length > 2) ? 2 : 1), {
            precision: 9
        });
        coes= [
            poly.equation[0],
            poly.equation[1],
            (pts.length > 2)? poly.equation[2]:0,
            (pts.length > 3)? poly.equation[3]:0,
        ];
    }
    // Write the coefficients when the page has the a0..a3 boxes (classic page)
    // and show the curve as text as well.
    for(var i=0;i<4;i++) {
        var f = Q('input[name="a' + i +'"]');
        if (f) f.value = coes[i];
    }
    var out = Q("#cal_coeffs");
    if (out) {
        // Nothing fitted yet: showing "y = 1x" would pretend a curve exists.
        out.innerHTML = (pts.length < 2) ? "" : formatPoly(coes);
    }
    window.calCoeffs = coes;
}

function formatPoly(coes){
    var parts = [];
    var names = ["", "x", "x&sup2;", "x&sup3;"];
    for (var i = 3; i >= 0; i--) {
        var v = Number(coes[i]);
        if (!isFinite(v)) v = 0;
        if (i > 0 && Math.abs(v) < 1e-12) continue;
        var sign = (v < 0) ? "&minus;" : (parts.length ? "+" : "");
        parts.push(sign + Math.abs(v).toFixed(6) + "&nbsp;" + names[i]);
    }
    return "y = " + (parts.length ? parts.join(" ") : "0");
}

function save() {
    var inputs = document.getElementsByTagName("input");
    var setting = {};

    setting.dev = 1; // always iSpindel
    setting.calpts= toSetting(TCEditor.getPoints());

    for (var i = 0; i < inputs.length; i++) {
        var ele = inputs[i];
        if(ele.name != "" && ! ele.classList.contains('notsave') ){
            if (ele.type == "checkbox") setting[ele.name] = ele.checked;
            else if (ele.type == "text" && ele.classList.contains("num")) {
                // Numeric settings travel as real JSON numbers; a comma is refused
                // here instead of reaching the controller as a silent zero.
                var v = Num.field(ele, ele.name);
                if (v === null) return;
                setting[ele.name] = v;
            } else if (ele.type == "text") setting[ele.name] = ele.value;
        }
    }

    // Temperature correction coefficients. The box is display + entry for the
    // very numbers the controller stores, so a formula typed here survives a
    // reload instead of being dropped. The tag follows the mode being saved and
    // an empty box sends nothing (see the ESP32 page for the full reasoning).
    var formulaBox = Q("#tilt-correction-formula");
    var formulaUnit = effectiveFormulaUnit(); // 2 = tilt angle, 1 = SG
    if (formulaBox && formulaBox.value.trim() !== "") {
        var coeffs = parseTiltFormula(formulaBox.value);
        if (coeffs === null) {
            setSaveNote("<%= gravity_formula_invalid %>", false);
            alert("<%= gravity_formula_invalid %>");
            return;
        }
        var same = window.tiltCoeffs && window.tiltCoeffs.length === 4 &&
            Math.abs(window.tiltCoeffs[0] - coeffs[0]) < 1e-9 &&
            Math.abs(window.tiltCoeffs[1] - coeffs[1]) < 1e-9 &&
            Math.abs(window.tiltCoeffs[2] - coeffs[2]) < 1e-9 &&
            Math.abs(window.tiltCoeffs[3] - coeffs[3]) < 1e-9;
        if (!same || formulaUnit !== window.tiltCoeffUnit) {
            setting.ttce = coeffs;
            setting.ttceunit = formulaUnit;
        }
    }

    // The fitted curve itself; without it the controller keeps the identity.
    getFormula();
    if (window.calCoeffs && setting.calpts && setting.calpts.length >= 2) {
        setting.gcce = window.calCoeffs;
    }

    // 0 keeps following the detected name, 1/2 are the user's explicit choice.
    setting.gravitymon = (typeof window.gravityMonSetting === "number") ? window.gravityMonSetting : 0;

    //    console.log("result=" + setting);
    setSaveNote("<%= gravity_saving %>");
    s_ajax({
        url: gdcurl,
        m: "POST",
        mime: "aplication/json",
        data: JSON.stringify(setting),
        success: function(a) {
            setSaveNote("<%= gravity_saved %>");
            if (setting.ttce) {
                window.tiltCoeffs = setting.ttce.slice();
                window.tiltCoeffUnit = setting.ttceunit;
            }
            updateCalibrationState();
        },
        fail: function(a) {
            setSaveNote("<%= gravity_save_failed %>", false);
            alert("<%= script_control_failed_updating_data %>" + a)
        }
    });
}

var saveNoteTimer = null;

// Feedback in the save bar: visible, reversible and self-clearing. Alerts alone
// were easy to miss and left no trace that anything happened.
function setSaveNote(text, ok) {
    var el = Q("#save-note");
    if (!el) return;
    el.innerHTML = text || "";
    el.className = "g-save-note" + (text && ok === false ? " is-bad" : "");
    if (saveNoteTimer) { clearTimeout(saveNoteTimer); saveNoteTimer = null; }
    if (text && ok !== false) {
        saveNoteTimer = setTimeout(function () { el.innerHTML = ""; }, 4000);
    }
}


function validSG(g){
    if(g > 0.8 && g<1.5) return true;
    return false;
}
var TCEditor={
    dt:0,
    init:function(){
        var tr=Q("#tiltcalpoints tr.calpoint");
        tr.parentNode.removeChild(tr);
        this.tr=tr;
        this.points=[];
        Q("#btn-addcal").disabled=false;
        Q("#btn-addcal").onclick=function(){ TCEditor.add();};
    },
    getPoints:function(){
        return this.points;
    },
    setPoints:function(points){
        this.points=points;
        this.render();
    },
    add:function(){
        var uncal = Num.field(Q("#uncalvalue"),"<%= grav_uncalibrated_value %>");
        if(uncal===null) return;
        var cal = Num.field(Q("#calvalue"),"<%= grav_calibrated_value %>");
        if(cal===null) return;

        this.points.push([uncal,cal]);
        this.remove_all();
        this.render();
    },
    remove_all:function(){
        doAll("#tiltcalpoints tr.calpoint",function(div){
            div.parentNode.removeChild(div);
        });
    },
    clear:function(){
        this.removeall();
        this.points=[];
    },
    newPoint:function(idx,data){
        var tr= this.tr.cloneNode(true);
        var t=this;
        tr.querySelector(".delbutton").onclick=function(e){
            e.preventDefault();
            console.log("del "+idx);
            t.points.splice(idx,1);
            t.remove_all();
            t.render();
            return false;
        };
    
        tr.querySelector(".uncaldata").innerHTML="" + data[0];
        tr.querySelector(".caldata").innerHTML="" + data[1];
    
        return tr;
    },
    
    render:function(){
        this.points.sort((a,b)=>{
            if(a[0] < b[0]) return -1;
            else if(a[0] > b[0]) return 1;
            else{
                if (a[1] < b[1]) return -1;
                else if (a[1] > b[1]) return 1;
                else return 0;
            }
        });
        for(var i=0;i< this.points.length;i++){
            var tr=this.newPoint(i,this.points[i]);
            Q("#tiltcalpoints tbody").appendChild(tr);
        }
        Q("#btn-addcal").disabled =(this.points.length >= MaxCalPoint);
        updateCalibrationState();
    }
    };

function tiltcal(){
    Q("#dlg_addcalpoint").style.display="block";
}

function closeTiltCal(){
    Q("#dlg_addcalpoint").style.display="none";
    getFormula();
    updateCalibrationState();
    return false;
}

/* ---------- calibration state chip -------------------------------------- */

// Three honest states:
//   fewer than 2 points      -> nothing can be applied yet
//   2+ points, teaching off  -> the curve is ready, the user can apply it
//   2+ points, teaching on   -> the controller is using the curve
function updateCalibrationState(){
    var n = (window.TCEditor && TCEditor.getPoints) ? TCEditor.getPoints().length : 0;
    var applied = !!(Q("#cal") && Q("#cal").checked);
    var chip = Q("#formula-state");
    var text = Q("#formula-text");

    var pts = Q("#cal-points");
    if (pts) pts.innerHTML = "" + n;
    var limit = Q("#cal-limit-note");
    if (limit) limit.innerHTML = n + " / " + MaxCalPoint;

    if (typeof renderFormulaNote === "function") renderFormulaNote();
    if (!chip || !text) return;
    chip.className = "g-chip";
    if (n < 2) {
        text.innerHTML = "<%= gravity_needs_points %>";
    } else if (applied) {
        chip.className = "g-chip is-live";
        text.innerHTML = "<%= gravity_formula_applied %>";
    } else {
        chip.className = "g-chip is-ready";
        text.innerHTML = "<%= gravity_formula_ready %>";
    }
    // The classic page shows the curve in the a0..a3 boxes; refill them so they
    // follow the point list instead of only updating when the dialog closes.
    if (n >= 2 && typeof getFormula === "function") getFormula();
}

/* ---------- correction basis note --------------------------------------- */

// The coefficients describe either the tilt angle (curve on, Tilt device) or the
// reported SG itself. The basis follows the device, not the "Calculated by
// yeast2tap" switch, for the same reason as on the embedded page: a GravityMon
// or iSpindel reports SG, so its polynomial must correct SG even with the curve
// off.
function effectiveFormulaUnit(){
    return (String(window.device) === "2" && Q("#cal") && Q("#cal").checked) ? 2 : 1;
}

function formulaPolyValueAt(t){
    var c = window.tiltCoeffs;
    if (!c || c.length < 4) return null;
    var v = c[0] + c[1] * t + c[2] * t * t + c[3] * t * t * t;
    return isFinite(v) ? v : null;
}

function renderFormulaNote(){
    var el = Q("#formula-unit-note");
    if (!el) return;
    var box = Q("#tilt-correction-formula");
    if (!box || box.value.trim() === "") { el.innerHTML = ""; el.className = "g-hint"; return; }

    var unit = window.tiltCoeffUnit;
    var want = effectiveFormulaUnit();
    var parts = [];
    var warn = false;

    if (unit === 2 && want !== 2) {
        parts.push("<%= gravity_formula_basis_mismatch %>");
        warn = true;
    } else if (unit === 2) {
        parts.push("<%= gravity_formula_basis_tilt %>");
    } else if (unit === 1) {
        parts.push("<%= gravity_formula_basis_sg %>");
    } else {
        parts.push("<%= gravity_formula_basis_unknown %>");
    }

    var tc = Q("#tc");
    if (tc && !tc.checked) {
        parts.push("<%= gravity_formula_tc_off %>");
    } else if (unit === 1) {
        // What the controller actually did on the last reading.
        var d = (typeof window.gdDelta === "number" && isFinite(window.gdDelta)) ? window.gdDelta : null;
        if (d !== null) {
            parts.push("<%= gravity_formula_value %>"
                .replace("%v", (d >= 0 ? "+" : "&minus;") + Math.abs(d).toFixed(4)));
        }
    }

    el.innerHTML = parts.join(" ");
    el.className = "g-hint" + (warn ? " is-warn" : "");
}

/* ---------- last reading ------------------------------------------------ */

var gravityStatusTimer = null;
var STATUS_PERIOD_MS = 10000;

function usesPlato(){
    return !!(Q("#plato") && Q("#plato").checked);
}

function fmtGravity(sg){
    if (sg === null || typeof sg === "undefined" || !isFinite(sg)) return "--";
    if (usesPlato()) return BrewMath.sg2pla(sg).toFixed(1) + " &deg;P";
    return sg.toFixed(3);
}

// Difference the controller applied: offset plus the temperature polynomial.
function fmtGravityDelta(raw, corrected){
    if (raw === null || corrected === null || !isFinite(raw) || !isFinite(corrected)) return "--";
    if (usesPlato()) {
        var p = BrewMath.sg2pla(corrected) - BrewMath.sg2pla(raw);
        return (p >= 0 ? "+" : "&minus;") + Math.abs(p).toFixed(1) + " &deg;P";
    }
    var d = corrected - raw;
    return (d >= 0 ? "+" : "&minus;") + Math.abs(d).toFixed(3);
}

function fmtStamp(epoch){
    if (!epoch) return "--";
    var d = new Date(epoch * 1000);
    if (isNaN(d.getTime())) return "--";
    return d.toLocaleDateString() + " " + d.toLocaleTimeString();
}

function setChipText(chipSel, textSel, text, cls){
    var chip = Q(chipSel);
    var label = Q(textSel);
    if (label) label.innerHTML = text;
    if (chip) chip.className = "g-chip" + (cls ? " " + cls : "");
}

// A hydrometer sleeps between reports, so "connected" is never true. The chip
// only says whether a report arrived recently enough to trust the numbers.
function refreshGravityStatus(){
    s_ajax({
        url: "/getstatus",
        m: "GET",
        success: function(d) {
            var j;
            try { j = JSON.parse(d); } catch (e) { return; }
            var g = j.gravity || {};
            var raw = (typeof g.reportedSg === "number") ? g.reportedSg : null;
            var fixed = (typeof g.sg === "number") ? g.sg : null;

            var rep = Q("#lv-reported"), cor = Q("#lv-corrected"), del = Q("#lv-delta");
            if (rep) rep.innerHTML = fmtGravity(raw);
            if (cor) cor.innerHTML = fmtGravity(fixed);
            if (del) del.innerHTML = fmtGravityDelta(raw, fixed);
            // The formula note quotes this difference: it is the controller's own
            // evidence that the polynomial ran.
            window.gdDelta = (raw !== null && fixed !== null) ? (fixed - raw) : null;
            if (typeof renderFormulaNote === "function") renderFormulaNote();
            var upd = Q("#lv-updated");
            if (upd) upd.innerHTML = fmtStamp(g.lastUpdate);
            var dev = Q("#lv-device");
            if (dev) dev.innerHTML = g.enabled && g.device ? g.device : "";

            if (!g.enabled) {
                setChipText("#conn-chip", "#conn-text", "<%= gravity_no_device %>", "");
            } else if (!g.lastUpdate) {
                setChipText("#conn-chip", "#conn-text", "<%= gravity_waiting %>", "");
            } else {
                var age = Math.round(Date.now() / 1000) - g.lastUpdate;
                if (age >= 0 && age < 600) {
                    setChipText("#conn-chip", "#conn-text", "<%= gravity_live %>", "is-live");
                } else {
                    setChipText("#conn-chip", "#conn-text", "<%= gravity_stale %>", "");
                }
            }
        }
    });
}

function startGravityStatus(){
    refreshGravityStatus();
    if (gravityStatusTimer) clearInterval(gravityStatusTimer);
    gravityStatusTimer = setInterval(refreshGravityStatus, STATUS_PERIOD_MS);
}

function init(classic) {
    if (typeof classic == "undefined") classic = false;
    window.device=1; // default to NONE


    toFixed();
    s_ajax({
        url: gdcurl + "?data",
        m: "GET",
        success: function(a) {
            fill(JSON.parse(a));
            updateCalibrationState();
            getFormula();
            // The markup starts with Plato checked; the device may say otherwise,
            // so re-render the reading once the real settings are known.
            refreshGravityStatus();
        },
        fail: function(a) {
            alert("<%= grav_failed_getting_data %>" + a)
        }
    });
    TCEditor.init();

    // The curve only counts as "applied" when Calculated by yeast2tap is on.
    if (Q("#cal")) Q("#cal").onchange = updateCalibrationState;
    if (Q("#plato")) Q("#plato").onchange = refreshGravityStatus;
    if (Q("#tc")) Q("#tc").onchange = function () {
        if (typeof renderFormulaNote === "function") renderFormulaNote();
    };
    // The GravityMon box overrides the auto-detection; reflect it immediately.
    if (Q("#gravitymon")) Q("#gravitymon").onchange = function () {
        window.gravityMonSetting = this.checked ? 1 : 2;
        applyGravityMon();
    };

    startGravityStatus();

    if (!classic) {
        getActiveNavItem();
        Q("#verinfo").innerHTML = "v" + JSVERSION;
    }
}


