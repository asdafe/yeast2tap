var ErrMsg={
    2: "<%= setup_err_out_of_memory %>",
	3: "<%= setup_err_invalid_spec %>",
	4: "<%= setup_err_invalid_chamber %>",
	5: "<%= setup_err_invalid_beer %>",
	6: "<%= setup_err_invalid_function %>",
	7: "<%= setup_err_invalid_owner %>",
	8: "<%= setup_err_cannot_assign %>",
	9: "<%= setup_err_onewire_pin %>"
};
var BackupFile = "/device.cfg";
var Func_ChamberHumSensor=8;
var Func_RoomHumSensor=18;
var HW_PIN=1;
var HW_1W_SENSOR=2;
var HW_1W_2413=3;
var HW_EXT_SENSOR=5;
var HW_ENV_SENSOR= 6;
var HW_BME280=7;
var HW_BTHOME=8;
var HW_BTHOME_THERMOMETER=9;
var HW_RAPT=10;

var devices = {
    pinlabel:function(pin){
        var c = {
            0: "D3",
            1: "D10",
            2: "D4",
            3: "D9",
            4: "D2",
            5: "D1",
            12: "D6",
            13: "D7",
            14: "D5",
            15: "D8",
            16: "D0",
            17: "A0"
        };
        if (pin < 0) return "<%= setup_na %>";
        if (window.board == "f")  return "<%= setup_gpio %> " + pin;
        if (window.board == "e") return c[pin];
        return "<%= setup_unknown %>";
    },
    pinFuncChange:function(g){
        if(g.querySelector("select.device-function").value ==Func_ChamberHumSensor || g.querySelector("select.device-function").value == Func_RoomHumSensor){
            g.querySelectorAll(".device-humidity-sensor-container").forEach(function(div){div.style.display="";});
            g.querySelectorAll(".device-pintype-container").forEach(function(div){div.style.display="none";});
        }else{
            g.querySelectorAll(".device-humidity-sensor-container").forEach(function(div){div.style.display="none";});

            g.querySelectorAll(".device-pintype-container").forEach(function(div){div.style.display="";});
        }
    },
    add: function(a, f) {
        var g;
        if (f.h == HW_1W_SENSOR) { // sensor
            g = window.sensorContainer.cloneNode(true);
            g.querySelector("span.device-address").innerHTML = f.a;
            g.querySelector("span.device-value").innerHTML = (typeof f.v === "undefined") ? "-" : f.v
            g.querySelector("input.device-calibration").value = f.j;
        } else if (f.h == HW_EXT_SENSOR) { // external sensor
            g = window.extsensorContainer.cloneNode(true);
            g.querySelector("span.device-value").innerHTML = (typeof f.v === "undefined") ? "-" : f.v;
            g.querySelector("input.device-calibration").value = f.j;
        } else if (f.h == HW_ENV_SENSOR) { // temp sensor of humidity sensor/DHT1x/DHT2x series
            g = window.dhtsensorContainer.cloneNode(true);
            g.querySelector("span.device-value").innerHTML = (typeof f.v === "undefined") ? "-" : f.v;
            g.querySelector("input.device-calibration").value = f.j;
            if(f.p){ // 0 is chamber
                g.querySelector(".chamber-sensor").style.display="none";
            }else{
                g.querySelector(".room-sensor").style.display="none";
            }
        } else if (f.h ==HW_1W_2413) { // onewire switch/2413
            g = window.owContainer.cloneNode(true);
            g.querySelector("span.device-address").innerHTML = f.a;
            g.querySelector("span.device-channel").innerHTML = f.n;
            g.querySelector("select.device-pintype").value = f.x;
            g.querySelector("span.device-value").innerHTML = (typeof f.v === "undefined") ? "-" : ((f.v) ? "<%= setup_active %>" : "<%= setup_inactive %>")

        } else if (f.h == HW_BME280) { // BME280
            g = window.bme280Container.cloneNode(true);
            g.querySelector("span.device-address").innerHTML = "<%= setup_hex_prefix %>" + parseInt(f.p).toString(16);
        } else {
            // pin devices
            g = window.pinContainer.cloneNode(true);
            if(f.f ==Func_ChamberHumSensor || f.f == Func_RoomHumSensor){ // humidity sensor
                g.querySelector("select.device-humidity-sensor").value = f.s;
                g.querySelector("span.device-value").innerHTML = (typeof f.v === "undefined") ? "-" : (f.v + "%");
                g.querySelector("input.device-calibration").value = f.j; 
            }else {

                g.querySelector("select.device-pintype").value = f.x;
                g.querySelector("span.device-value").innerHTML = (typeof f.v === "undefined") ? "-" : ((f.v) ? "<%= setup_active %>" : "<%= setup_inactive %>")
            }
        }
        g.querySelector("select.slot-select").value = f.i;
        if(f.h != HW_BME280 && f.h != HW_ENV_SENSOR) g.querySelector("span.device-pin").innerHTML = this.pinlabel(f.p);
        g.querySelector("select.device-function").value = f.f;
        g.querySelector("select.device-function").onchange=function(){
          devices.pinFuncChange(g);  
        };
        if(f.h ==HW_PIN ) devices.pinFuncChange(g); // pin
        g.querySelector("div.device-title").innerHTML = "<%= gravity_device %> " + a;
        g.querySelector("button").onclick = function() {
            device_apply(a)
        };
        g.hardwaretype = f.h;
        g.pinnumber = f.p;
        if (f.i < 0 || parseInt(f.f, 10) < 0) g.classList.add("device-idle");
        else g.classList.add("device-live");
        var b = (f.i < 0) ? "detected-list" : "installed-list";
        var e = document.getElementById(b);
        e.appendChild(g);
        e.appendChild(document.createElement("br"));
        g._spec = f;
        if (isSuppressedDevice(f)) g.classList.add("device-suppressed");
        dressSetupCard(g, f);
        updateSetupCounts();
        refreshAllPinNotes();
    }
};
var GPINS = [0,1,2,3,4,5,12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33,34,35,36,39];
// Scale defaults as the firmware expects them: 25/26 and 27/33 are free because
// the rotary encoder moved to 13/14/18.
var SCALE_PIN_DEFAULT = {25:"<%= setup_scale_1_dout %>",26:"<%= setup_scale_1_sck %>",27:"<%= setup_scale_2_dout %>",33:"<%= setup_scale_2_sck %>"};
// Pins the default ESP32 build gives to the rotary encoder.
var ENCODER_PINS = {13:true, 14:true, 18:true};
function isSuppressedDevice(f) {
    var idle = (f.i < 0 || parseInt(f.f, 10) < 0);
    if (f.userAdded) return false;
    if (f.h == HW_PIN && idle) return true;
    if (f.h == HW_EXT_SENSOR && idle) return true;
    return false;
}
function needsPin(f) { return !!(f.userAdded && f.h == HW_PIN); }
function pinStaticInfo(n) {
    if (n === 0 || n === 2 || n === 5 || n === 12 || n === 15) return {tag:"<%= setup_tag_boot %>", msg:"<%= setup_gpio %> " + n + "<%= setup_pin_boot_msg %>"};
    if (n === 1 || n === 3) return {tag:"<%= setup_tag_serial %>", msg:"<%= setup_gpio %> " + n + "<%= setup_pin_serial_msg %>"};
    if (n === 34 || n === 35 || n === 36 || n === 39) return {tag:"<%= setup_tag_input_only %>", msg:"<%= setup_gpio %> " + n + "<%= setup_pin_input_msg %>"};
    if (n === 23) return {tag:"<%= setup_tag_onewire %>", msg:"<%= setup_gpio %> 23<%= setup_pin_onewire_msg %>"};
    if (n === 21 || n === 22) return {tag:"<%= setup_tag_i2c %>", msg:"<%= setup_gpio %> " + n + "<%= setup_pin_i2c_msg %>"};
    if (ENCODER_PINS[n]) return {tag:"<%= setup_tag_encoder %>", msg:"<%= setup_gpio %> " + n + "<%= setup_pin_encoder_msg %>"};
    if (SCALE_PIN_DEFAULT[n]) return {tag:SCALE_PIN_DEFAULT[n] + " <%= setup_default %>", msg:"<%= setup_gpio %> " + n + "<%= setup_pin_default_1 %>" + SCALE_PIN_DEFAULT[n] + "<%= setup_pin_default_2 %>"};
    return null;
}
function pinUseMap() {
    var map = {};
    function add(pin, name) {
        if (pin === undefined || pin === null || pin < 0 || isNaN(pin) || !name) return;
        if (!map[pin]) map[pin] = [];
        if (map[pin].indexOf(name) < 0) map[pin].push(name);
    }
    var cards = document.querySelectorAll("#device-list div.device-container");
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.classList.contains("device-suppressed")) continue;
        var pin = card._spec ? card._spec.p : card.pinnumber;
        var choice = card.querySelector("select.device-pin-choice");
        if (choice && choice.value !== "") pin = parseInt(choice.value, 10);
        var title = card.querySelector(".device-title");
        add(pin, title ? title.textContent : ("Device " + (i + 1)));
    }
    var scales = document.querySelectorAll(".scale-device-row");
    for (var s = 0; s < scales.length; s++) {
        var id = parseInt(scales[s].dataset.scaleId, 10);
        var sels = [scales[s].querySelector(".scale-dout"), scales[s].querySelector(".scale-clock")];
        for (var k = 0; k < sels.length; k++) {
            if (!sels[k]) continue;
            add(parseInt(sels[k].value, 10), "<%= setup_scale %> " + (id + 1));
        }
    }
    return map;
}
function otherUsers(map, pin, selfName) {
    var names = map[pin] || [];
    var out = [];
    for (var i = 0; i < names.length; i++) if (names[i] !== selfName) out.push(names[i]);
    return out;
}
function showPinWarning(card, pin, used) {
    var warn = card.querySelector(".pin-warn");
    if (!warn) return;
    if (isNaN(pin) || pin < 0) { warn.hidden = true; return; }
    var selfName = card.querySelector(".device-title") ? card.querySelector(".device-title").textContent : "";
    var info = pinStaticInfo(pin);
    var others = otherUsers(used, pin, selfName);
    var text = "";
    if (others.length) text = "<%= setup_gpio %> " + pin + "<%= setup_is_in_use_by %>" + others.join(", ") + ".";
    if (info) text = text ? (text + " " + info.msg) : info.msg;
    warn.hidden = !text;
    var msg = warn.querySelector("span");
    if (msg) msg.textContent = text;
}
function refreshAllPinNotes() {
    var used = pinUseMap();
    var selects = document.querySelectorAll("select.device-pin-choice, select.scale-dout, select.scale-clock");
    for (var i = 0; i < selects.length; i++) {
        var sel = selects[i];
        var keep = sel.value;
        var options = sel.querySelectorAll("option");
        for (var o = 0; o < options.length; o++) {
            var opt = options[o];
            if (opt.disabled) continue;
            var pin = parseInt(opt.value, 10);
            if (isNaN(pin) || pin < 0) continue;
            var note = "";
            var ownerCard = sel.closest ? (sel.closest(".device-container") || sel.closest(".scale-device-row")) : null;
            var selfName = "";
            if (ownerCard && ownerCard.classList.contains("scale-device-row")) selfName = "<%= setup_scale %> " + (parseInt(ownerCard.dataset.scaleId, 10) + 1);
            else if (ownerCard) {
                var title = ownerCard.querySelector(".device-title");
                selfName = title ? title.textContent : "";
            }
            var others = otherUsers(used, pin, selfName);
            if (others.length) note = "<%= setup_in_use_by %>" + others.join(", ");
            else if (pinStaticInfo(pin)) note = pinStaticInfo(pin).tag;
            var base = "<%= setup_gpio %> " + pin;
            if (opt.disabled && opt.textContent.indexOf("input only") >= 0) base += "<%= setup_input_only_suffix %>";
            opt.textContent = note ? (base + " — " + note) : base;
        }
        if (keep !== "") sel.value = keep;
        var card = sel.closest ? sel.closest(".device-container") : null;
        if (card) showPinWarning(card, parseInt(sel.value, 10), used);
    }
}
function freshState(card) {
    var fn = card.querySelector("select.device-function");
    var slot = card.querySelector("select.slot-select");
    var pin = card.querySelector("select.device-pin-choice");
    var fnVal = fn ? parseInt(fn.value, 10) : NaN;
    var slotVal = slot ? parseInt(slot.value, 10) : NaN;
    var needsFn = !fn || isNaN(fnVal) || fnVal === 0;
    var needsSlot = !slot || isNaN(slotVal) || slotVal < 0;
    var needsPinSel = pin && (pin.value === "" || parseInt(pin.value, 10) < 0);
    return (needsFn || needsSlot || needsPinSel) ? "setup" : "ready";
}
function updateFreshState(card) {
    if (!card || !card.classList.contains("device-fresh")) return;
    var pill = card.querySelector(".st-fresh");
    var btn = card.querySelector("button.dev-apply");
    var state = freshState(card);
    if (pill) {
        pill.textContent = state === "ready" ? "<%= setup_ready_to_apply %>" : "<%= setup_needs_setup %>";
        pill.classList.toggle("ready", state === "ready");
    }
    if (btn) btn.disabled = state !== "ready";
}
function markDeviceLive(card) {
    card.classList.remove("device-fresh", "device-idle");
    card.classList.add("device-live");
    var pill = card.querySelector(".st-fresh");
    if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
    if (!card.querySelector(".st-live")) {
        var live = document.createElement("span");
        live.className = "st live st-live";
        live.innerHTML = "<i></i><%= setup_live %>";
        var btn = card.querySelector("button.dev-apply");
        if (btn && btn.parentNode) btn.parentNode.insertBefore(live, btn);
    }
    var x = card.querySelector(".dev-remove");
    if (x && x.parentNode) x.parentNode.removeChild(x);
    var apply = card.querySelector("button.dev-apply");
    if (apply) apply.disabled = false;
}
function updateSetupCounts() {
    var live = document.querySelectorAll("#device-list .device-live:not(.device-suppressed)").length;
    var fresh = document.querySelectorAll("#device-list .device-fresh:not(.device-suppressed)").length;
    var inst = document.getElementById("cnt-inst");
    var neu = document.getElementById("cnt-new");
    var sub = document.getElementById("setup-sub");
    if (inst) inst.textContent = String(live);
    if (neu) { neu.hidden = fresh === 0; neu.textContent = fresh + " new"; }
    if (sub) sub.textContent = live + " installed" + (fresh ? " · " + fresh + " new" : "");
}
function onSetupChange(ev) {
    var t = ev.target;
    var card = t.closest ? t.closest(".device-container") : null;
    if (!card) return;
    if (t.classList && t.classList.contains("device-pin-choice")) {
        var pin = t.value === "" ? -1 : parseInt(t.value, 10);
        if (card._spec) card._spec.p = pin;
        card.pinnumber = pin;
        var label = card.querySelector("span.device-pin");
        if (label) label.textContent = devices.pinlabel(pin);
        setGpioChip(card, pin);
    }
    if (t.classList && t.classList.contains("device-function")) devices.pinFuncChange(card);
    updateFreshState(card);
    refreshAllPinNotes();
}
function reindexApplyButtons() {
    var cards = document.querySelectorAll("#device-list div.device-container");
    for (var i = 0; i < cards.length; i++) {
        (function(index, card) {
            var btn = card.querySelector("button.dev-apply");
            if (btn) btn.onclick = function() { device_apply(index); };
        })(i, cards[i]);
    }
}
function iconNameFor(f) {
    if (f.userHum || f.f == Func_ChamberHumSensor || f.f == Func_RoomHumSensor) return "droplet";
    if (f.h == HW_1W_SENSOR || f.h == HW_ENV_SENSOR) return "thermometer";
    if (f.h == HW_EXT_SENSOR || f.h == HW_BME280) return "radio";
    if (f.h == HW_PIN || f.h == HW_1W_2413) return "plug";
    return "cpu";
}
function fieldBox(g, selector) {
    var node = g.querySelector(selector);
    if (!node) return null;
    var box = node;
    while (box && box !== g && !(box.classList && box.classList.contains("device-setting-container"))) box = box.parentNode;
    return (box && box !== g) ? box : null;
}
function dressSetupCard(g, f) {
    if (g.getAttribute("data-dressed") === "1") return;
    g.setAttribute("data-dressed", "1");
    var btn = g.querySelector("button");
    if (btn) btn.classList.add("dev-apply", "btn", "setup-primary", "sm");
    var title = g.querySelector(".device-title");
    var typeNode = g.querySelector(".device-type");
    var value = g.querySelector(".device-value");
    var head = document.createElement("header");
    head.className = "dev-head";
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.innerHTML = '<svg class="ic"><use href="#i-' + iconNameFor(f) + '"/></svg>';
    var ttl = document.createElement("div");
    ttl.className = "ttl";
    if (title) ttl.appendChild(title);
    var sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = typeNode ? typeNode.textContent.replace(/^\s+|\s+$/g, "") : "";
    ttl.appendChild(sub);
    head.appendChild(badge);
    head.appendChild(ttl);
    var fresh = g.classList.contains("device-idle") && !g.classList.contains("device-suppressed");
    if (fresh) {
        g.classList.add("device-fresh");
        var pill = document.createElement("span");
        pill.className = "st new st-fresh";
        pill.textContent = "<%= setup_needs_setup %>";
        head.appendChild(pill);
    } else if (g.classList.contains("device-live")) {
        var live = document.createElement("span");
        live.className = "st live st-live";
        live.innerHTML = "<i></i><%= setup_live %>";
        head.appendChild(live);
    }
    if (btn) head.appendChild(btn);
    if (f.userAdded) {
        var x = document.createElement("button");
        x.type = "button";
        x.className = "ib dev-remove";
        x.setAttribute("aria-label", "<%= setup_remove %>");
        x.innerHTML = '<svg class="ic"><use href="#i-x"/></svg>';
        x.onclick = function() {
            var ix = available_list.indexOf(f);
            if (ix >= 0) available_list.splice(ix, 1);
            var br = g.nextSibling;
            if (br && br.tagName === "BR") br.parentNode.removeChild(br);
            if (g.parentNode) g.parentNode.removeChild(g);
            reindexApplyButtons();
            updateSetupCounts();
            refreshAllPinNotes();
        };
        head.appendChild(x);
    }
    var body = document.createElement("div");
    body.className = "dev-row";
    var val = document.createElement("div");
    val.className = "val";
    val.innerHTML = '<span class="k"><%= setup_value %></span>';
    if (value) {
        value.classList.add("v");
        if (f.h == HW_PIN || f.h == HW_1W_2413) value.classList.add(value.textContent === "active" ? "is-on" : "is-off");
        val.appendChild(value);
    }
    var fields = document.createElement("div");
    fields.className = "fields";
    var fnBox = fieldBox(g, "select.device-function");
    var slotBox = fieldBox(g, "select.slot-select");
    var calBox = fieldBox(g, "input.device-calibration");
    var pinType = fieldBox(g, "select.device-pintype");
    var humType = fieldBox(g, "select.device-humidity-sensor");
    if (fnBox) { fnBox.classList.add("w2"); fields.appendChild(fnBox); }
    if (slotBox) fields.appendChild(slotBox);
    if (needsPin(f)) {
        var pinField = document.createElement("div");
        pinField.className = "device-setting-container";
        pinField.innerHTML = '<span class="setting-name"><%= setup_controller_pin %></span>';
        var sel = document.createElement("select");
        sel.className = "setting-value device-pin-choice";
        var blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "<%= setup_select_gpio %>";
        sel.appendChild(blank);
        for (var pi = 0; pi < GPINS.length; pi++) {
            var opt = document.createElement("option");
            opt.value = String(GPINS[pi]);
            opt.textContent = "<%= setup_gpio %> " + GPINS[pi];
            sel.appendChild(opt);
        }
        pinField.appendChild(sel);
        fields.appendChild(pinField);
    }
    if (humType) fields.appendChild(humType);
    if (calBox && calBox !== humType) fields.appendChild(calBox);
    if (pinType && pinType !== humType) fields.appendChild(pinType);
    body.appendChild(val);
    body.appendChild(fields);
    var meta = document.createElement("div");
    meta.className = "meta";
    function chip(label, code) {
        if (!code) return;
        var s = document.createElement("span");
        s.className = "chip";
        s.appendChild(document.createTextNode(label + " "));
        var c = document.createElement("code");
        c.textContent = code;
        s.appendChild(c);
        meta.appendChild(s);
    }
    if (typeNodeText(typeNode)) chip("<%= setup_type %>", typeNodeText(typeNode));
    if (typeof f.p === "number" && f.p >= 0 && !needsPin(f)) chip("<%= setup_gpio %>", String(f.p));
    var addr = g.querySelector(".device-address");
    if (addr && addr.textContent) chip("<%= setup_address %>", addr.textContent);
    var warn = document.createElement("div");
    warn.className = "warn pin-warn";
    warn.hidden = true;
    warn.innerHTML = '<svg class="ic"><use href="#i-triangle-alert"/></svg><span></span>';
    var table = g.querySelector("table");
    if (table) table.style.display = "none";
    g.insertBefore(head, g.firstChild);
    g.appendChild(body);
    g.appendChild(meta);
    g.appendChild(warn);
    updateFreshState(g);
}
function setGpioChip(card, pin) {
    var meta = card.querySelector(".meta");
    if (!meta) return;
    var chip = meta.querySelector(".chip-gpio");
    if (isNaN(pin) || pin < 0) {
        if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
        return;
    }
    if (!chip) {
        chip = document.createElement("span");
        chip.className = "chip chip-gpio";
        meta.appendChild(chip);
    }
    chip.textContent = "";
    chip.appendChild(document.createTextNode("<%= setup_gpio %> "));
    var code = document.createElement("code");
    code.textContent = String(pin);
    chip.appendChild(code);
}
function typeNodeText(node) {
    return node ? node.textContent.replace(/^\s+|\s+$/g, "") : "";
}
function addUserDevice(kind) {
    var stub;
    if (kind === "hum") stub = {h:HW_PIN, p:-1, i:-1, f:Func_ChamberHumSensor, c:1, b:0, s:11, j:0, x:0, userAdded:true, userHum:true};
    else if (kind === "ext") stub = {h:HW_EXT_SENSOR, p:-1, i:-1, f:0, c:1, b:0, j:0, userAdded:true};
    else stub = {h:HW_PIN, p:-1, i:-1, f:0, c:1, b:0, x:0, userAdded:true};
    available_list.push(stub);
    var idx = installed_list.length + available_list.length - 1;
    devices.add(idx, stub);
    var cards = document.querySelectorAll("#device-list div.device-container");
    var last = cards[cards.length - 1];
    if (last && last.scrollIntoView) last.scrollIntoView({block:"nearest"});
}

var installed_list = [];
var available_list = [];

function cmdfrom(b) {
    var a;
    if (b < installed_list.length) {
        a = installed_list[b]
    } else {
        a = available_list[b - installed_list.length]
    }
    var div = document.querySelectorAll("div.device-container")[b];
    var c = {};
    c.i = parseInt(div.querySelector("select.slot-select").value);
    c.c = 1;
    c.f = parseInt(div.querySelector("select.device-function").value);
    if (c.f >= 9 && c.f <= 15) {
        c.b = 1
    } else {
        c.b = 0
    }
    c.h = a.h;
    c.p = a.p;
    if (c.h == HW_1W_SENSOR) { // onewire temp sensor
        c.a = a.a
    } else if (c.h == HW_1W_2413) { //  onewire 2413
        c.a = a.a;
        c.n = a.n;
        c.x = parseInt(div.querySelector("select.device-pintype").value);
    } else if (c.h == HW_PIN) { // hardware pin
        if( c.f == Func_ChamberHumSensor || c.f == Func_RoomHumSensor) c.s = parseInt(div.querySelector("select.device-humidity-sensor").value);
        else c.x = parseInt(div.querySelector("select.device-pintype").value);
    }
    if(c.h == HW_1W_SENSOR || c.h == HW_EXT_SENSOR ||  c.h == HW_ENV_SENSOR || c.f ==Func_ChamberHumSensor || c.f ==Func_RoomHumSensor){ // onewire temp &  external sensor
        var calEl = div.querySelector("input.device-calibration");
        var calVal = Num.parse(calEl.value);
        if(calVal === null){
            if(String(calEl.value).trim() !== "") { Num.mark(calEl, true); return null; }
            calVal = 0;
        }
        c.j = calVal;
    }
    return c
}

function device_apply(a) {
    var b = cmdfrom(a);
    if (b === null) {
        // A rejected calibration value was already marked; nothing is sent.
        alert("<%= setup_fix_value %>");
        return;
    }
    blockscreen("<%= script_setup_updating %>");
    var c = "U" + JSON.stringify(b);
    console.log(c);
    var tout = setTimeout(function() {
        alert("<%= setup_update_timeout %>")
        unblockscreen();
    }, 5000);

    BWF.on("U", function(d) {
        if (tout) clearTimeout(tout);
        unblockscreen();
        var cards = document.querySelectorAll("div.device-container");
        if (cards[a]) markDeviceLive(cards[a]);
        updateSetupCounts();
    });
    BWF.on("D", function(d) {
        if (tout) clearTimeout(tout);
        unblockscreen();
        if(typeof d["logID"] != "undefined"){
            var msg = ErrMsg[d.logID];
            if(typeof d["V"] == "array"){
                d.V.forEach(function(value,index){
                    msg = msg + "," + value;
                    re = new RegExp("%" +index,"g");
                    msg = msg.replace(re, value);
                });
                alert(msg);
            }
        }else alert("<%= setup_unknown_error %>");
    });

    BWF.send(c)
}

function deviceBackupList() {
    var c = [];
    for (var a = 0; a < installed_list.length; a++) {
        var f = installed_list[a];
        var e = {
            i: f.i,
            c: f.c,
            b: f.b,
            f: f.f,
            h: f.h,
            p: f.p
        };
        // Mirror DeviceManager::printDevice: save exactly the attributes the
        // firmware reports for this hardware, so a restore onto a fresh device
        // reproduces it instead of inheriting an empty slot.
        var hw = f.h;
        var onewire = (hw == HW_1W_SENSOR || hw == HW_1W_2413);
        var ble = (hw == HW_BTHOME_HUMIDITY || hw == HW_BTHOME_THERMOMETER || hw == HW_RAPT);
        if (onewire || ble) e.a = f.a;
        if (hw == HW_1W_2413) e.n = f.n;
        if (hw == HW_PIN || hw == HW_1W_2413) e.x = f.x;
        if (hw == HW_BTHOME_HUMIDITY || hw == HW_BTHOME_THERMOMETER
            || f.f == Func_ChamberHumSensor || f.f == Func_RoomHumSensor) e.s = f.s;
        if (hw == HW_1W_SENSOR || hw == HW_EXT_SENSOR || hw == HW_ENV_SENSOR
            || hw == HW_BTHOME_HUMIDITY || hw == HW_BTHOME_THERMOMETER || hw == HW_RAPT
            || f.f == Func_ChamberHumSensor || f.f == Func_RoomHumSensor) e.j = f.j;
        if (f.d !== undefined) e.d = f.d;
        c.push(e)
    }
    return c;
}

function scaleBackupFromStatus(status) {
    if (!status || !status.scales) return null;
    var scales = [];
    for (var i = 0; i < status.scales.length; i++) {
        var s = status.scales[i];
        scales.push({
            id: s.id,
            configured: !!s.configured,
            name: s.name || "",
            kegName: s.kegName || "",
            doutPin: s.doutPin,
            clockPin: s.clockPin,
            calibrated: !!s.calibrated,
            zeroOffset: s.zeroOffset || 0,
            calibrationFactor: s.calibrationFactor || 0,
            emptyKegGrams: s.emptyKegGrams || 0,
            capacityMl: s.capacityMl || 19000,
            beerDensityKgPerL: s.beerDensityKgPerL || 1.010,
            calibrationLimitCounts: s.calibrationLimitCounts || 1000
        });
    }
    return {
        action: "settings",
        use: !!status.use,
        retentionDays: status.retentionDays,
        eventThresholdGrams: status.eventThresholdGrams,
        maxPourMl: status.maxPourMl,
        dailyMinute: status.dailyMinute,
        scales: scales
    };
}

function backup() {
    s_ajax({
        url: "/scale",
        m: "GET",
        success: function(data) {
            var scale = null;
            try { scale = scaleBackupFromStatus(JSON.parse(data)); } catch (e) { scale = null; }
            finishBackup(scale);
        },
        fail: function() { finishBackup(null); }
    });
}

function finishBackup(scale) {
    var devices = deviceBackupList();
    if (devices.length == 0 && !scale) {
        alert("<%= script_setup_no_installed_devices %>");
        return;
    }
    download(new Blob([JSON.stringify({ devices: devices, scale: scale })], { type: "text/json;" }), "device.json");
}

// The controller answers an EEPROM init with an "A" status message.
function eraseDone() {
    alert("<%= setup_erase_done %>");
}

function erase() {
    if (!confirm("<%= setup_erase_confirm %>\n\n<%= setup_erase_erased %>\n<%= setup_erase_kept %>\n\n<%= setup_erase_final %>")) return;
    BWF.send("E");
}

function restoreScale(scale, done) {
    s_ajax({
        url: "/scale",
        m: "POST",
        data: "data=" + encodeURIComponent(JSON.stringify(scale)),
        success: function() { if (done) done(); },
        fail: function(error) {
            alert("<%= setup_restore_scale_failed %>" + error + (window.__ajaxErrorBody ? " - " + window.__ajaxErrorBody : ""));
            if (done) done();
        }
    });
}

function restoreJson(b){
    if (!b || !b.length) { unblockscreen(); return; }
    blockscreen("<%= script_setup_restoring %>");
    var a = 0, timer = null, awaiting = false;
    function advance() {
        if (!awaiting) return;      // a late reply for an entry already skipped
        awaiting = false;
        if (timer) { clearTimeout(timer); timer = null; }
        if (++a >= b.length) {
            BWF.on("U", undefined);
            unblockscreen();
            return
        }
        send();
    }
    function send() {
        // The controller answers every device it accepts; a malformed entry is
        // dropped without a reply, so advance on a timer as a safety net.
        awaiting = true;
        timer = setTimeout(advance, 5000);
        BWF.send("U" + JSON.stringify(b[a]))
    }
    BWF.on("U", advance);
    send()
}

function restore() {
    Q("#dlg_restore").style.display = "block";
    Q("#dlg_restore .cancel").onclick=function(){
        Q("#dlg_restore").style.display = "none";
        return false;
    };

    Q('#restore-file').onchange = function(evt) {
        //Retrieve the first (and only!) File from the FileList object
        var f = evt.target.files[0];
        if (f) {
            var r = new FileReader();
            r.onload = function(e) {
                try{
                  var json=JSON.parse(e.target.result);
                  Q("#dlg_restore").style.display = "none";
                  if (Array.isArray(json)) {
                      restoreJson(json);
                  } else {
                      var devices = json.devices || [];
                      var afterScale = function() {
                          if (devices.length) restoreJson(devices);
                      };
                      // A non-object scale block would clear the "use" flag,
                      // because that is the only field the firmware has no
                      // fallback for. Only restore a real object.
                      if (json.scale && typeof json.scale === "object") restoreScale(json.scale, afterScale);
                      else afterScale();
                  }
                }catch(e){
                    alert("<%= setup_invalid_format %>");
                }
            };
            r.readAsText(f);
        }    
    };


}
/*
function restore() {
    blockscreen("<%= script_setup_restoring %>");
    BWF.load(BackupFile, function(c) {
        var b = JSON.parse(c);
        var a = 0;
        BWF.on("U", function(d) {
            if (++a >= b.length) {
                BWF.on("U", null);
                unblockscreen();
                return
            }
            BWF.send("U" + JSON.stringify(b[a]))
        });
        BWF.send("U" + JSON.stringify(b[a]))
    }, function(a) {
        alert("<%= script_setup_error_load %>" + a);
        unblockscreen()
    })
}
*/
function list() {
    blockscreen("<%= script_setup_retrieving %>");
    installed_list = [];
    available_list = [];
    document.getElementById("detected-list").innerHTML = "";
    document.getElementById("installed-list").innerHTML = "";
    BWF.send("d{r:1}");
    BWF.send("h{u:-1,v:1}")
}

function erase() {
    if (confirm("<%= setup_erase_confirm %>\n\n<%= setup_erase_erased %>\n<%= setup_erase_kept %>\n\n<%= setup_erase_final %>")) BWF.send("E");
}

function listGot() {
    document.getElementById("detected-list").innerHTML = "";
    document.getElementById("installed-list").innerHTML = "";
    var a = 0;
    for (var b = 0; b < installed_list.length; b++) {
        devices.add(a++, installed_list[b])
    }
    for (var b = 0; b < available_list.length; b++) {
        devices.add(a++, available_list[b])
    }
    updateSetupCounts();
    refreshAllPinNotes();
    unblockscreen()
}

function fillScalePins(select, selected, clockPin) {
    // Matches the firmware list: flash, serial, boot pins, missing module pins,
    // OneWire, I2C, and 13/14/18 (rotary encoder in the ESP32 build).
    var blocked = {
        0: true, 1: true, 2: true, 3: true, 5: true,
        6: true, 7: true, 8: true, 9: true, 10: true, 11: true,
        12: true, 15: true,
        20: true, 21: true, 22: true, 23: true, 24: true,
        28: true, 29: true, 30: true, 31: true,
        37: true, 38: true
    };
    for (var encoderPin in ENCODER_PINS) blocked[encoderPin] = true;
    var inputOnly = { 34: true, 35: true, 36: true, 39: true };
    select.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = -1;
    empty.textContent = "<%= setup_select_gpio %>";
    select.appendChild(empty);
    for (var pin = 0; pin <= 39; pin++) {
        var option = document.createElement("option");
        option.value = pin;
        option.textContent = "<%= setup_gpio %> " + pin + (inputOnly[pin] && !clockPin ? "<%= setup_input_only_suffix %>" : "");
        option.disabled = !!blocked[pin] || (clockPin && !!inputOnly[pin]);
        select.appendChild(option);
    }
    select.value = selected;
}

function scaleLiveText(settings, scale) {
    if (!scale || !scale.configured) return "<%= setup_not_configured %>";
    if (settings && !settings.use) return "<%= setup_scale_disabled %>";
    if (scale.state === 5) return "<%= setup_no_signal %>";
    if (scale.calibrating) return (scale.calAction === "tare" ? "<%= setup_zeroing %>" : "<%= setup_averaging %>") + (scale.calCount || 0) + "/" + (scale.calTarget || 30);
    // This page sets up hardware, so it shows the raw HX711 reading. Weight in
    // grams comes from the calibration factor and belongs on the Scale page.
    return Number(scale.rawCounts || 0) + "<%= setup_raw_counts %>";
}

function scaleLimit() {
    var n = window.scaleSettings && parseInt(window.scaleSettings.scaleLimit, 10);
    return n > 0 ? n : 8;
}
function scaleIsShown(scale) {
    if (!scale || scale.id < 2) return true;
    if (scale.configured) return true;
    if (scale.name) return true;
    if (scale.kegName) return true;
    if (scale.doutPin >= 0 || scale.clockPin >= 0) return true;
    return false;
}
function updateScaleAdd() {
    var add = document.getElementById("scaleadd");
    if (!add) return;
    var n = document.querySelectorAll("#scale-device-list .scale-device-row").length;
    add.hidden = n >= scaleLimit();
}
function nextScaleId() {
    var used = {};
    var rows = document.querySelectorAll("#scale-device-list .scale-device-row");
    for (var i = 0; i < rows.length; i++) used[parseInt(rows[i].dataset.scaleId, 10)] = true;
    var limit = scaleLimit();
    for (var id = 0; id < limit; id++) if (!used[id]) return id;
    return -1;
}
function paintScaleRow(row, scale) {
    row.dataset.scaleId = scale.id;
    row.dataset.originId = String(scale.id);
    row.querySelector(".scale-enabled").checked = !!scale.configured;
    row.querySelector(".scale-name").value = scale.name || "";
    row.querySelector(".scale-keg").value = scale.kegName || "";
    fillScalePins(row.querySelector(".scale-dout"), scale.doutPin, false);
    fillScalePins(row.querySelector(".scale-clock"), scale.clockPin, true);
    row.querySelector(".scale-live-value").textContent = scaleLiveText(window.scaleSettings || {}, scale);
    var title = row.querySelector(".scale-title");
    if (title) title.textContent = "<%= setup_scale %> " + (scale.id + 1);
    var remove = row.querySelector(".scale-remove");
    if (remove) remove.hidden = scale.id < 2;
    var defaults = [{dout:"<%= setup_default %> 25", clock:"<%= setup_default %> 26"}, {dout:"<%= setup_default %> 27", clock:"<%= setup_default %> 33"}];
    var doutNote = row.querySelector(".scale-dout").parentNode.querySelector(".pin-default");
    var clockNote = row.querySelector(".scale-clock").parentNode.querySelector(".pin-default");
    if (defaults[scale.id]) {
        if (doutNote) { doutNote.hidden = false; doutNote.textContent = defaults[scale.id].dout; }
        if (clockNote) { clockNote.hidden = false; clockNote.textContent = defaults[scale.id].clock; }
    }
}
function addScaleRow() {
    var id = nextScaleId();
    if (id < 0) return;
    var host = Q("#scale-device-list");
    var template = Q("#scale-device-template");
    if (!host || !template) return;
    var row = template.content.firstElementChild.cloneNode(true);
    paintScaleRow(row, {id:id, configured:false, name:"", kegName:"", doutPin:-1, clockPin:-1});
    row.dataset.originId = "";
    host.appendChild(row);
    updateScaleAdd();
    refreshAllPinNotes();
    if (row.scrollIntoView) row.scrollIntoView({block:"nearest"});
}
function renderScaleSettings(settings) {
    var host = Q("#scale-device-list");
    if (!host) return;
    window.scaleSettings = settings;
    host.innerHTML = "";
    var template = Q("#scale-device-template");
    settings.scales.forEach(function(scale) {
        if (!scaleIsShown(scale)) return;
        var row = template.content.firstElementChild.cloneNode(true);
        paintScaleRow(row, scale);
        host.appendChild(row);
    });
    updateScaleAdd();
}

function loadScaleSettings() {
    s_ajax({url:"/scale",m:"GET",success:function(data){renderScaleSettings(JSON.parse(data));}});
}

function saveScaleSettings() {
    var currentRows = document.querySelectorAll(".scale-device-row");
    var current = window.scaleSettings || {};
    var payload = {action:"settings",use:!!current.use,retentionDays:current.retentionDays || 180,eventThresholdGrams:current.eventThresholdGrams || 100,maxPourMl:current.maxPourMl || 1500,scales:[]};
    currentRows.forEach(function(row) {
        var origin = row.dataset.originId;
        var old = (origin !== undefined && origin !== "" && current.scales) ? (current.scales[parseInt(origin, 10)] || {}) : {};
        payload.scales.push({id:parseInt(row.dataset.scaleId,10),configured:row.querySelector(".scale-enabled").checked,name:row.querySelector(".scale-name").value.trim(),kegName:row.querySelector(".scale-keg").value.trim(),doutPin:parseInt(row.querySelector(".scale-dout").value,10),clockPin:parseInt(row.querySelector(".scale-clock").value,10),emptyKegGrams:old.emptyKegGrams || 0,capacityMl:old.capacityMl || 19000,beerDensityKgPerL:old.beerDensityKgPerL || 1.010});
    });
    s_ajax({url:"/scale",m:"POST",data:"data="+encodeURIComponent(JSON.stringify(payload)),success:function(){alert("<%= setup_scale_saved %>");loadScaleSettings();},fail:function(error){alert("<%= setup_scale_save_failed %>"+error+(window.__ajaxErrorBody?" - "+window.__ajaxErrorBody:""));}});
}

function refreshScaleSettings() {
    s_ajax({url:"/scale",m:"GET",success:function(data){
        var settings=JSON.parse(data);
        window.scaleSettings=settings;
        document.querySelectorAll(".scale-device-row").forEach(function(row){
            var scale=settings.scales[parseInt(row.dataset.scaleId,10)];
            if(scale) row.querySelector(".scale-live-value").textContent=scaleLiveText(settings, scale);
        });
    }});
}

function detachNode(query) {
    var d = document.querySelector(query);
    d.parentNode.removeChild(d);
    return d;
}

function init(classic) {
    if (typeof classic == "undefined") classic = false;
    if (!classic) {
        getActiveNavItem();
        Q("#verinfo").innerHTML = "v" + JSVERSION;
    }

    window.sensorContainer = detachNode(".device-container.sensor-device");
    window.pinContainer = detachNode(".device-container.pin-device");
    window.extsensorContainer = detachNode(".device-container.extsensor-device");
    window.owContainer = detachNode(".device-container.ow-device");
    window.dhtsensorContainer =detachNode(".device-container.env-temp-device");
    window.bme280Container=detachNode(".device-container.bme280-device");
    window.board= "e"; //default ESP8266
    BWF.init({
        error: function(a) {
            //                alert("<%= setup_comm_error %>")
        },
        onconnect:function(){
            BWF.send("n");
        },
        handlers: {
            d: function(a) {
                installed_list = a
            },
            h: function(a) {
                available_list = a;
                listGot()
            },
            N:function(a){
                window.board= a.b;
                list();
            },
            A: function(a) {
                if (a && a.eepromInit) eraseDone();
            }
        }
    });
    loadScaleSettings();
    var scaleSave = Q("#scale-save");
    if(scaleSave) scaleSave.onclick = saveScaleSettings;
    var deviceList = document.getElementById("device-list");
    if (deviceList) deviceList.addEventListener("change", onSetupChange);
    var scaleList = document.getElementById("scale-device-list");
    if (scaleList) {
        scaleList.addEventListener("change", function(){ refreshAllPinNotes(); });
        scaleList.addEventListener("click", function(ev){
            var btn = ev.target.closest ? ev.target.closest(".scale-remove") : null;
            if (!btn) return;
            var row = btn.closest(".scale-device-row");
            if (row && row.parentNode) row.parentNode.removeChild(row);
            updateScaleAdd();
            refreshAllPinNotes();
        });
    }
    var scaleBtn = document.getElementById("scalebtn");
    if (scaleBtn) scaleBtn.onclick = addScaleRow;
    var addBtn = document.getElementById("addbtn");
    if (addBtn) addBtn.onclick = function(){
        var picker = document.getElementById("add-picker");
        var tile = document.getElementById("addtile");
        var open = picker.hidden;
        picker.hidden = !open;
        tile.classList.toggle("open", open);
        addBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    var picker = document.getElementById("add-picker");
    if (picker) picker.addEventListener("click", function(ev){
        var btn = ev.target.closest ? ev.target.closest("[data-add]") : null;
        if (!btn) return;
        document.getElementById("add-picker").hidden = true;
        document.getElementById("addtile").classList.remove("open");
        addUserDevice(btn.getAttribute("data-add"));
    });
    window.setInterval(refreshScaleSettings, 2000);
}

function blockscreen(a) {
    document.getElementById("blockscreencontent").innerHTML = a;
    document.getElementById("blockscreen").style.display = "block"
}

function unblockscreen() {
    document.getElementById("blockscreen").style.display = "none"
};

function download(blob, file) {
    var link = document.createElement("a");

    if (link.download === undefined) { // feature detection
        alert("<%= script_viewer_not_downloading_file %>");
        return;
    }

    var url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", file);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

}
