var JSVERSION = "1.0";

function s_ajax(b) {
    var c = new XMLHttpRequest();
    c.onreadystatechange = function() {
        if (c.readyState == 4) {
            if (c.status == 200) {
                b.success(c.responseText)
            } else {
                c.onerror(c.status)
            }
        }
    };
    c.ontimeout = function() {
        if (typeof b["timeout"] != "undefined") b.timeout();
        else c.onerror(-1)
    }, c.onerror = function(a) {
        // Keep the body of a failed response so a page can say WHY the
        // controller rejected the request instead of only the status code.
        window.__ajaxErrorBody = (c.responseText || "").slice(0, 200);
        if (typeof b["fail"] != "undefined") b.fail(a)
    };
    c.open(b.m, b.url, true);
    if (typeof b["data"] != "undefined") {
        c.setRequestHeader("Content-Type", (typeof b["mime"] != "undefined") ? b["mime"] : "application/x-www-form-urlencoded");
        c.send(b.data)
    } else c.send()
}

var Q = function(d) {
    return document.querySelector(d);
};

function doAll(c,act){
    document.querySelectorAll(c).forEach(function(i){act(i)});
}

function C2F(c) {
    return Math.round((c * 1.8 + 32) * 10) / 10
}

function F2C(f) {
    return Math.round((f - 32) / 1.8 * 10) / 10
}

function openDlgLoading() {
    document.getElementById('dlg_loading').style.display = "block";
}

function closeDlgLoading() {
    document.getElementById('dlg_loading').style.display = "none";
}

var BrewMath = {
    abv: function(og, fg) {
        return ((76.08 * (og - fg) / (1.775 - og)) * (fg / 0.794)).toFixed(1);
    },
    abvP: function(og, fg) {
        return BrewMath.abv(BrewMath.pla2sg(og), BrewMath.pla2sg(fg));
    },
    att: function(og, fg) {
        return Math.round((og - fg) / (og - 1) * 100);
    },
    attP: function(pog, pfg) {
        return Math.round((pog - pfg) / pog * 100);
    },
    sg2pla: function(sg) {
        return (((182.4601 * sg - 775.6821) * sg + 1262.7794) * sg - 669.5622);
    },
    pla2sg: function(pla) {
        return 1 + (pla / (258.6 - ((pla / 258.2) * 227.1)));
    },
    tempCorrectionF(sg, t, c) {
        var nsg = sg * ((1.00130346 - 0.000134722124 * t + 0.00000204052596 * t * t - 0.00000000232820948 * t * t * t) /
            (1.00130346 - 0.000134722124 * c + 0.00000204052596 * c * c - 0.00000000232820948 * c * c * c));
        return nsg;
    },
    pTempCorrectionF(sg, t, c) {
        return BrewMath.sg2pla(BrewMath.tempCorrectionF(BrewMath.pla2sg(sg), t, c));
    },
    tempCorrection(celsius, sg, t, c) {
        return celsius ? BrewMath.tempCorrectionF(sg, C2F(t), C2F(c)) : BrewMath.tempCorrectionF(sg, t, c);
    },
    pTempCorrection(celsius, sg, t, c) {
        return celsius ? BrewMath.pTempCorrectionF(sg, C2F(t), C2F(c)) : BrewMath.pTempCorrectionF(sg, t, c);
    }
};

Date.prototype.shortLocalizedString = function() {
    var y = this.getYear() + 1900;
    var re = new RegExp('[^\d]?' + y + '[^\d]?');
    var n = this.toLocaleDateString();
    var ds = n.replace(re, "");
    var HH = this.getHours();
    var MM = this.getMinutes();

    function T(x) {
        return (x > 9) ? x : ("0" + x);
    }
    return ds + " " + T(HH) + ":" + T(MM);
};

function getActiveNavItem() {
    var path = window.location.pathname.split("/").pop();
    if (path == "") path = "index.htm";
    var element = Q('.options>li>a[href="/' + path + '"]');
    if(element) element.className += 'active';
}

function formatDate(dt) {
    //	var y = dt.getFullYear();
    //	var M = dt.getMonth() +1;
    //	var d = dt.getDate();
    var h = dt.getHours();
    var m = dt.getMinutes();
    //    var s = dt.getSeconds();
    function dd(n) {
        return (n < 10) ? '0' + n : n;
    }
    //	return dd(M) + "/" + dd(d) + "/" + y +" "+ dd(h) +":"+dd(m)+":"+dd(s);
    //	return dd(M) + "/" + dd(d) +" "+ dd(h) +":"+dd(m);
    return dt.toLocaleDateString() + " " + dd(h) + ":" + dd(m);
}

function formatDateForPicker(date) {
    var h = date.getHours();
    var m = date.getMinutes();

    function dd(n) { return (n < 10) ? '0' + n : n; }
    return date.getFullYear() + "-" + dd(date.getMonth() + 1) + "-" + dd(date.getDate()) + "T" + dd(h) + ":" + dd(m);
}

function pressureNavOn() {
    try { return localStorage.getItem("yeast2tap-pressure-nav") === "1"; } catch (e) { return false; }
}

function applyPressureNav() {
    if (!document.body) return;
    document.body.classList.toggle("show-pressure", pressureNavOn());
}

function setPressureNav(on) {
    try { localStorage.setItem("yeast2tap-pressure-nav", on ? "1" : "0"); } catch (e) {}
    applyPressureNav();
}

function applyYeastTheme(name, save) {
    if (name === undefined) name = (window.__yeastTheme !== undefined) ? window.__yeastTheme : "";
    var allowed = { sage: 1, slate: 1, plum: 1, brew: 1, lab: 1, hops: 1, amber: 1 };
    if (!allowed[name]) name = "";
    var previous = document.documentElement.getAttribute("data-theme") || "";
    if (name) document.documentElement.setAttribute("data-theme", name);
    else document.documentElement.removeAttribute("data-theme");
    var nodes = document.querySelectorAll(".theme-swatch");
    for (var i = 0; i < nodes.length; i++) {
        var on = nodes[i].getAttribute("data-theme-choice") === name;
        if (on) nodes[i].classList.add("is-selected");
        else nodes[i].classList.remove("is-selected");
        nodes[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (save) {
        s_ajax({
            url: "/theme",
            m: "POST",
            data: "data=" + encodeURIComponent(JSON.stringify({ theme: name })),
            success: function() { window.__yeastTheme = name; },
            fail: function() { applyYeastTheme(previous); }
        });
    }
}

document.addEventListener("DOMContentLoaded", function () {
    applyPressureNav();
    if (window.__yeastTheme !== undefined) applyYeastTheme(window.__yeastTheme);
});