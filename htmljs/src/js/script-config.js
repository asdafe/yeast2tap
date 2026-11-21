function formatIP(ip) {
    if (ip == "0.0.0.0") return "";
    return ip;
}

// Reveal/hide the password fields. The button swaps its own icon and pressed
// state so the field itself stays a plain input the rest of the page reads.
function togglePwd(btn) {
    var input = btn.parentNode.querySelector("input");
    if (!input) return;
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    var use = btn.querySelector("use");
    if (use) use.setAttribute("href", show ? "#i-cfg-eye-off" : "#i-cfg-eye");
}

// A save that does not restart the controller used to finish silently.
function setSaveNote(text, ok) {
    var notes = document.querySelectorAll(".cfg-save-note");
    for (var i = 0; i < notes.length; i++) {
        notes[i].textContent = text || "";
        notes[i].className = "cfg-save-note" + (text && !ok ? " is-bad" : "");
    }
}

/* ---------- AP password ------------------------------------------------ */

// The access point key is its own setting (Settings::apPassword), stored apart
// from the web login password, so this box neither mirrors nor overwrites it.
function syncApPassword() {
    var mirror = Q("#ap-pass");
    var row = Q("#ap-pass-row");
    var warn = Q("#ap-pass-warn");
    var eap = Q("#eap");
    if (!mirror || !row || !eap) return;

    row.hidden = !eap.checked;
    // WiFiSetup::createNetwork() falls back to an OPEN access point when the key
    // is shorter than 8 characters, so say that instead of failing silently.
    if (warn) warn.hidden = !(eap.checked && mirror.value.length > 0 && mirror.value.length < 8);
}

function initApPassword() {
    var mirror = Q("#ap-pass");
    var eap = Q("#eap");
    if (!mirror || !eap) return;

    mirror.addEventListener("input", syncApPassword);
    eap.addEventListener("change", syncApPassword);
    syncApPassword();
}


function loadSetting() {
    s_ajax({
        url: "config?cfg=1",
        m: "GET",
        success: function(data) {
            var j = JSON.parse(data);
            window.oridata = j;
            // Secrets are missing from an unauthenticated reply. Remember which,
            // so a later save cannot blank a stored value with an empty field.
            window.redacted = {};
            ["pass", "duckdnsToken"].forEach(function(name) {
                if (!(name in j)) window.redacted[name] = 1;
            });
            Object.keys(j).map(function(key) {
                var div = Q("input[name=" + key + "]");
                if (div) {
                    if (div.classList.contains("iptype")) {
                        div.value = formatIP(j[key]);
                    } else if (div.type == "checkbox") div.checked = (j[key] != 0);
                    else div.value = j[key];
                } else {
                    // wifi mode
                    div = Q("select[name=" + key + "]");
                    if (div) {
                        div.value = j[key];
                    }
                }
            });
            // system info
            var mac="";
            for(var i=0;i<j.mac.length;i++){
                mac += ((mac=="")?  "":":") + j.mac[i].toString(16);
            }
            Q("#mac-address").innerText=mac;
            Q("#flash-id").innerText = "<%= cfg_hex_prefix %>" + j.fid.toString(16);
            Q("#real-flash-size").innerText=j.frsize;
            Q("#specified-flash-size").innerText=j.fsize;
            Q("#fs-size").innerText=j.fs;
            Q("#fw-size").innerText = (j.fwsize == null) ? "--" : j.fwsize;
            Q("#app-slot").innerText = (j.appslot == null) ? "--" : j.appslot;
            Q("#app-free").innerText = (j.fwsize == null || j.appslot == null) ? "--" : (j.appslot - j.fwsize);
            Q("#ota-slot").innerText = (j.otaslot == null) ? "--" : j.otaslot;
            Q("#app-name").innerText = j.appname ? j.appname : "--";
            // Compile-time stamp, "<Mon dd yyyy> <hh:mm:ss>", so a running firmware
            // can be matched to the build it came from. Read only by design.
            Q("#build-time").innerText = j.date ? j.date : "--";
            // The AP box mirrors the login password, so refresh it once the
            // stored value has been written into the form.
            syncApPassword();
        },
        fail: function(d) {
            alert("<%= cfg_error_getting_data_colon %>" + d);
        }
    });
}

function hidesysinfo(){
    Q("#sysinfo").style.display = "none";
}
function showsysinfo(){
    Q("#sysinfo").style.display = "block";
}
function waitrestart() {
    Q("#waitprompt").style.display = "block";
    Q("#inputform").style.display = "none";
    setTimeout(function() {
        window.location.reload();
    }, 15000);
}

function save() {
    var ins = document.querySelectorAll("#sysconfig input");
    var json = {};
    var reboot = false;
    // A failed GET leaves oridata undefined; without this guard the comparison
    // below throws and the save is lost without a message.
    var ori = window.oridata || {};
    for (var i = 0; i < ins.length; i++) {
        var input = ins[i];
        if (input.type == "submit" || !input.name || input.name == "") continue;
        // The pressure switch posts on change and is not part of the config
        // payload; including it would look like a change and force a restart.
        if (input.hasAttribute("data-nosave")) continue;
        var val = (input.type == "checkbox") ? (input.checked ? 1 : 0) : input.value.trim();
        // Numeric settings are validated here and sent as real JSON numbers; a
        // comma stops the whole save instead of being dropped or truncated.
        if (val !== "" && input.classList.contains("num")) {
            var num = Num.parse(val);
            if (num === null) {
                Num.mark(input, true);
                alert((input.name || "<%= setup_value %>") + ": " + Num.message);
                return;
            }
            Num.mark(input, false);
            val = num;
        }
        // A secret the server withheld stays untouched unless the user actually
        // types a new one. Without this, saving from an unauthenticated view
        // would erase the stored password.
        if ((window.redacted || {})[input.name] && val === "") continue;
        json[input.name] = val;
        if (ori[input.name] != val && !input.classList.contains("nb")) reboot = true;
    }
    // A select whose stored value has no matching option reports an empty
    // string. Sending that would post an invalid wifiMode and make the
    // controller fall back to every default on the next boot, so keep the
    // stored number instead.
    var wifiSel = Q("select[name=wifi]");
    var disSel = Q("select[name=dis]");
    json["wifi"] = wifiSel.value !== "" ? wifiSel.value : (ori["wifi"] || 3);
    json["dis"] = disSel.value !== "" ? disSel.value : (ori["dis"] || 0);
    //console.log(JSON.stringify(json));
    setSaveNote("", true);
    var url = "config" + (reboot ? "" : "?nb");
    s_ajax({
        url: url,
        data: "data=" + encodeURIComponent(JSON.stringify(json)),
        m: "POST",
        success: function(data) {
            if (reboot) waitrestart();
            else setSaveNote("<%= config_saved %>", true);
        },
        fail: function(d) {
            setSaveNote("", false);
            alert("<%= cfg_error_saving_data_colon %>" + d);
        }
    });
}

function setPressureHardware(turnOn) {
    s_ajax({
        url: "psi",
        m: "GET",
        success: function(json) {
            var d = JSON.parse(json);
            if (turnOn && d.mode != 0) return;
            if (!turnOn && d.mode == 0) return;
            s_ajax({
                url: "psi",
                m: "POST",
                mime: "application/x-www-form-urlencoded",
                data: "data=" + encodeURIComponent(JSON.stringify({
                    mode: turnOn ? 1 : 0,
                    a: d.a,
                    b: d.b,
                    adc: d.adc,
                    gn: d.gn
                })),
                success: function() {},
                fail: function() {
                    alert(turnOn ? "<%= cfg_pressure_enable_error %>" : "<%= cfg_pressure_disable_error %>");
                }
            });
        }
    });
}

function load() {
    if (Q("#verinfo")) {
        Q("#verinfo").innerHTML = "v" + JSVERSION;
        getActiveNavItem();
    }
    loadSetting();
    Net.init();
    initApPassword();

    // Both Save buttons (top of the page and the bottom save bar) submit the
    // same form. The form itself has onsubmit="return false", so every submit
    // button needs the handler, not just #submitsave.
    var saveButtons = document.querySelectorAll("#sysconfig button[type=submit]");
    for (var si = 0; si < saveButtons.length; si++) {
        saveButtons[si].onclick = function(e) {
            e.preventDefault();
            save();
            return false;
        };
    }
    var pressureOff = Q("#pressure-nav-off");
    var pressureOn = Q("#pressure-nav-on");
    if (pressureOff && pressureOn) {
        var showPressure = pressureNavOn();
        pressureOff.checked = !showPressure;
        pressureOn.checked = showPressure;
        var savePressureNav = function () {
            setPressureNav(pressureOn.checked);
            setPressureHardware(pressureOn.checked);
        };
        pressureOff.onchange = savePressureNav;
        pressureOn.onchange = savePressureNav;
    }
}


function validIP(t) {
    var digits = t.split(".");
    var value = 0;
    if (digits.length != 4) return false;
    for (var i = 0; i < 4; i++) {
        var di = parseInt(digits[i]);
        value = (value << 8) + di;
        if (di > 255) {
            return false;
        }
    }
    return value;
}

var Net = {
    select: function(l) {
        document.getElementById('ssid').value = l.innerText || l.textContent;
        document.getElementById('nwpass').focus();
        return false;
    },
    init: function() {
        this.litem = Q(".nwlist");
        this.litem.parentNode.removeChild(this.litem);
        this.setupEvent();
        this.hide();
    },
    nwevent: function(data) {
        var me = this;
        //console.log("ws:" + data);
        if (typeof data["list"] != "undefined") {
            me.list(data.list);
        } else if (typeof data["ssid"] != "undefined") {
            if (data.ssid != "") {
                Q("#connnected-ssid").innerHTML = data.ssid;
            }
            if (typeof data["ip"] != "undefined")
                if (data.ip != "") {
                    Q("#sta-ip").innerHTML = data.ip;

                }
        }
    },
    rssi: function(x) {
        return (x > 0) ? "?" : Math.min(Math.max(2 * (x + 100), 0), 100);
    },
    list: function(nwlist) {
        var nws = Q("#networks");
        nws.innerHTML = "";
        for (var i = 0; i < nwlist.length; i++) {
            var nl = this.litem.cloneNode(true);
            nl.getElementsByTagName("a")[0].innerHTML = nwlist[i].ssid;
            var signal = nl.getElementsByTagName("span")[0];
            signal.innerHTML = "" + this.rssi(nwlist[i].rssi) + "%";
            if (nwlist[i].enc) signal.className = signal.className + " l";
            nws.appendChild(nl);
        }
    },
    setupEvent: function() {
        var b = this;

        BWF.init({
            handlers: {
                W: function(ev) {
                    b.nwevent(ev);
                }
            }
        });
    },
    scan: function() {
        var lists = Q("#networks");
        lists.innerHTML = "<%= cfg_scanning %>";

        s_ajax({
            m: "GET",
            url: "/wifiscan",
            success: function() {}
        });
        return false;
    },
    save: function() {
        var data = "nw=" + encodeURIComponent(Q("#ssid").value);
        if (Q("#nwpass").value != "") data = data + "&pass=" + encodeURIComponent(Q("#nwpass").value);
        var ip = validIP(Q("#staticip").value);
        var gw = validIP(Q("#gateway").value);
        var nm = validIP(Q("#netmask").value);
        var dns = validIP(Q("#dns").value);
        if (ip && gw && nm) {
            data = data + "&ip=" + Q("#staticip").value.trim() +
                "&gw=" + Q("#gateway").value.trim() +
                "&nm=" + Q("#netmask").value.trim() +
                "&dns=" + Q("#dns").value.trim();
        }
        s_ajax({
            m: "POST",
            url: "/wificon",
            data: data,
            success: function() {}
        });
        this.hide();
        return false;
    },
    show: function() {
        Q("#networkselection").style.display = "block";
    },
    hide: function() {
        Q("#networkselection").style.display = "none";
    }
};

function savewifi(){
    Net.save();
    div = Q("select[name=wifi]");
    if(div.value ==2){
        div.value = 3;
        if(typeof window.oridata != "undefined"){
            window.oridata.wifi=3;
        }
    }
}
function initAdvanced(){
    var inputs = document.querySelectorAll('#advanced input,select'), i;

    for (i = 0; i < inputs.length; ++i) {
        inputs[i].onchange = function(){
            window.ccModified[this.id] = normalizeNumberInput(this);
            checkModify();
        }
    } 

    Q("#warning").onchange=function(){
        checkModify();
    }
}

// Advanced settings are numbers in the dot convention. A comma is refused, not
// rewritten: silently turning "0,25" into 0.25 would hide a typo made on a
// localised keyboard, and turning it into 25 would be worse.
function normalizeNumberInput(field) {
    if (field.value === "") return "";
    var value = Num.parse(field.value);
    if (value === null) {
        Num.mark(field, true);
        setAdvNote("<%= cfg_adv_dot_hint %>", false);
        return String(field.value);
    }
    Num.mark(field, false);
    return value;
}


function checkModify(){
    var dirty=false;
    Object.keys(window.ccModified).forEach(key => {
        if(window.ccModified[key] != window.ccConstants[key])
            //console.log("modified:" + key +" value:" + window.ccModified[key]);
        dirty = true;
    });


    Q("#adv-update").disabled= ! Q("#warning").checked || !dirty;
}

function sameConst(a, b) {
    if (String(a) === String(b)) return true;
    var na = Number(a), nb = Number(b);
    if (!(na === na) || !(nb === nb)) return false;
    // Temperature differences are stored in 1/512 steps, so the echoed value is
    // the nearest of those steps rather than the exact decimal that was typed.
    // Compare in device steps: -0.05 and -0.05078125 are the same stored value,
    // while two different input steps stay different.
    return Math.round(na * 512) === Math.round(nb * 512);
}

function setAdvNote(text, ok) {
    var el = Q("#adv-result");
    if (!el) return;
    el.textContent = text;
    el.className = "adv-result " + (ok ? "is-ok" : "is-bad");
}

function cResponse(cc){
    if (window.advPending) {
        var pending = window.advPending;
        window.advPending = null;
        if (window.advTimer) { clearTimeout(window.advTimer); window.advTimer = null; }
        var failed = [];
        Object.keys(pending).forEach(function(key) {
            if (!sameConst(cc[key], pending[key])) failed.push(key);
        });
        setAdvNote(failed.length ? "<%= cfg_adv_failed_prefix %> " + failed.join(", ") + " <%= cfg_adv_not_stored %>" : "<%= config_saved %>", !failed.length);
    }
    // Keep the value the user typed when the device echoes the same number. The
    // device stores temperature differences in 1/512 steps, so echoing that back
    // would turn -0.05 into -0.051 for no reason.
    var typed = window.ccModified;
    window.ccModified={};
    window.ccConstants=cc;
    Q("#adv-update").disabled=true;
    Object.keys(cc).forEach(key => {
        var field = Q("#" + key);
        if (!field) return;
        if (typed[key] !== undefined && sameConst(cc[key], typed[key])) return;
        field.value = cc[key];
    });
}
var testConfig={"tempFormat":"C","tempSetMin": 1.0,"tempSetMax": 30.0,"pidMax": 10.000,"Kp": 5.000,"Ki": 0.250,"Kd":-1.500,"iMaxErr": 0.500,"idleRangeH":1,"idleRangeL":-1,"heatTargetH": 0.299,"heatTargetL":-0.199,"coolTargetH": 0.199,"coolTargetL":-0.299,"maxHeatTimeForEst":600,"maxCoolTimeForEst":1200,"minCoolTime":180,"minCoolIdleTime":300,"minHeatTime":180,"maxHeatTime":0,"minHeatIdleTime":300,"deadTime":600,"staleSensorSec":20,"oneWireRetryCount":2,"fridgeFastFilt":1,"fridgeSlowFilt":4,"fridgeSlopeFilt":3,"beerFastFilt":3,"beerSlowFilt":4,"beerSlopeFilt":4,"lah":0,"hs":0};

function showAdvanced(){
    Q("#advanced").style.display = "block";
    if(typeof BWF.handlers['C'] == "undefined"){
        BWF.on('C',cResponse);
        initAdvanced();
    }
    window.ccModified={};
    Q("#adv-update").disabled=true;
    //Test code
    //BWF.handlers.C(testConfig);
    BWF.send("c");
}

function hideAdvanced(){
    Q("#advanced").style.display = "none";
}


function setAdvancedOptions(){
    var cmd={};
    Object.keys(window.ccModified).forEach(key => {
        if(window.ccModified[key] != window.ccConstants[key])
            cmd[key] = window.ccModified[key];
    });
    if (!Object.keys(cmd).length) return;
    for (var key in cmd) {
        // The value may still be the raw text of a rejected field, so validate
        // again here rather than trusting Number(), which accepts "0x10".
        var num = Num.parse(cmd[key]);
        if (num === null) { setAdvNote("<%= cfg_adv_dot_prefix %> " + key + " <%= cfg_adv_not_number %>", false); return; }
        cmd[key] = num;
    }
    if (typeof BWF == "undefined" || BWF.status() != 0) { setAdvNote("<%= cfg_adv_not_connected %>", false); return; }
    window.advPending = cmd;
    if (window.advTimer) clearTimeout(window.advTimer);
    window.advTimer = setTimeout(function() {
        if (!window.advPending) return;
        window.advPending = null;
        setAdvNote("<%= cfg_adv_no_answer %>", false);
    }, 8000);
    BWF.send("j" + JSON.stringify(cmd));
}