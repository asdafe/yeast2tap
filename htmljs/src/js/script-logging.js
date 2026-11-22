var logurl = "log";

// Starting template for a Generic HTTP service. The notation is the one the
// helper table documents; %b/%g/%u are filled in by the controller.
var DEFAULT_HTTP_FORMAT = '{"beerTemp":%b,"beerSet":%B,"fridgeTemp":%f,"fridgeSet":%F,"roomTemp":%r,"gravity":%g,"timestamp":"%u"}';

String.prototype.escapeJSON = function() {
    return this.replace(/[\\]/g, '\\\\')
        .replace(/[\"]/g, '\\\"')
        .replace(/[\/]/g, '\\/')
        .replace(/[\b]/g, '\\b')
        .replace(/[\f]/g, '\\f')
        .replace(/[\n]/g, '\\n')
        .replace(/[\r]/g, '\\r')
        .replace(/[\t]/g, '\\t');
};

// Human readable size. The filesystem figures arrive in bytes.
function fmtBytes(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return "--";
    if (n >= 1048576) return (n / 1048576).toFixed(2) + "<%= log_unit_mb %>";
    if (n >= 1024) return (n / 1024).toFixed(1) + "<%= log_unit_kb %>";
    return n + "<%= log_unit_b %>";
}

// uptime arrives in seconds
function fmtUptime(s) {
    s = Number(s);
    if (!isFinite(s) || s < 0) return "--";
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + "<%= log_unit_days %>" + h + "<%= log_unit_hours %>";
    if (h > 0) return h + "<%= log_unit_hours %> " + m + "<%= log_unit_minutes %>";
    return m + "<%= log_unit_minutes %>";
}

// Read-only device health from GET /getstatus (system.uptime + system.heap).
// One request per page load; failures leave the "--" placeholders alone.
function loadHealth() {
    s_ajax({
        url: "/getstatus",
        m: "GET",
        success: function(d) {
            var j;
            try { j = JSON.parse(d); } catch (e) { return; }
            var sys = j.system || {};
            var h = sys.heap || {};
            var up = Q("#health-uptime");
            var hp = Q("#health-heap");
            var bl = Q("#health-block");
            if (up) up.innerHTML = fmtUptime(sys.uptime);
            if (hp) hp.innerHTML = fmtBytes(h.free);
            if (bl) bl.innerHTML = fmtBytes(h.largestBlock);
        }
    });
}

// Page-head status chip: idle vs recording.
function setStateChip(recording) {
    var chip = Q("#log-state-chip");
    var text = Q("#log-state-text");
    if (chip) chip.classList.toggle("is-live", !!recording);
    if (text) text.innerHTML = recording ? "<%= log_recording %>" : "<%= log_idle %>";
}

function setCount(sel, n) {
    var el = Q(sel);
    if (el) el.innerHTML = "" + n;
}


var logs = {
    url: "loglist.php",
    rmurl: "loglist.php?rm=",
    starturl: "loglist.php?start=",
    stopurl: "loglist.php?stop=1",
    dlurl: "loglist.php?dl=",
    ll: [],
    fs: {},
    logging: false,
    vname: function(name) {
        if (name == "") return false;
        if (name.match(/[\W]/g)) return false;
        return true;
    },
    dupname: function(name) {
        var ret = false;
        this.ll.forEach(function(log) {
            if (name == log.name) ret = true;
        });
        return ret;
    },
    fsinfo: function(s, u) {
        var free = s - u;
        var pct = s > 0 ? Math.round(u * 100 / s) : 0;
        Q("#fssize").innerHTML = fmtBytes(s);
        Q("#fsused").innerHTML = fmtBytes(u);
        Q("#fsfree").innerHTML = fmtBytes(free);
        var head = Q("#head-free");
        if (head) head.innerHTML = fmtBytes(free);
        var pctnode = Q("#fs-pct");
        if (pctnode) pctnode.innerHTML = pct + "%";
        var arc = Q("#fs-arc");
        if (arc) arc.setAttribute("stroke-dasharray", pct + " 100");
        var bar = Q("#fs-bar");
        if (bar) bar.style.width = pct + "%";
    },
    stoplog: function() {
        var t = this;
        if (t.logging) {
            // stop
            if (confirm("<%= script_logging_stop_current_logging %>")) {
                //console.log("Stop logging");
                var n = Q("#logname").value.trim();
                s_ajax({
                    url: t.stopurl + n,
                    m: "GET",
                    success: function(d) {
                        location.reload();
                    },
                    fail: function(d) {
                        alert("<%= script_logging_failed_stop_for %>" + d);
                    }
                });
            }
        }
    },
    startlog: function() {
        var t = this;
        if (!t.logging) {
            if (t.ll.length >= 10) {
                alert("<%= script_logging_too_many_logs %>");
                return;
            }
            if ((t.fs.size - t.fs.used) <= t.fs.block * 2) {
                alert("<%= script_logging_not_free_space %>");
                return;
            }
            var name = Q("#logname").value.trim();
            if (t.vname(name) === false) {
                alert("<%= script_logging_invalid_file_name %>");
                return;
            }
            if (t.dupname(name)) {
                alert("<%= script_logging_duplicated_name %>");
                return;
            }
            var arg = (Q("#calispindel").checked)? "&raw=1":"";

            var wobf = Q("#wobf").checked;
            arg += "&wobf=" + (wobf? "1":"0");

            if (confirm("<%= script_logging_start_new_log %>")) {
                //console.log("Start logging");
                s_ajax({
                    url: t.starturl + name + arg,
                    m: "GET",
                    success: function(d) {
                        location.reload();
                    },
                    fail: function(d,s) {
                        alert("<%= script_logging_failed_start_for %> " + d +" "+s);
                    }
                });
            }
        }
    },
    recording: function(n, t) {
        this.logging = true;
        var d = new Date(t * 1000);
        Q("#start-log-date").innerHTML = d.toLocaleString();
        Q("#loggingtitle").innerHTML = n;
        Q("#logstartinput").style.display = "none";
        Q("#logstopinput").style.display = "block";
        setStateChip(true);
    },
    stop: function() {
        this.logging = false;
        Q("#logstartinput").style.display = "block";
        Q("#logstopinput").style.display = "none";
        if (Q("#wobf")) Q("#wobf").checked = false;
        if (Q("#calispindel")) Q("#calispindel").checked = false;
        setStateChip(false);
    },
    //view:function(n){
    //	alert("<%= log_view %> " + this.ll[n].name);
    //	window.open(this.vurl+ n);
    //},
    rm: function(n) {
        var t = this;
        if (confirm("<%= script_logging_delete_the_log %> " + t.ll[n].name)) {
            console.log("rm " + t.ll[n].name);
            s_ajax({
                url: t.rmurl + n,
                m: "GET",
                success: function(d) {
                    var r = JSON.parse(d);
                    t.fs = r;
                    t.fsinfo(r.size, r.used);
                    t.ll.splice(n, 1);
                    t.list(t.ll);
                },
                fail: function(d) {
                    alert("<%= script_logging_failed_delete_for %>" + d);
                }
            });
        }
    },
    dl: function(n) {
        //console.log("DL " +this.ll[n].name);
        window.open(this.dlurl + n);
    },
    // The log being written right now. The firmware treats a negative index as
    // "the live file" and streams it through a separate read handle, so recording
    // is not disturbed.
    dlLive: function() {
        window.open(this.dlurl + "-1");
    },
    list: function(l) {
        var tb = Q("#loglist").querySelector("tbody");
        var tr;
        while (tr = tb.querySelector("tr:nth-of-type(2)"))
            tb.removeChild(tr);

        var t = this;
        var row = t.row;
        l.forEach(function(i, idx) {
            var name = i.name;
            var date = new Date(i.time * 1000);
            var nr = row.cloneNode(true);
            nr.querySelector(".logid").innerHTML = name;
            nr.querySelector(".logdate").innerHTML = date.toLocaleString();
            nr.querySelector(".dlbutton").onclick = function() {
                t.dl(idx);
            };
            //		nr.querySelector(".viewbutton").onclick=function(){t.view(idx);};
            nr.querySelector(".rmbutton").onclick = function() {
                t.rm(idx);
            };
            tb.appendChild(nr);
        });
        setCount("#log-count", l.length);
        setCount("#rec-count", l.length);
    },
    init: function() {
        var t = this;
        Q("#startlogbutton").onclick = function() {
            t.startlog();
        };
        Q("#stoplogbutton").onclick = function() {
            t.stoplog();
        };
        Q("#livedlbutton").onclick = function() {
            t.dlLive();
        };
        var remoteSwitch = Q("#enabled");
        if (remoteSwitch) remoteSwitch.onchange = function() {
            // Turning the switch ON only reveals the settings: there is nothing to
            // send yet, and posting an empty service was what produced the bare
            // "failed:406". The Update button is what actually enables it.
            //
            // Turning it OFF must take effect on its own: the settings hide at the
            // same moment, so leaving the last step to the Update button made
            // remote logging impossible to switch off. disableRemoteLog() posts the
            // off state and only folds the card away once the controller accepted
            // it; a failure puts the switch back and keeps the card open.
            if (remoteSwitch.checked) {
                setRemoteStatus("");
                syncRemoteLogCard();
            } else {
                disableRemoteLog();
            }
        };
        syncRemoteLogCard();

        t.row = Q("#loglist").querySelector("tr:nth-of-type(2)");
        t.row.parentNode.removeChild(t.row);
        s_ajax({
            url: t.url,
            m: "GET",
            success: function(d) {
                var r = JSON.parse(d);
                t.fs = r.fs;
                if (r.rec)
                    t.recording(r.log, r.start);
                t.ll = r.list;
                t.list(r.list);
                t.fsinfo(r.fs.size, r.fs.used);
                if (Q("#wobf")) Q("#wobf").checked = false;
                if (Q("#calispindel")) Q("#calispindel").checked = false;

                if (typeof r["plato"] != "undefined" && r.plato) {
                    window.plato = true;
                    var th = document.querySelectorAll(".tiltwatercorrect");
                    for (var i = 0; i < th.length; i++)
                        th[i].style.display = "none";
                } else window.plato = false;
            },
            fail: function(e) {
                alert("<%= log_failed_colon %>" + e);
            }
        });
        loadHealth();
    },
};
// for remote logging
function checkurl(t) {
    if (t.value.trim().startsWith("https")) {
        alert("<%= script_logging_https_not_supported %>");
    }
}

function checkformat(ta) {
    if (ta.value.length > 256) {
        ta.value = ta.value.substring(0, 256);
    }
    var hint = Q("#fmthint");
    if (hint) hint.innerHTML = "" + ta.value.length + "/256";
}

function cmethod(c) {
    var inputs = document.querySelectorAll('input[name$="method"]');
    for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].id != c.id)
            inputs[i].checked = false;
    }
    // Radios carry no value attribute, so derive the method from the id.
    window.selectedMethod = (c.id == "m_get") ? "GET" : (c.id == "m_post") ? "POST" : "PUT";
}

//Serivce specif widget processing
// generic http
// Set by the service getters when they refuse to build a configuration, so the
// caller can say which field is missing instead of a bare "failed".
function remoteConfigFail(message) {
    window.remoteConfigError = message;
    return null;
}

function generichttp_get() {
    // GET is checked by default in the markup, so start from it instead of
    // failing with "select Method!" when no radio was touched this load.
    if (typeof window.selectedMethod == "undefined") {
        var checkedMethod = document.querySelector('input[name$="method"]:checked');
        window.selectedMethod = checkedMethod
            ? (checkedMethod.id == "m_get" ? "GET" : checkedMethod.id == "m_post" ? "POST" : "PUT")
            : "GET";
    }
    var url = Q("#url").value.trim();
    var format = Q("#format").value.trim();
    var method = window.selectedMethod || "GET";

    if (!url) return remoteConfigFail("<%= log_need_url %>");
    if (!format) return remoteConfigFail("<%= log_need_format %>");

    // Whitespace is not legal in a GET query string. The old test used the
    // string "\s", which only matches a literal "s".
    if (method == "GET" && /\s/.test(format)) {
        return remoteConfigFail("<%= script_logging_space_not_allowed %>");
    }

    var r = {};
    r.url = url;
    r.format = format;
    // The radio choice is the source of truth; PUT used to be sent as GET.
    r.method = method;
    r.type = Q("#data-type").value.trim();
    r.service = 3;
    return r;
}

function generichttp_set(r) {
    Q("#service-type").value = "generichttp";
    serviceOption("generichttp");
    window.selectedMethod = r.method;
    Q("#m_" + r.method.toLowerCase()).checked = true;
    Q("#url").value = (r.url === undefined) ? "" : r.url;
    Q("#data-type").value = (r.type === undefined) ? "" : r.type;
    // A saved format wins; an empty one gets a starting template so the box is
    // never blank and the service can be enabled after only pasting the URL.
    var saved = (r.format === undefined) ? "" : r.format;
    Q("#format").value = saved !== "" ? saved : DEFAULT_HTTP_FORMAT;
    checkformat(Q("#format"));
}
// ubidots.com
function ubidots_set(r) {
    Q("#service-type").value = "ubidots";
    serviceOption("ubidots");

    // different api    
    var match = /http:\/\/([\w\.]+)\.ubidots\.com\/api\/v1\.6\/devices\/(\w+)\/\?token=(\w+)$/.exec(r.url);

    Q("select[name=ubidots-account]").value = (match[1] == "things") ? 1 : 2;
    Q("#ubidots-device").value = match[2];
    Q("#ubidots-token").value = match[3];

}

function ubidots_get() {
    var device = Q("#ubidots-device").value.trim();
    if (!device) return remoteConfigFail("<%= log_need_device %>");
    var token = Q("#ubidots-token").value.trim();
    if (!token) return remoteConfigFail("<%= log_need_token %>");
    var info = {};
    info.url = (Q("select[name=ubidots-account]").value == 1) ?
        "http://things.ubidots.com/api/v1.6/devices/" + device + "/?token=" + token :
        "http://industrial.api.ubidots.com/v1.6/devices/" + device + "/?token=" + token;

    info.format = "{}";
    info.method = "POST";
    info.type = "application/json";
    info.service = 1;
    return info;
}
// thingspeak.com
function thingspeak_set(r) {
    Q("#service-type").value = "thingspeak";
    serviceOption("thingspeak");

    var values = {};
    var fields = r.format.split('&');
    for (var i = 0; i < fields.length; i++) {
        var pair = fields[i].split("=");
        values[pair[0]] = pair[1];
    }

    Q("#thingspeak-apikey").value = values["api_key"];

    for (var i = 1; i < 9; i++)
        Q("select[name=thingspeak-f" + i + "]").value = (typeof values["field" + i] == "undefined") ?
        "unused" : values["field" + i].substring(1);
}

function thingspeak_get() {
    var apikey = Q("#thingspeak-apikey").value.trim();
    if (!apikey) return remoteConfigFail("<%= log_need_apikey %>");
    apikey = "api_key=" + apikey;
    var format = apikey;
    for (var i = 1; i < 9; i++) {
        var v = Q("select[name=thingspeak-f" + i + "]").value;
        if (v != "unused") format = format + "&field" + i + "=%" + v;
    }
    if (format == apikey) return remoteConfigFail("<%= log_need_field %>");

    var info = {};
    info.url = "http://api.thingspeak.com/update";
    info.format = format;
    info.method = "POST";
    info.type = "application/x-www-form-urlencoded";
    info.service = 0;
    return info;
}
//brewfahter
function brewfather_set(r) {
    Q("#service-type").value = "brewfather";
    serviceOption("brewfather");

    var match = /http:\/\/log\.brewfather\.net\/brewpiless\?id=(\w+)$/.exec(r.url);
    Q("#brewfather-id").value = match[1];
    var idmatch = /"id":"([^"]+)"/.exec(r.format);
    Q("#brewfather-device").value = idmatch[1];
}

function brewfather_get(r) {
    var uid = Q("#brewfather-id").value.trim();
    var device = Q("#brewfather-device").value.trim();
    if (!uid) return remoteConfigFail("<%= log_need_streamid %>");
    if (!device) return remoteConfigFail("<%= log_need_device %>");

    var info = {};
    info.url = "http://log.brewfather.net/brewpiless?id=" + uid;

    var format = "{\"id\":\"" + device +
        "\",\"beerTemp\":%b,\"beerSet\":%B,\"fridgeTemp\":%f,\"fridgeSet\":%F,\"roomTemp\":%r,\"gravity\":%g,\"tiltValue\":%t,\"auxTemp\":%a,\"extVolt\":%v,\"timestamp\":%u,\"tempUnit\":\"%U\",\"pressure\":%P,\"mode\":\"%M\",\"humidity\":%h}";

    info.format = format;

    info.method = "POST";
    info.type = "application/json";
    info.service = 0;
    return info;
}

//brewfahter
function brewersfriend_set(r) {
    Q("#service-type").value = "brewersfriend";
    serviceOption("brewersfriend");

    var match = /\/\/log\.brewersfriend\.com\/stream\/(\w+)$/.exec(r.url);


    Q("#brewersfriend-apikey").value = match[1];

    var beermatch = /"beer":"([^"]+)"/.exec(r.format);
    Q("#brewersfriend-beer").value = beermatch[1];

    var gumatch = /"gravity_unit":"([P|G])"/.exec(r.format);
    if (gumatch[1] == "P") {
        Q("#gu-sg").checked = false;
        Q("#gu-plato").checked = true;
    } else {
        Q("#gu-sg").checked = true;
        Q("#gu-plato").checked = false;
    }
}

function brewersfriend_get(r) {
    var gf = "%g";
    var gu = "G";
    if (Q('input[name="BF-gu"]:checked').value == "gu-plato") {
        var gf = "%p";
        var gu = "P";
    }
    //http://log.brewersfriend.com/stream/[API KEY]
    var apikey = Q("#brewersfriend-apikey").value.trim();
    var beer = Q("#brewersfriend-beer").value.trim();
    if (!apikey) return remoteConfigFail("<%= log_need_apikey %>");
    if (!beer) return remoteConfigFail("<%= log_need_beer %>");

    var format = "{\"name\":\"%H\",\"temp\": %b,\"temp_unit\": \"%U\",\"gravity\":" + gf +
        ",\"gravity_unit\":\"" + gu + "\",\"ph\": \"\",\"comment\": \"\",\"beer\":\"" + beer + "\",\"battery\":%v,\"RSSI\": \"\",\"angle\": %t}";

    var info = {};
    info.url = 'http://log.brewersfriend.com/stream/' + apikey;

    info.format = format;

    info.method = "POST";
    info.type = "application/json";
    info.service = 2; // null string instead of null
    return info;
}
//
function service_set(r) {
    if (r.service == 1) { // ubidots.com 
        ubidots_set(r);
    } if (r.service == 0){ // generic http, auto
        if (/http:\/\/api\.thingspeak\.com\//.exec(r.url))
            thingspeak_set(r);
        else if (/http:\/\/log\.brewfather\.net\//.exec(r.url))
            brewfather_set(r);
        else if (/http:\/\/log\.brewersfriend\.com\//.exec(r.url))
            brewersfriend_set(r);
    } else
        generichttp_set(r);
}

// The payload the controller expects. It always carries every required key, even
// when a service getter refuses to build one: switching the service OFF is
// allowed with an empty URL, and a half-filled card must still be switchable off.
function remoteLogPayload(enabled) {
    var service = Q("#service-type").value;
    var r;
    window.remoteConfigError = "";
    if (service == "generichttp") r = generichttp_get();
    else if (service == "ubidots") r = ubidots_get();
    else if (service == "thingspeak") r = thingspeak_get();
    else if (service == "brewfather") r = brewfather_get();
    else if (service == "brewersfriend") r = brewersfriend_get();

    if (!r) {
        if (enabled) return null;    // the caller reports why
        r = {
            url: (Q("#url") && Q("#url").value.trim()) || "",
            format: (Q("#format") && Q("#format").value) || "",
            method: window.selectedMethod || "POST",
            type: (Q("#data-type") && Q("#data-type").value.trim()) || "",
            service: 3
        };
    }
    r.enabled = !!enabled;
    r.period = Q("#period").value;
    if (r.period < 60) r.period = 60;
    if (r.period < 900 && (service == "brewfather" || service == "brewersfriend")) r.period=900;
    return r;
}

function setRemoteStatus(text, ok) {
    var el = Q("#remote-status");
    if (!el) return;
    el.textContent = text || "";
    el.className = "logs-status" + (text ? " is-shown " + (ok === false ? "is-bad" : "is-ok") : "");
}

// Switching remote logging off is one click, with nothing left to confirm: post
// the disabled state straight away, keep the card open while the request is in
// flight, and fold it only after the controller says it stored the change.
var remoteOffPending = false;
function disableRemoteLog() {
    if (remoteOffPending) return;
    remoteOffPending = true;
    setRemoteStatus("<%= log_remote_turning_off %>");

    var r = remoteLogPayload(false);
    s_ajax({
        url: logurl,
        m: "POST",
        data: "data=" + encodeURIComponent(JSON.stringify(r)),
        success: function() {
            remoteOffPending = false;
            window.remoteEnabled = false;
            window.remoteLogReady = true;
            if (Q("#enabled")) Q("#enabled").checked = false;
            syncRemoteLogCard();               // now it is safe to hide the fields
            setRemoteStatus("<%= log_remote_off_done %>");
        },
        fail: function(e) {
            remoteOffPending = false;
            if (Q("#enabled")) Q("#enabled").checked = true;
            syncRemoteLogCard(true);           // keep the fields, and Update, visible
            setRemoteStatus("<%= log_remote_off_failed %>" + e, false);
        }
    });
}

function update(quiet) {
    var service = Q("#service-type").value;
    var enabled = Q("#enabled").checked;
    var r = remoteLogPayload(enabled);

    if (enabled && !r) {
        // Turning remote logging on needs a complete service configuration.
        // Say which field is missing instead of echoing the controller's 406.
        var why = window.remoteConfigError || "<%= failed %>";
        if (quiet) {
            Q("#enabled").checked = !!window.remoteEnabled;
            syncRemoteLogCard();
        }
        setRemoteStatus(why, false);
        alert(why);
        return;
    }

    s_ajax({
        url: logurl,
        m: "POST",
        // The body is form-urlencoded, so the JSON is encoded as a whole. The
        // payload format inside it is sent raw: JSON.stringify already escapes
        // its quotes, and the transport encoding carries "&" and "%" intact.
        data: "data=" + encodeURIComponent(JSON.stringify(r)),
        success: function(d) {
            window.remoteEnabled = !!enabled;
            window.remoteLogReady = true;
            syncRemoteLogCard();
            setRemoteStatus(enabled ? "<%= log_remote_on_done %>" : "<%= log_remote_off_done %>");
            if (!quiet) alert("<%= done %>");
        },
        fail: function(e) {
            if (quiet) {
                Q("#enabled").checked = !!window.remoteEnabled;
                syncRemoteLogCard();
            }
            setRemoteStatus("<%= log_failed_colon %> " + e, false);
            alert("<%= log_failed_colon %>" + e);
        }
    });
}

function remote_init(classic) {
    var MinPeriod = { generichttp: 60, thingspeak: 15, brewfather: 900, ubidots: 60,brewersfriend:900 };
    // GET is the checked default in the markup; make the JS state match it so a
    // save without touching a method radio does not raise "select Method!".
    window.selectedMethod = "GET";
    Q("#period").onchange = function() {
        var min = MinPeriod[Q("#service-type").value];
        if (Q("#period").value < min) Q("#period").value = min;
    };

    serviceOption("generichttp");
    // Start the format box with a usable template; service_set() replaces it
    // with the saved one when there is one.
    if (Q("#format") && Q("#format").value === "") {
        Q("#format").value = DEFAULT_HTTP_FORMAT;
        checkformat(Q("#format"));
    }

    s_ajax({
        url: logurl + "?data=1",
        m: "GET",
        success: function(d) {
                var r = JSON.parse(d);
                if (typeof r.enabled == "undefined") return;
                window.remoteEnabled = !!r.enabled;
                Q("#enabled").checked = window.remoteEnabled;
                syncRemoteLogCard();
                Q("#period").value = (r.period === undefined) ? 300 : r.period;
                service_set(r);
                window.remoteLogReady = true;
            }
            /*,
                fail:function(d){
                        alert("<%= log_error_colon %>" + d);
                  }*/
    });
}

// The notation popup is opened by hovering the "Notations" label. It used to
// close the instant the pointer left the label, so it was impossible to move
// into the list and click an entry. Hiding is now delayed, and entering the
// popup cancels it. A click inserts the token at the caret.
var formatHideTimer = null;

function showformat(lab) {
    var f = Q("#formatlist");
    if (!f) return;
    if (formatHideTimer) { clearTimeout(formatHideTimer); formatHideTimer = null; }
    var rec = lab.getBoundingClientRect();
    f.style.display = "block";
    f.style.left = (rec.right + 5) + "px";
    f.style.top = (rec.bottom + window.pageYOffset + 5) + "px";
}

function hideformat() {
    if (formatHideTimer) clearTimeout(formatHideTimer);
    formatHideTimer = setTimeout(function () {
        var f = Q("#formatlist");
        if (f) f.style.display = "none";
        formatHideTimer = null;
    }, 260);
}

function insertFormatToken(token) {
    var ta = Q("#format");
    if (!ta || !token) return;
    var start = ta.selectionStart, end = ta.selectionEnd;
    var v = ta.value;
    if (typeof start !== "number") start = end = v.length;
    ta.value = v.slice(0, start) + token + v.slice(end);
    var caret = start + token.length;
    ta.selectionStart = ta.selectionEnd = caret;
    ta.focus();
    checkformat(ta);
}

function initFormatList() {
    var f = Q("#formatlist");
    if (!f) return;
    f.addEventListener("mouseenter", function () {
        if (formatHideTimer) { clearTimeout(formatHideTimer); formatHideTimer = null; }
    });
    f.addEventListener("mouseleave", hideformat);
    f.addEventListener("click", function (e) {
        var node = e.target;
        while (node && node !== f && node.tagName !== "TH") node = node.parentNode;
        if (!node || node === f || node.tagName !== "TH") return;
        insertFormatToken((node.textContent || "").trim());
        var box = Q("#formatlist");
        if (box) box.style.display = "none";
    });
}

function syncRemoteLogCard(keepOpen) {
    var card = Q("#remote-log-card");
    var on = Q("#enabled") && Q("#enabled").checked;
    if (card) card.classList.toggle("is-collapsed", !on && !keepOpen);
}

function serviceOption(opt) {
    var divs = document.querySelectorAll("#service-opt > div");
    for (var i = 0; i < divs.length; i++) {
        var div = divs[i];
        if (div.id == opt) div.style.display = "block";
        else div.style.display = "none";
    }
    Q("#period").onchange();
}

function serviceChange() {
    serviceOption(Q("#service-type").value);
}

function init(classic) {
    if (typeof classic == "undefined") classic = false;
    if (!classic) {
        getActiveNavItem();
        Q("#verinfo").innerHTML = "v" + JSVERSION;
    }

    remote_init(classic);
    logs.init();

    mqttInit();
    initFormatList();
}