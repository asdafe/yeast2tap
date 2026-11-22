var SCHEDULE_URL = "/tschedule";
var MAX_STEP = 10;

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
// Normalise a temperature entry to the dot convention. A comma is not converted:
// it comes back empty so the caller's existing invalid-temperature alert fires.
function normTempStr(s) {
    var v = Num.parse(s);
    return v === null ? "" : String(v);
}

function formatSetTemp(raw) {
    return (Math.round(Number(raw)) / 100).toFixed(2);
}
var profileEditor = {
    dirty: false,
    C_startday_Id: "#startdate",
    C_savebtn_Id: "savebtn",
    markdirty: function(d) {
        this.dirty = d;
        document.getElementById(this.C_savebtn_Id).innerHTML = (d) ? "Save*" : "Save";
    },
    getStartDate: function() {
        return this.sd;
    },
    setStartDate: function(d) {
        this.sd = d;
        var date_in = Q(this.C_startday_Id);
        date_in.value = (date_in.type == "datetime-local") ? formatDateForPicker(d) : formatDate(d);
    },
    startDayChange: function() {
        var nd = new Date(Q(this.C_startday_Id).value);
        if (isNaN(nd.getTime())) {
            // console.log("invalid date");
            this.setStartDate(this.sd);
        } else {
            // console.log(nd);
            this.sd = nd;
            this.reorg();
            this.markdirty(true);
        }
    },
    startnow: function() {
        var d = new Date();
        this.setStartDate(d);
        this.reorg();
        this.markdirty(true);
        ControlChart.update(this.chartdata());
    },
    rowList: function() {
        var tb = document.getElementById("profile_t").getElementsByTagName("tbody")[0];
        return tb.getElementsByTagName("tr");
    },
    sgChange: function(td) {
        if (!isNaN(td.innerHTML) || td.innerHTML.match(/^[\d]+%$/) || td.innerHTML == "") {
            td.saved = td.innerHTML;
            this.markdirty(true);
        } else {
            td.innerHTML = td.saved;
        }
    },
    dayChange: function(td) {
        if (td.innerHTML == "" || isNaN(td.innerHTML))
            td.innerHTML = td.saved;
        else {
            this.markdirty(true);
            this.reorg();
            ControlChart.update(this.chartdata());
        }
    },
    tempChange: function(td) {
        if (td.innerHTML == "" || isNaN(td.innerHTML))
            td.innerHTML = td.saved;
        else {
            td.innerHTML = Number(td.innerHTML).toFixed(2);
            this.markdirty(true);
            ControlChart.update(this.chartdata());
        }
    },
    stableChange: function(td) {
        if (td.innerHTML.match(/^\s*(\d+)@(\d+)\s*$/)) {
            td.saved = td.innerHTML;
            this.markdirty(true);
        } else if (!isNaN(td.innerHTML)) {
            td.saved = parseInt(td.innerHTML);
            this.markdirty(true);
        } else {
            td.innerHTML = td.saved;
        }
    },
    initrow: function(tr, stage) {
        var b = this;
        // temp setting
        var type = stage.c;
        tr.type = type;
        var tdTemp = tr.getElementsByClassName("stage-temp")[0];

        if (type == "r") {
            tdTemp.innerHTML = "";
        } else {
            tdTemp.innerHTML = Number(stage.t).toFixed(2);
            tdTemp.contentEditable = true;
            tdTemp.onblur = function() {
                b.tempChange(this);
            };
            tdTemp.onfocus = function() {
                this.saved = this.innerHTML;
            };
        }
        // day setting
        var tdDay = tr.getElementsByClassName("stage-time")[0];
        tdDay.innerHTML = stage.d;
        tdDay.contentEditable = true;
        tdDay.onblur = function() {
            b.dayChange(this);
        };
        tdDay.onfocus = function() {
            this.saved = this.innerHTML;
        };

        // stable setting
        var tdStable = tr.getElementsByClassName("stage-stabletime")[0];
        // sg. only valid for hold
        var tdSG = tr.getElementsByClassName("stage-sg")[0];

        if (type == "r") {
            tdSG.innerHTML = "";
            tdStable.innerHTML = "";
        } else {
            tdSG.saved = stage.g;
            tdSG.innerHTML = (typeof stage.g == "undefined") ? "" : stage.g;
            tdSG.contentEditable = true;
            tdSG.onblur = function() {
                b.sgChange(this);
            };
            tdSG.onfocus = function() {
                this.saved = this.innerHTML;
            };
            if (typeof stage.s == "undefined") tdStable.innerHTML = "";
            else tdStable.innerHTML = (typeof stage.x == "undefined") ? stage.s : stage.x + "@" + stage.s;
            tdStable.contentEditable = true;
            tdStable.onblur = function() {
                b.stableChange(this);
            };
            tdStable.onfocus = function() {
                this.saved = this.innerHTML;
            };
        }


        var forTime = tr.getElementsByClassName("for-time")[0];
        // condition, only valid for hold
        var conSel = tr.getElementsByClassName("condition")[0];
        /*
           <option value="t" 0>Time</option>
           <option value="g" 1>SG</option>
           <option value="s" 2>Stable</option>
           <option value="a" 3>Time & SG</option>
           <option value="o" 4>Time OR SG</option>
           <option value="u" 5>Time OR Stable</option>
           <option value="v" 6>Time & Stable</option>
            <option value="b" 7>SG OR Stable</option>
            <option value="x" 8>SG & Stable</option>
            <option value="w" 9>ALL</option>
            <option value="e" 10>Either</option>
        */
        var condtionIndex = {
            t: 0,
            g: 1,
            a: 3,
            s: 2,
            o: 4,
            u: 5,
            v: 6,
            b: 7,
            x: 8,
            w: 9,
            e: 10
        };
        if (type == "r") {
            forTime.style.display = "block";
            conSel.style.display = "none";

        } else {
            conSel.value = stage.c;
            conSel.selectedIndex = condtionIndex[stage.c];

            forTime.style.display = "none";
            conSel.style.display = "block";
        }
    },

    datestr: function(diff) {
        var dt = new Date(this.sd.getTime() + Math.round(diff * 86400) * 1000);
        return formatDate(dt);
    },
    reorg: function() {
        var rowlist = this.rowList();
        var utime = this.sd.getTime();
        for (var i = 0; i < rowlist.length; i++) {
            var row = rowlist[i];
            row.className = (i % 2) ? "odd" : "even";
            row.getElementsByClassName("diaplay-time")[0].innerHTML = formatDate(new Date(utime));
            var time = this.rowTime(row);
            utime += Math.round(time * 86400) * 1000;
        }
    },
    chartdata: function() {
        var rowlist = this.rowList();
        if (rowlist.length == 0 || typeof this.sd =="undefined")  return [];

        var utime = this.sd.getTime();
        var row = rowlist[0];
        var start = this.rowTemp(row);

        var list = [];
        list.push([new Date(utime), start]);

        for (var i = 0; i < rowlist.length; i++) {
            var row = rowlist[i];
            var temp;
            if (row.type == "r") {
                temp = this.rowTemp(rowlist[i + 1]);
            } else {
                temp = this.rowTemp(row);
            }
            utime += Math.round(this.rowTime(row) * 86400) * 1000;
            list.push([new Date(utime), temp]);
        }
        return list;
    },
    addRow: function() {
        var tb = document.getElementById("profile_t").getElementsByTagName("tbody")[0];
        var rowlist = tb.getElementsByTagName("tr");

        if (rowlist.length >= MAX_STEP) {
            alert("<%= script_control_too_many_steps %>");
            return;
        }
        var stage;
        var beerNow = window.lastBeerTemp;
        var init = (typeof beerNow == "number" && !isNaN(beerNow)) ? Math.round(beerNow * 10) / 10 : ((BrewPiSetting.tempUnit == "C") ? 20 : 68);

          if (rowlist.length == 0) {
              stage = {
                c: 't',
                t: init,
                d: 1,
                g: 1.01
            };
        } else {
            var trRamp = this.row.cloneNode(true);
            this.initrow(trRamp, {
                c: "r",
                d: 1
            });
            tb.appendChild(trRamp);
            stage = {
                c: 't',
                t: init,
                d: 1,
                g: ""
            };
        }

        var tr = this.row.cloneNode(true);
        this.initrow(tr, stage);
        tb.appendChild(tr);

        this.reorg();
        this.markdirty(true);
        ControlChart.update(this.chartdata());
    },
    delRow: function() {
        // delete last row
        var list = this.rowList();
        if (list.length == 0) return;
        var last = list[list.length - 1];

        if (list.length > 1) {
            var lr = list[list.length - 2];
            lr.parentNode.removeChild(lr);
        }

        last.parentNode.removeChild(last);

        this.markdirty(true);
        ControlChart.update(this.chartdata());
    },
    rowTemp: function(row) {
        return parseFloat(row.getElementsByClassName("stage-temp")[0].innerHTML);
    },
    rowCondition: function(row) {
        return row.getElementsByClassName("condition")[0].value;
    },
    rowTime: function(row) {
        return parseFloat(row.getElementsByClassName("stage-time")[0].innerHTML);
    },
    rowSg: function(row) {
        return row.getElementsByClassName("stage-sg")[0].saved;
    },
    rowSt: function(row) {
        var data = row.getElementsByClassName("stage-stabletime")[0].innerHTML;
        if (typeof data != "string") return data;
        var matches = data.match(/^\s*(\d+)@(\d+)\s*$/);
        if (matches) {
            return parseInt(matches[2]);
        } else {
            return parseInt(data);
        }
    },
    rowStsg: function(row) {
        var data = row.getElementsByClassName("stage-stabletime")[0].innerHTML;
        if (typeof data != "string") return false;
        var matches = data.match(/^\s*(\d+)@(\d+)\s*$/);
        if (matches) {
            return parseInt(matches[1]);
        } else {
            return false;
        }
    },
    renderRows: function(g) {
        if (typeof g.length == "undefined")
            console.log("error!");
        var e = document.getElementById("profile_t").getElementsByTagName("tbody")[0];
        for (var f = 0; f < g.length; f++) {
            var c = this.row.cloneNode(true);
            this.initrow(c, g[f]);
            e.appendChild(c)
        }
        this.reorg()
    },

    initable: function(c) {
        if (!this.row) {
            var b = document.getElementById("profile_t").getElementsByTagName("tbody")[0];
            this.row = b.getElementsByTagName("tr")[0];
            b.removeChild(this.row);
        } else {
            this.clear();
        }
        this.renderRows(c)
    },
    clear: function() {
        var rl = this.rowList();

        var count = rl.length;
        for (var i = rl.length - 1; i >= 0; i--) {
            var tr = rl[i];
            tr.parentNode.removeChild(tr);
        }
        this.markdirty(true);
    },
    getProfile: function() {
        var rl = this.rowList();
        var lastdate = 0;
        var temps = [];
        for (var i = 0; i < rl.length; i++) {
            var tr = rl[i];
            var day = this.rowTime(tr);
            if (isNaN(day)) return false;

            if (tr.type == "r") {
                temps.push({
                    c: "r",
                    d: day
                });
            } else {
                var temp = this.rowTemp(tr);
                if (isNaN(temp)) return false;
                if (temp > BrewPiSetting.maxDegree || temp < BrewPiSetting.minDegree) return false;

                /*
                   <option value="t">Time</option>
                   <option value="g">SG</option>
                   <option value="s">Stable</option>
                   <option value="a">Time & SG</option>
                   <option value="o">Time OR SG</option>
                   <option value="u">Time OR Stable</option>
                   <option value="v">Time & Stable</option>
                    <option value="b">SG OR Stable</option>
                    <option value="x">SG & Stable</option>
                    <option value="w">ALL</option>
                    <option value="e">Either</option>
                */
                var condition = this.rowCondition(tr);
                var stage = {
                    c: condition,
                    d: day,
                    t: temp
                };

                var useSg = "gaobxwe";
                var gv = this.rowSg(tr);

                if (useSg.indexOf(condition) >= 0) {
                    if (gv == "") return false;
                    stage.g = gv;
                }
                var useStableTime = "suvbxwe";
                var stv = this.rowSt(tr);
                if (useStableTime.indexOf(condition) >= 0) {
                    if (isNaN(stv)) return false;
                    stage.s = stv;
                    var x = this.rowStsg(tr);
                    if (x) stage.x = x;
                }

                temps.push(stage);

            }
        }
        var s =parseInt(this.sd.getTime()/1000);
        var flags = profileEditor.flagOverride || (typeof modekeeper !== "undefined" ? modekeeper.flagsForView() : { tg: "b", hr: 0, sp: 0 });
        var ret = {
            s: s,
            v: 2,
            u: BrewPiSetting.tempUnit,
            t: temps,
            tg: flags.tg,
            hr: flags.hr,
            sp: flags.sp || profileEditor.startPolicy || 0
        };
        //console.log(ret);
        return ret;
    },
    convertUnit:function(steps,unit){
        if(unit ==  BrewPiSetting.tempUnit) return steps;

        for(var i=0;i< steps.length;i++)
            steps[i].t = (unit == 'F')? F2C(steps[i].t):C2F(steps[i].t);
        
        return steps;
    },
    loadProfile: function(a) {
        this.sd = new Date(a.s * 1000);
        this.clear();
        this.renderRows(this.convertUnit(a.t,a.u));
        ControlChart.update(this.chartdata());
    },
    initProfile: function(p) {
        if (typeof p != "undefined") {
            // start date
            var sd = new Date(p.s * 1000);
            this.setStartDate(sd);
            this.initable(this.convertUnit(p.t,p.u));
        } else {
            this.setStartDate(new Date());
            this.initable([]);
        }
    },
    setTempUnit: function(u) {
        if (u == BrewPiSetting.tempUnit) return;
        var rl = this.rowList();
        for (var i = 0; i < rl.length; i++) {
            var tcell = rl[i].querySelector('td.stage-temp');
            var temp = parseFloat(tcell.innerHTML);
            if (!isNaN(temp)) tcell.innerHTML = ((u == 'C') ? F2C(temp) : C2F(temp)).toFixed(2);
        }
        ControlChart.updateTU(u);
        ControlChart.update(this.chartdata());
    }
};

/* end of profile.js */
/* PL: profle list */
var PL = {
    pl_path: "P",
    url_list: "/list",
    url_save: "/fputs",
    url_del: "/rm",
    url_load: "pl.php?ld=",
    div: "#profile-list-pane",
    shown: false,
    initialized: false,
    plist: [],
    path: function(a) {
        return "/" + this.pl_path + "/" + a
    },
    depath: function(a) {
        var dir;
        if(a.startsWith("/")){
           dir= "/" + this.pl_path + "/" ;
        }else{
            dir= this.pl_path + "/" ;
        }
        if(a.startsWith(dir)) return a.substring(dir.length);
        else return a;
    },
    rm: function(e) {
        var f = this;
        var c = "path=" + f.path(f.plist[e]);
        s_ajax({
            url: f.url_del,
            m: "DELETE",
            data: c,
            success: function(a) {
                f.plist.splice(e, 1);
                f.list(f.plist)
            },
            fail: function(a) {
                alert("<%= failed %>:" + a);
            }
        })
    },
    load: function(e) {
        var f = this;
        var c = f.path(f.plist[e]);
        s_ajax({
            url: c,
            m: "GET",
            success: function(b) {
                var a = JSON.parse(b);
                profileEditor.loadProfile(a);
            },
            fail: function(a) {
                //alert("failed:" + a);
            }
        })
    },
    list: function(i) {
        var a = this;
        var h = Q(a.div).querySelector(".profile-list");
        var lis = h.querySelectorAll("li");
        for (var i = 0; i < lis.length; i++) {
            h.removeChild(lis[i]);
        }
        var b = a.row;
        a.plist.forEach(function(f, g) {
            var c = b.cloneNode(true);
            c.querySelector(".profile-name").innerHTML = f;
            c.querySelector(".profile-name").onclick = function(j) {
                j.preventDefault();
                a.load(g);
                return false
            };
            c.querySelector(".rmbutton").onclick = function() {
                a.rm(g)
            };
            h.appendChild(c)
        })
    },
    append: function(b) {
        if (!this.initialized) {
            return
        }
        this.plist.push(b);
        this.list(this.plist)
    },
    init: function() {
        var a = this;
        a.initialized = true;
        a.row = Q(a.div).querySelector("li");
        a.row.parentNode.removeChild(a.row);
        s_ajax({
            url: a.url_list,
            m: "POST",
            data: "dir=" + a.path(""),
            success: function(c) {
                a.plist = [];
                var b = JSON.parse(c);
                b.forEach(function(e) {
                    if (e.type == "file") {
                        a.plist.push(a.depath(e.name))
                    }
                });
                a.list(a.plist)
            },
            fail: function(b) {
                alert("<%= failed %>:" + b);
            }
        })
    },
    toggle: function() {
        if (!this.initialized) {
            this.init()
        }
        this.shown = !this.shown;
        if (this.shown) {
            Q(this.div).style.display = "block";
        } else {
            Q(this.div).style.display = "none";
        }
    },
    saveas: function() {
        Q("#dlg_saveas").style.display = "block"
    },
    cancelSave: function() {
        Q("#dlg_saveas").style.display = "none"
    },
    doSave: function() {
        var e = Q("#dlg_saveas input").value;
        if (e == "") {
            return
        }
        if (e.match(/[\W]/g)) {
            return
        }
        var g = profileEditor.getProfile();
        if (g === false) {
            alert("<%= script_control_invalid_value_check_again %>");
            return
        }
        var f = this;
        var c = "path=" + f.path(e) + "&content=" + encodeURIComponent(JSON.stringify(g));
        var f = this;
        s_ajax({
            url: f.url_save,
            m: "POST",
            data: c,
            success: function(a) {
                f.append(e);
                f.cancelSave()
            },
            fail: function(a) {
                alert("<%= failed %>:" + a);
            }
        })
    }
};
/* end of PL*/
var BrewPiSetting = {
    valid: false,
    maxDegree: 30,
    minDegree: 0,
    tempUnit: 'C'
};


var ControlChart = {
    unit: "C",
    init: function(div, data, unit) {
        var t = this;
        t.data = data;
        t.unit = unit;

        var dateFormatter = function(v) {
            d = new Date(v);
            return d.shortLocalizedString();
        };
        var shortDateFormatter = function(v) {
            d = new Date(v);
            var y = d.getYear() + 1900;
            var re = new RegExp('[^\d]?' + y + '[^\d]?');
            var n = d.toLocaleDateString();
            return n.replace(re, "");
        };

        var temperatureFormatter = function(v) {
            return v.toFixed(2) + "&deg;" + t.unit;
        };

        t.chart = new Dygraph(
            document.getElementById(div), t.data, {
                colors: ['rgb(89, 184, 255)'],
                axisLabelFontSize: 12,
                gridLineColor: '#ccc',
                gridLineWidth: '0.1px',
                labels: ["<%= script_control_time %>", "<%= script_control_temperature %>"],
                labelsDiv: document.getElementById(div + "-label"),
                legend: 'always',
                labelsDivStyles: {
                    'textAlign': 'right'
                },
                strokeWidth: 1,
                //        xValueParser: function(x) { return profileTable.parseDate(x); },
                //        underlayCallback: updateCurrentDateLine,
                //        "Temperature" : {},
                axes: {
                    y: {
                        valueFormatter: temperatureFormatter,
                        pixelsPerLabel: 20,
                        axisLabelWidth: 52
                    },
                    //            x : { axisLabelFormatter:dateFormatter, valueFormatter: dateFormatter, pixelsPerLabel: 30, axisLabelWidth:40 }
                    x: {
                        axisLabelFormatter: shortDateFormatter,
                        valueFormatter: dateFormatter,
                        pixelsPerLabel: 30,
                        axisLabelWidth: 40
                    }

                },
                highlightCircleSize: 2,
                highlightSeriesOpts: {
                    strokeWidth: 1.5,
                    strokeBorderWidth: 1,
                    highlightCircleSize: 5
                },

            }
        );
    },
    update: function(data) {
        if (!data || data.length == 0) return;
        this.data = data;
        if (!this.chart) return;
        this.chart.updateOptions({
            'file': this.data
        });
    },
    reveal: function() {
        if (!this.chart) return;
        var chart = this.chart;
        requestAnimationFrame(function() { chart.resize(); });
    },
    updateTU: function(unit) {
        this.unit = unit;
    }
};


var modekeeper = {
    initiated: false,
    touched: false,
    device: null,
    viewState: { method: "pid", what: "beer", src: "fixed", hsrc: "fixed" },
    view: function () { return this.viewState; },
    note: function (text) {
        var n = document.getElementById("apply-note");
        if (n) n.textContent = text || "";
    },
    seg: function (group, value) {
        var buttons = document.querySelectorAll('.seg[data-g="' + group + '"] button');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute("aria-selected", buttons[i].getAttribute("data-v") === value ? "true" : "false");
        }
    },
    paint: function () {
        var S = this.viewState;
        var hint = document.getElementById("mhint");
        if (hint) hint.textContent = S.method === "pid"
            ? "PID control drives both the heater and the cooler toward the setpoint."
            : "Independent control runs the cooler and the heater from their own setpoints. They can operate at the same time.";
        var pid = document.getElementById("pid-panel");
        var ind = document.getElementById("ind-panel");
        if (pid) pid.hidden = S.method !== "pid";
        if (ind) ind.hidden = S.method !== "ind";
        var beerWrap = document.getElementById("beer-fixed-wrap");
        var fridgeWrap = document.getElementById("fridge-fixed-wrap");
        if (beerWrap) beerWrap.hidden = S.what !== "beer";
        if (fridgeWrap) fridgeWrap.hidden = S.what !== "fridge";
        var label = document.getElementById("pid-fixed-label");
        if (label) label.textContent = S.what === "fridge" ? "Fixed fridge setpoint" : "Fixed beer setpoint";
        var chip = document.getElementById("pid-x");
        if (chip) chip.hidden = S.what !== "fridge";
        var rampPid = S.method === "pid" && S.src === "ramp";
        var rampHeat = S.method === "ind" && S.hsrc === "ramp";
        var warn = document.getElementById("pid-warn");
        if (warn) warn.hidden = !(rampPid && S.what === "fridge");
        var stand = document.getElementById("pid-standby");
        if (stand) stand.hidden = !rampPid;
        var hstand = document.getElementById("heat-standby");
        if (hstand) hstand.hidden = !rampHeat;
        // Independent heater pulse-PI panel: only with the "On" radio selected.
        var piRadio = document.querySelector("input[name=hystMode]:checked");
        var piOn = S.method === "ind" && piRadio && piRadio.value === "1";
        var piPanel = document.getElementById("ind-pi-panel");
        if (piPanel) piPanel.hidden = !piOn;
        var piHint = document.getElementById("ind-pi-hint");
        if (piHint) piHint.hidden = !piOn;
        var editor = document.getElementById("profile-s");
        if (editor) {
            if (rampPid || rampHeat) {
                var slot = document.getElementById(S.method === "ind" ? "ind-slot" : "pid-slot");
                if (slot && editor.parentNode !== slot) slot.appendChild(editor);
                editor.hidden = false;
            } else editor.hidden = true;
            if (!editor.hidden) ControlChart.reveal();
        }
        var run = document.getElementById("mode-run");
        var sub = document.getElementById("msub");
        if (!sub) return;
        var fixedEl = document.getElementById(S.what === "fridge" ? "fridge-t" : "beer-t");
        var fixedTxt = fixedEl && fixedEl.value ? fixedEl.value : "--";
        var line;
        if (S.method === "pid") {
            line = "PID · " + (S.what === "fridge" ? "Fridge" : "Beer") + " · " + (S.src === "ramp" ? ("Ramp profile" + (S.what === "fridge" ? " (experimental)" : "")) : ("Fixed " + fixedTxt + " °C"));
        } else {
            var coolOn = document.getElementById("fridge-temp");
            var heatOn = document.getElementById("beer-set");
            var coolV = document.getElementById("independent-cool-t");
            var heatV = document.getElementById("independent-heat-t");
            line = "Independent · Cooling " + (coolOn && coolOn.checked && coolV && coolV.value ? coolV.value + " °C" : "off")
                + " · Heating " + (heatOn && heatOn.checked ? (S.hsrc === "ramp" ? "ramp profile" : ((heatV && heatV.value) ? heatV.value + " °C" : "--")) : "off");
        }
        sub.textContent = line + " · " + (run && run.checked ? "control enabled" : "control off");
    },
    setField: function (id, value, force) {
        var el = document.getElementById(id);
        if (!el || (!force && el._userTouched)) return;
        if (value === null || value === undefined || value === "") return;
        el.value = value;
    },
    // Numeric field used by the Independent pulse-PI panel. Never overwrites a
    // value the user is typing, and leaves an empty field empty.
    setNumField: function (id, value) {
        if (value === null || value === undefined || value === "") return;
        var el = document.getElementById(id);
        if (!el || el._userTouched || document.activeElement === el) return;
        var n = Number(value);
        if (!isFinite(n)) return;
        el.value = String(Math.round(n * 100) / 100);
    },
    showSetpoint: function (id, raw, follow) {
        var el = document.getElementById(id);
        if (!el || raw === null || raw === undefined || !(Number(raw) > -10000)) return;
        var typing = document.activeElement === el;
        if (follow && !typing) el._userTouched = false;
        this.setField(id, formatSetTemp(raw), follow && !typing);
    },
    ingest: function (c) {
        if (!c) return;
        var md = c.md;
        if (!this.touched && typeof md != "undefined") {
            var S = this.viewState;
            if (md === "i") { S.method = "ind"; S.hsrc = (c.htr == 1) ? "ramp" : "fixed"; }
            else {
                S.hsrc = "fixed";
                if (md === "p") { S.method = "pid"; S.what = "beer"; S.src = "ramp"; }
                else if (md === "f") { S.method = "pid"; S.what = "fridge"; S.src = (c.tg == 1) ? "ramp" : "fixed"; }
                else { S.method = "pid"; S.what = "beer"; S.src = "fixed"; }
            }
            this.seg("method", S.method);
            this.seg("what", S.what);
            this.seg("src", S.src);
            this.seg("hsrc", S.hsrc);
        }
        var rampBeer = (md === "p") || (md === "i" && c.htr == 1);
        var rampFridge = (md === "f" && c.tg == 1);
        var liveBeer = (typeof c.bs != "undefined" && c.bs > -10000) ? c.bs : c.bx;
        var liveFridge = (typeof c.fs != "undefined" && c.fs > -10000) ? c.fs : c.fx;
        this.showSetpoint("beer-t", liveBeer, rampBeer);
        this.showSetpoint("fridge-t", liveFridge, rampFridge);
        if (md === "i") {
            var coolEn = document.getElementById("fridge-temp");
            var heatEn = document.getElementById("beer-set");
            if (coolEn && typeof c.fs != "undefined") {
                if (!coolEn._userTouched) coolEn.checked = c.fs > -10000;
                if (coolEn.checked) this.showSetpoint("independent-cool-t", c.fs, false);
                document.getElementById("independent-cool-t").disabled = !coolEn.checked;
            }
            if (heatEn && typeof c.bs != "undefined") {
                if (!heatEn._userTouched) heatEn.checked = c.bs > -10000 || c.htr == 1;
                this.showSetpoint("independent-heat-t", (c.bs > -10000) ? c.bs : c.bx, c.htr == 1);
                document.getElementById("independent-heat-t").disabled = !heatEn.checked;
            }
        }
        var runEl = document.getElementById("mode-run");
        if (runEl && !runEl._userTouched && typeof md != "undefined") runEl.checked = md !== "o";
        var hystTouched = false;
        var hystRadios = document.querySelectorAll("input[name=hystMode]");
        for (var hi = 0; hi < hystRadios.length; hi++) if (hystRadios[hi]._userTouched) hystTouched = true;
        if (!hystTouched && typeof c.hm != "undefined") {
            var offRadio = document.getElementById("independent-pid-off");
            var onRadio = document.getElementById("independent-pid-on");
            if (offRadio && onRadio) { onRadio.checked = c.hm != 0; offRadio.checked = c.hm == 0; }
        }
        // Independent pulse-PI constants (heater only). They only exist in the
        // control-constants message, so the fields are filled here.
        this.setNumField("ind-pi-kp", c.indKp);
        this.setNumField("ind-pi-ki", c.indKi);
        this.setNumField("ind-pi-pulse", c.indPulse);
        this.device = {
            md: md,
            bs: (typeof c.bs != "undefined") ? c.bs : null,
            fs: (typeof c.fs != "undefined") ? c.fs : null,
            hm: (typeof c.hm != "undefined") ? c.hm : 0,
            kp: (typeof c.indKp != "undefined") ? Number(c.indKp) : null,
            ki: (typeof c.indKi != "undefined") ? Number(c.indKi) : null,
            pulse: (typeof c.indPulse != "undefined") ? Number(c.indPulse) : null,
            tg: c.tg || 0,
            htr: c.htr || 0,
            bx: (typeof c.bx != "undefined") ? c.bx : null,
            fx: (typeof c.fx != "undefined") ? c.fx : null
        };
        this.paint();
    },
    init: function () {
        var me = this;
        if (me.initiated) return;
        me.initiated = true;
        var groups = document.querySelectorAll(".seg[data-g]");
        for (var g = 0; g < groups.length; g++) {
            var buttons = groups[g].querySelectorAll("button");
            for (var b = 0; b < buttons.length; b++) {
                buttons[b].onclick = function () {
                    me.touched = true;
                    var group = this.parentNode.getAttribute("data-g");
                    var value = this.getAttribute("data-v");
                    if (group === "method") me.viewState.method = value === "ind" ? "ind" : "pid";
                    else if (group === "what") me.viewState.what = value;
                    else if (group === "src") me.viewState.src = value;
                    else if (group === "hsrc") me.viewState.hsrc = value;
                    me.seg(group, value);
                    me.paint();
                    return false;
                };
            }
        }
        var run = document.getElementById("mode-run");
        if (run) run.onchange = function () { run._userTouched = true; me.paint(); };
        function wire(boxId, inputId) {
            var box = document.getElementById(boxId);
            var input = document.getElementById(inputId);
            if (!box || !input) return;
            var sync = function () { input.disabled = !box.checked; me.paint(); };
            box.onchange = function () { box._userTouched = true; sync(); };
            input.addEventListener("input", function () { input._userTouched = true; me.paint(); });
            sync();
        }
        wire("fridge-temp", "independent-cool-t");
        wire("beer-set", "independent-heat-t");
        ["beer-t", "fridge-t"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener("input", function () { el._userTouched = true; me.paint(); });
        });
        var hystRadios = document.querySelectorAll("input[name=hystMode]");
        for (var h = 0; h < hystRadios.length; h++) hystRadios[h].onchange = function () {
            this._userTouched = true;
            me.paint();		// open/close the pulse-PI panel immediately
        };
        ["ind-pi-kp", "ind-pi-ki", "ind-pi-pulse"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener("input", function () { el._userTouched = true; });
        });
        var easy = document.getElementById("easybtn");
        if (easy) easy.onclick = function () { openEasyRamp(); };
        me.paint();
    },
    postProfile: function (extra, done) {
        var r = profileEditor.getProfile();
        if (r === false) { alert("<%= script_control_invalid_value_check_again %>"); return; }
        if (extra) { for (var k in extra) if (extra.hasOwnProperty(k)) r[k] = extra[k]; }
        s_ajax({
            url: SCHEDULE_URL,
            m: "POST",
            mime: "application/x-www-form-urlencoded",
            data: "data=" + encodeURIComponent(JSON.stringify(r)),
            success: function () { profileEditor.markdirty(false); if (done) done(true); },
            fail: function () { if (done) done(false); else alert("<%= script_control_failed_to_save %>"); }
        });
    },
    flagsForView: function () {
        var S = this.viewState;
        return {
            tg: (S.method === "pid" && S.what === "fridge" && S.src === "ramp") ? "f" : "b",
            hr: (S.method === "ind" && S.hsrc === "ramp") ? 1 : 0,
            sp: profileEditor.startPolicy || 0
        };
    },
    sendControl: function (body, expect) {
        var me = this;
        clearTimeout(this.ptimer);
        clearInterval(this.piter);
        BWF.send("j{" + body + "}");
        this.pending = expect || null;
        this.bad = null;
        this.last = null;
        if (!this.pending) { this.note(""); return; }
        this.note("Applying...");
        // The write may still be waiting behind a login prompt, so keep asking
        // for the device's values instead of checking once.
        var ask = function () { if (me.pending) BWF.send("s"); };
        ask();
        var n = 0;
        this.piter = setInterval(function () {
            if (++n > 3) { clearInterval(me.piter); return; }
            ask();
        }, 700);
        this.ptimer = setTimeout(function () {
            clearInterval(me.piter);
            if (!me.pending) return;
            me.pending = null;
            me.note(me.last ? "Not applied: " + me.bad.join(", ") + " did not stick."
                            : "No confirmation from the controller.");
        }, 3500);
    },
    // The device answers "s" with the values it actually holds now.
    confirm: function (s) {
        var p = this.pending;
        if (!p) return;
        this.last = s;
        this.bad = [];
        // PiLink's 'S' echo uses the write keys (beerSet/fridgeSet), not the
        // camelCase names the HTTP status block uses. Reading the wrong names
        // made every Apply claim the setpoint "did not stick" even though the
        // controller had stored it.
        if (p.mode && s.mode !== p.mode) this.bad.push("mode");
        if (!this.sameSet(s.beerSet, p.beer)) this.bad.push("beer setpoint");
        if (!this.sameSet(s.fridgeSet, p.fridge)) this.bad.push("fridge setpoint");
        if (typeof p.hm != "undefined" && String(s.hystMode) !== String(p.hm)) this.bad.push("heater mode");
        if (typeof p.kp != "undefined" && Math.abs(Number(s.indKp) - p.kp) > 0.005) this.bad.push("Kp");
        if (typeof p.ki != "undefined" && Math.abs(Number(s.indKi) - p.ki) > 0.005) this.bad.push("Ki");
        if (typeof p.pulse != "undefined" && Math.abs(Number(s.indPulse) - p.pulse) > 0.005) this.bad.push("pulse");
        if (this.bad.length) return;
        this.pending = null;
        clearTimeout(this.ptimer);
        clearInterval(this.piter);
        this.note("Applied.");
        // Refresh the snapshot so the next Apply compares against the device,
        // not against the state read when the page was opened.
        var d = this.device || (this.device = { hm: 0, tg: 0, htr: 0 });
        d.md = s.mode;
        d.bs = (s.beerSet === null || typeof s.beerSet == "undefined") ? -20000 : Math.round(Number(s.beerSet) * 100);
        d.fs = (s.fridgeSet === null || typeof s.fridgeSet == "undefined") ? -20000 : Math.round(Number(s.fridgeSet) * 100);
        d.hm = Number(s.hystMode);
        if (typeof s.indKp != "undefined") d.kp = Number(s.indKp);
        if (typeof s.indKi != "undefined") d.ki = Number(s.indKi);
        if (typeof s.indPulse != "undefined") d.pulse = Number(s.indPulse);
    },
    // wanted: undefined = not checked, null = must be off, number = within 0.02.
    sameSet: function (actual, wanted) {
        if (typeof wanted == "undefined") return true;
        if (wanted !== null && !isFinite(wanted)) return true;
        if (wanted === null) return actual === null || actual === undefined || Number(actual) < -10000;
        if (actual === null || actual === undefined) return false;
        return Math.abs(Number(actual) - wanted) < 0.02;
    },
    applyIndependent: function () {
        var coolEn = document.getElementById("fridge-temp");
        var heatEn = document.getElementById("beer-set");
        var coolerOn = !coolEn || coolEn.checked;
        var heaterOn = !heatEn || heatEn.checked;
        if (!coolerOn && !heaterOn) { alert("<%= script_control_invalid_temperature %>"); return; }
        var vc = normTempStr(document.getElementById("independent-cool-t").value);
        var vh = normTempStr(document.getElementById("independent-heat-t").value);
        if (coolerOn && (vc === "" || isNaN(vc) || vc > BrewPiSetting.maxDegree || vc < BrewPiSetting.minDegree)) { alert("<%= script_control_invalid_temperature %>" + vc); return; }
        if (heaterOn && this.viewState.hsrc !== "ramp" && (vh === "" || isNaN(vh) || vh > BrewPiSetting.maxDegree || vh < BrewPiSetting.minDegree)) { alert("<%= script_control_invalid_temperature %>" + vh); return; }
        var pidRadio = document.querySelector("input[name=hystMode]:checked");
        var hystMode = pidRadio ? pidRadio.value : "0";
        // Pulse-PI constants: only meaningful (and only sent) when the heater
        // mode is On. They are validated the same way as the setpoints.
        var piVals = null;
        if (hystMode === "1") {
            piVals = this.readPiValues();
            if (!piVals) return;
        }
        var dev = this.device;
        var already = dev && dev.md === "i";
        var parts = [];
        if (!already) parts.push("mode:i");
        var coolSame = already && ((coolerOn && dev.fs > -10000 && normTempStr(formatSetTemp(dev.fs)) === vc) || (!coolerOn && dev.fs <= -10000));
        var heatRef = dev ? dev.bs : null;
        var heatSame = already && ((heaterOn && heatRef != null && heatRef > -10000 && normTempStr(formatSetTemp(heatRef)) === vh) || (!heaterOn && dev.bs <= -10000 && this.viewState.hsrc !== "ramp"));
        var hystSame = already && String(dev.hm) === String(hystMode);
        var piSame = already && (!piVals || (Number(dev.kp) === piVals.kp && Number(dev.ki) === piVals.ki && Math.abs(Number(dev.pulse) - piVals.pulse) < 0.005));
        var rampSame = already && ((this.viewState.hsrc === "ramp") === (dev.htr == 1));
        if (already && coolSame && heatSame && hystSame && piSame && rampSame) { this.note("No changes to apply."); return; }
        if (!coolSame || !already) parts.push(coolerOn ? ("fridgeSet:" + vc) : "fridgeSet:null");
        if (!heatSame || !already) parts.push(heaterOn ? ("beerSet:" + vh) : "beerSet:null");
        if (!hystSame || !already) parts.push("hystMode:" + hystMode);
        if (piVals && (!piSame || !already)) {
            parts.push("indKp:" + piVals.kp);
            parts.push("indKi:" + piVals.ki);
            parts.push("indPulse:" + piVals.pulse);
        }
        var expect = { mode: "i" };
        if (!coolSame || !already) expect.fridge = coolerOn ? Number(vc) : null;
        if (!heatSame || !already) expect.beer = heaterOn ? Number(vh) : null;
        if (!hystSame || !already) expect.hm = Number(hystMode);
        if (piVals && (!piSame || !already)) { expect.kp = piVals.kp; expect.ki = piVals.ki; expect.pulse = piVals.pulse; }
        var me = this;
        var sendParts = function () { if (parts.length) me.sendControl(parts.join(","), expect); else me.note(""); };
        if (!rampSame || !already) {
            if (this.viewState.hsrc === "ramp" && profileEditor.dirty) { alert("<%= script_control_save_profile_before_applay %>"); return; }
            var flags = this.flagsForView();
            if (profileEditor.startPolicy) flags.sp = profileEditor.startPolicy;
            this.postProfile(flags, function (ok) { if (ok) sendParts(); else alert("<%= script_control_failed_to_save %>"); });
        } else sendParts();
    },
    // Reads and validates the three pulse-PI fields. Returns null (and alerts)
    // when a value is unusable, so Apply never sends garbage.
    readPiValues: function () {
        var kp = this.readNum("ind-pi-kp");
        var ki = this.readNum("ind-pi-ki");
        var pulse = this.readNum("ind-pi-pulse");
        if (kp === null || kp <= 0 || kp > 200) { alert("<%= script_control_pi_invalid_kp %>"); return null; }
        if (ki === null || ki < 0 || ki > 200) { alert("<%= script_control_pi_invalid_ki %>"); return null; }
        if (pulse === null || pulse < 0.25 || pulse > 4) { alert("<%= script_control_pi_invalid_pulse %>"); return null; }
        return { kp: kp, ki: ki, pulse: pulse };
    },
    readNum: function (id) {
        var el = document.getElementById(id);
        if (!el) return null;
        var v = normTempStr(el.value);
        if (v === "" || isNaN(v)) return null;
        return Number(v);
    },
    apply: function () {
        if (!BrewPiSetting.valid) alert("<%= script_control_not_conected_to_controller %>");
        var run = document.getElementById("mode-run");
        if (run && !run.checked) { this.sendControl("mode:o", { mode: "o" }); return; }
        var S = this.viewState;
        var me = this;
        if (S.method === "ind") { this.applyIndependent(); return; }
        if (S.src === "ramp") {
            if (profileEditor.dirty) { alert("<%= script_control_save_profile_before_applay %>"); return; }
            var go = function () {
                me.postProfile(me.flagsForView(), function (ok) {
                    if (!ok) { alert("<%= script_control_failed_to_save %>"); return; }
                    if (S.what === "beer") {
                        document.getElementById("dlg_beerprofilereminder").style.display = "block";
                        document.getElementById("dlg_beerprofilereminder").querySelector("button.ok").onclick = function () {
                            document.getElementById("dlg_beerprofilereminder").style.display = "none";
                            var gravity = Num.field(Q("#dlg_beerprofilereminder input"),"Original gravity");
                            if (gravity === null) return;
                            if (typeof updateOriginGravity == "function") updateOriginGravity(gravity);
                            s_ajax({ url: "gravity", m: "POST", mime: "application/json", data: JSON.stringify({ name: "webjs", og: 1, gravity: gravity }), success: function () { me.sendControl("mode:p", { mode: "p" }); }, fail: function (d) { alert("<%= failed %>:" + d); } });
                        };
                        document.getElementById("dlg_beerprofilereminder").querySelector("button.oknog").onclick = function () {
                            document.getElementById("dlg_beerprofilereminder").style.display = "none";
                            me.sendControl("mode:p", { mode: "p" });
                        };
                        document.getElementById("dlg_beerprofilereminder").querySelector("button.cancel").onclick = function () {
                            document.getElementById("dlg_beerprofilereminder").style.display = "none";
                        };
                    } else me.sendControl("mode:f", { mode: "f" });
                });
            };
            if (S.what === "fridge") {
                var dlg = document.getElementById("dlg_fridge_exp");
                dlg.style.display = "block";
                document.getElementById("fridge-exp-cancel").onclick = function () { dlg.style.display = "none"; };
                document.getElementById("fridge-exp-ok").onclick = function () { dlg.style.display = "none"; go(); };
                return;
            }
            go();
            return;
        }
        var boxId = S.what === "fridge" ? "fridge-t" : "beer-t";
        var v = normTempStr(document.getElementById(boxId).value);
        if (v === "" || isNaN(v) || v > BrewPiSetting.maxDegree || v < BrewPiSetting.minDegree) { alert("<%= script_control_invalid_temperature %>" + v); return; }
        var dev = this.device;
        var sameMode = dev && ((S.what === "beer" && dev.md === "b") || (S.what === "fridge" && dev.md === "f" && dev.tg != 1));
        var sameTemp = dev && normTempStr(formatSetTemp(S.what === "beer" ? dev.bs : dev.fs)) === v;
        if (sameMode && sameTemp && dev.htr != 1) { this.note("No changes to apply."); return; }
        var cmd = (S.what === "beer" ? "mode:b, beerSet:" : "mode:f, fridgeSet:") + v;
        var expect = { mode: S.what === "beer" ? "b" : "f" };
        expect[S.what === "beer" ? "beer" : "fridge"] = Number(v);
        if ((dev && (dev.tg == 1 || dev.htr == 1)) || profileEditor.flagOverride) {
            this.postProfile({ tg: "b", hr: 0, sp: 0 }, function (ok) { if (ok) me.sendControl(cmd, expect); });
        } else this.sendControl(cmd, expect);
    }
};

function saveprofile() {
    //console.log("save");
    var r = profileEditor.getProfile();
    if (r === false) {
        alert("<%= script_control_invalid_value_check_again %>");
        return;
    }
    var json = JSON.stringify(r);
    console.log("result=" + json);

    s_ajax({
        url: SCHEDULE_URL,
        m: "POST",
        mime: "application/x-www-form-urlencoded",
        data: "data=" + encodeURIComponent(json),
        success: function(d) {
            profileEditor.markdirty(false);
            var note = Q("#save-note");
            if (note) note.textContent = "<%= ctl_saved_dot %>";
            if (!profileEditor.quietSave) alert("<%= done %>");
            if (profileEditor.afterSave) { var fn = profileEditor.afterSave; profileEditor.afterSave = null; profileEditor.quietSave = false; fn(); }
        },
        fail: function(d) {
            var note = Q("#save-note");
            if (note) note.textContent = "<%= ctl_save_failed_dot %>";
            alert("<%= script_control_failed_to_save %>");
        }
    });
}

function updateTempUnit(u) {
    var Us = document.getElementsByClassName("t_unit");
    for (var i = 0; i < Us.length; i++) {
        Us[i].innerHTML = u;
    }
}

function rcvBeerProfile(p) {
    closeDlgLoading();
    window.lastProfile = p;
    if (p) { window.profileFlags = { tg: p.tg || "b", hr: p.hr ? 1 : 0, sp: p.sp ? 1 : 0 }; profileEditor.startPolicy = p.sp ? 1 : 0; }
    updateTempUnit(p.u); // using profile temp before we get from controller
    BrewPiSetting.tempUnit = p.u;
    profileEditor.initProfile(p);
    ControlChart.init("tc_chart", profileEditor.chartdata(), p.u);
    ControlChart.reveal();
}

function ccparameter(s) {
    var setting = {
        valid: true,
        minDegree: s.tempSetMin,
        maxDegree: s.tempSetMax,
        tempUnit: s.tempFormat
    };    
    if (setting.tempUnit != BrewPiSetting.tempUnit) {
        updateTempUnit(setting.tempUnit);
        profileEditor.setTempUnit(setting.tempUnit);
    }
    BrewPiSetting = setting;
    // The pulse-PI constants only arrive with the control-constants message, so
    // they are filled here rather than in the status handler.
    if (window.modekeeper && modekeeper.setNumField) {
        modekeeper.setNumField("ind-pi-kp", s.indKp);
        modekeeper.setNumField("ind-pi-ki", s.indKi);
        modekeeper.setNumField("ind-pi-pulse", s.indPulse);
    }
    s_ajax({
        url: SCHEDULE_URL,
        m: "GET",
        success: function(d) {
            rcvBeerProfile(JSON.parse(d));
        }
    });
}


function HC_init(){
    Q("#humidity-control").style.display="none";
}
function HC_show(config){
    Q("#humidity-control").style.display="";
    Q("#hc-mode").value = config.m;
    Q("#hc-target").value = config.t;
}

function HC_apply(){
    var target = Q("#hc-target").value;
    var mode =  Q("#hc-mode").value;

    s_ajax({
        url:"/rh",
        m: "POST",
        data: "m=" + mode +"&t=" + target,
        success: function(a) {
            alert("<%= done %>")
        },
        fail: function(a) {
            alert("<%= failed %>:" + a);
        }
    })

}
/* deprecated
function initctrl_C(next) {
//    modekeeper.init();
    Capper.init();
    modekeeper.init();
    openDlgLoading();
}
*/

function communicationError() {
    var div = Q('.error');
    if (div) {
        div.innerHTML = "<%= error_connect %>";
        div.style.display = "block";
    }
}


function placeEasyChart(intoDialog) {
    var chart = document.getElementById("tc_chart");
    var home = document.querySelector(".chartbox");
    var slot = document.getElementById("er-chart");
    if (!chart || !home || !slot) return;
    if (intoDialog) slot.appendChild(chart);
    else home.appendChild(chart);
    ControlChart.reveal();
}
function easySteps(base) {
    var to = Num.parse(document.getElementById("er-to").value);
    var days = Num.parse(document.getElementById("er-days").value);
    if (to === null || days === null) return null;
    var start = (document.querySelector("input[name=erstart]:checked") || {}).value || "now";
    var a = { c: start === "gravity" ? "g" : "t", d: 0, t: base };
    if (start === "gravity") {
        var sg = Num.parse(document.getElementById("er-sg").value);
        if (sg === null) return null;
        a.g = sg;
    }
    return { start: start, to: to, days: days, steps: [a, { c: "r", d: days }, { c: "t", d: 1, t: to }] };
}
function previewEasyRamp(base) {
    if (!(base === base)) return;
    var plan = easySteps(base);
    if (!plan) return;
    if (!profileEditor.row) profileEditor.initable([]);
    var when = plan.start === "date" && document.getElementById("er-date").value ? new Date(document.getElementById("er-date").value) : new Date();
    profileEditor.loadProfile({ s: Math.floor(when.getTime() / 1000), u: BrewPiSetting.tempUnit, t: plan.steps });
    ControlChart.reveal();
}
function openEasyRamp() {
    if (!BrewPiSetting.valid) { alert("<%= script_control_not_conected_to_controller %>"); return; }
    var fromEl = document.getElementById("independent-heat-t");
    var from = fromEl && fromEl.value !== "" ? Number(fromEl.value) : NaN;
    document.getElementById("er-from").textContent = isNaN(from) ? "--" : from.toFixed(1);
    document.getElementById("er-to").value = isNaN(from) ? "" : (from + 3).toFixed(1);
    document.getElementById("er-days").value = "3";
    document.getElementById("dlg_easy").style.display = "block";
    window.easyNeedsConfirm = profileEditor.dirty || document.querySelectorAll("#profile_t tbody tr").length > 1;
    placeEasyChart(true);
    wireEasyRamp(from);
}
function wireEasyRamp(from) {
    if (wireEasyRamp.done) { paintEasy(from); return; }
    wireEasyRamp.done = true;
    function paintEasy(base) {
        var to = Num.parse(document.getElementById("er-to").value);
        var days = Num.parse(document.getElementById("er-days").value);
        var start = (document.querySelector("input[name=erstart]:checked") || {}).value || "now";
        var sg = Num.parse(document.getElementById("er-sg").value);
        var err = "";
        // A comma in any of these fields leaves the value null, which surfaces as
        // the same message as any other invalid entry.
        if (to === null || to < BrewPiSetting.minDegree || to > BrewPiSetting.maxDegree) err = "Enter a target inside the allowed temperature range.";
        else if (!(days > 0)) err = "Enter a number of days greater than zero.";
        else if (start === "date" && !document.getElementById("er-date").value) err = "Choose a start date and time.";
        else if (start === "gravity" && (sg === null || sg < 0.9 || sg > 1.2)) err = "Enter a specific gravity from 0.900 to 1.200.";
        else if (!(base === base)) err = "The current heating setpoint is not available.";
        document.getElementById("er-err").textContent = err;
        document.getElementById("er-save").disabled = !!err;
        var per = (days > 0 && to !== null && base === base) ? ((to - base) / days) : 0;
        document.getElementById("er-sum").textContent = (base === base && to !== null && days > 0) ? (base.toFixed(1) + " → " + to.toFixed(1) + " °C over " + days + " days (" + (per >= 0 ? "+" : "") + per.toFixed(2) + " °C per day)") : "";
        var when = start === "now" ? "Starts when the settings are applied." : (start === "date" ? "Starts at the selected date. Until then the current setpoint is kept." : "Starts when gravity reaches the selected SG.");
        document.getElementById("er-sum2").textContent = when;
        if (!err) previewEasyRamp(base);
    }
    ["er-to", "er-days", "er-sg", "er-date"].forEach(function (id) {
        document.getElementById(id).addEventListener("input", function () { paintEasy(Number(document.getElementById("er-from").textContent)); });
    });
    var radios = document.querySelectorAll("input[name=erstart]");
    for (var i = 0; i < radios.length; i++) radios[i].onchange = function () { paintEasy(Number(document.getElementById("er-from").textContent)); };
    document.getElementById("er-pre1").onclick = function () {
        var base = Number(document.getElementById("er-from").textContent);
        document.getElementById("er-to").value = (base + 3).toFixed(1);
        document.getElementById("er-days").value = "3";
        document.getElementById("er-sg").value = "1.018";
        var gravity = document.querySelector('input[name=erstart][value="gravity"]');
        if (gravity) gravity.checked = true;
        paintEasy(base);
    };
    document.getElementById("er-pre2").onclick = function () {
        var reach = BrewPiSetting.tempUnit === "F" ? 64.4 : 18;
        document.getElementById("er-to").value = reach.toFixed(1);
        document.getElementById("er-days").value = "2";
        var now = document.querySelector('input[name=erstart][value="now"]');
        if (now) now.checked = true;
        paintEasy(Number(document.getElementById("er-from").textContent));
    };
    document.getElementById("er-cancel").onclick = function () {
        document.getElementById("dlg_easy").style.display = "none";
        placeEasyChart(false);
        if (window.lastProfile) profileEditor.loadProfile(window.lastProfile);
    };
    document.getElementById("er-save").onclick = function () { saveEasyRamp(); };
    paintEasy(from);
}
function saveEasyRamp() {
    var base = Number(document.getElementById("er-from").textContent);
    var start = (document.querySelector("input[name=erstart]:checked") || {}).value || "now";
    var proceed = function () {
        previewEasyRamp(base);
        var when = start === "date" ? new Date(document.getElementById("er-date").value) : new Date();
        profileEditor.startPolicy = start === "date" ? 1 : 0;
        profileEditor.flagOverride = { tg: "b", hr: 1, sp: profileEditor.startPolicy };
        profileEditor.loadProfile({ s: Math.floor(when.getTime() / 1000), u: BrewPiSetting.tempUnit, t: easySteps(base).steps });
        profileEditor.quietSave = true;
        profileEditor.afterSave = function () {
            profileEditor.flagOverride = null;
            window.lastProfile = profileEditor.getProfile();
            var heatEn = document.getElementById("beer-set");
            if (heatEn) { heatEn.checked = true; document.getElementById("independent-heat-t").disabled = false; }
            modekeeper.viewState.method = "ind";
            modekeeper.viewState.hsrc = "ramp";
            modekeeper.touched = true;
            modekeeper.seg("method", "ind");
            modekeeper.seg("hsrc", "ramp");
            if (!modekeeper.device || modekeeper.device.md !== "i") BWF.send("j{mode:i,beerSet:" + base + "}");
            if (modekeeper.device) { modekeeper.device.md = "i"; modekeeper.device.htr = 1; }
            placeEasyChart(false);
            modekeeper.paint();
            modekeeper.note("Easy ramp saved and started.");
            document.getElementById("dlg_easy").style.display = "none";
        };
        saveprofile();
    };
    if (window.easyNeedsConfirm) {
        var dlg = document.getElementById("dlg_replace");
        dlg.style.display = "block";
        document.getElementById("rep-cancel").onclick = function () { dlg.style.display = "none"; };
        document.getElementById("rep-ok").onclick = function () { dlg.style.display = "none"; proceed(); };
    } else proceed();
}

function initctrl() {
    getActiveNavItem();
    Capper.init();
    modekeeper.init();
    PTC.init(Q("#ptc-control"));
    openDlgLoading();

    BWF.init({
        onconnect: function() {
            BWF.send("c");
        },
        error: function(e) {
            //console.log("error");
            closeDlgLoading();
            communicationError();
        },
        handlers: {
            A: function(c) {
                if (typeof c["bt"] != "undefined" && c["bt"] > -10000) window.lastBeerTemp = c["bt"] / 100;
                if (typeof c["ver"] != "undefined") {
                    if (JSVERSION != c["ver"]) alert("<%= script_control_version_mismatched %>");
                    Q("#verinfo").innerHTML = "v" + c["ver"];
                }
                if (typeof c["cap"] != "undefined")
                    Capper.status(c["cap"]);
                if (typeof c["ptc"] != "undefined")
                    PTC.config(c.ptc);
                if (typeof c["rh"] != "undefined")
                    HC_show(c.rh);
                modekeeper.ingest(c);
            },
            C: function(c) { ccparameter(c); },
            S: function(s) { modekeeper.confirm(s); }
            //B: rcvBeerProfile
        }
    });
}
