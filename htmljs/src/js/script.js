    var T_CHART_REQUEST = 20000;
    var T_CHART_RETRYTO = 6000;
    var T_CHART_ZERODATA = 10000;
    var T_CHART_REFRESH = 1500;
    var T_CHART_RETRY = 10000;
    var T_LOAD_CHART = 150;
    var T_BWF_RECONNECT = 10000;
    var T_BWF_LCD = 10000;


    var BChart = {
        offset: 0,
        url: 'chart.php',
        // Correction the controller holds right now. The live chart has no
        // device-info block, so this is the only source it has for the
        // "Uncorrected" view; a recorded log brings its own in the header.
        liveCorrection: null,
        calibrating:function(){
            if(typeof this.chart =="undefined") return false;
            return this.chart.calibrating;
        },
        toggle: function(line) {
            this.chart.toggleLine(line);
        },
        updateFormula: function() {
            var coeff = this.chart.coefficients;
            var npt = (this.chart.npt << 24) | (this.chart.cal_igmask & 0xFFFFFF);
            var changed = true;
            if (typeof window.npt != "undefined" && window.npt == npt) {
                changed = false;
            }
            if (!changed) return;
            var url = "coeff?" + "a0=" + coeff[0].toFixed(9) +
                "&a1=" + coeff[1].toFixed(9) + "&a2=" + coeff[2].toFixed(9) +
                "&a3=" + coeff[3].toFixed(9) + "&pt=" + npt;
            s_ajax({
                url: url,
                m: "GET",
                success: function(d) { window.npt = npt; },
                fail: function(d) {
                    alert("<%= script_fail_update_formula %>" + d);
                }
            });
        },
        reprocesData: function() {
            // recalcualte data
            // re process data to get correct calibration points
            var t = this;
            for (var i = 0; i < t.bdata.length; i++)
                t.chart.process(t.bdata[i]);
        },
        updateChartResult: function() {
            var t = this;
            if (t.chart.sg && !isNaN(t.chart.sg)) {
                updateGravity(t.chart.sg);
                gravityChangeUpdate(t.chart.filterSg);
                t.chart.sg = NaN;
                //checkfgstate();
            }
            t.chart.updateChart();
            updateGravityViewBar();
        },
        setIgnoredMask: function(m) {
            var t = this;
            if (t.chart.cal_igmask == m) return;

            t.chart.calculateSG = false;
            t.reprocesData();
            // the data will be updated by the "data"
            t.chart.cal_igmask = m;
            t.chart.getFormula();

            t.reprocesData();

            t.updateChartResult();
            // the data will be updated by the "data",again
            t.chart.cal_igmask = m;
            t.updateFormula();
        },
        reqdata: function() {
            var t = this;
            var PD = 'offset=' + t.offset;

            if (typeof t.startOff != "undefined" && t.startOff !== null)
                PD = PD + "&index=" + t.startOff;
            var xhr = new XMLHttpRequest();
            xhr.open('GET', t.url + '?' + PD);
            //	xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
            //	xhr.setRequestHeader("Content-length", PD.length);
            xhr.timeout = T_CHART_REQUEST;
            xhr.responseType = 'arraybuffer';
            xhr.onload = function(e) {
                if (this.status == 404) {
                    console.log(" Error getting log data");
                    return;
                }
                // response is unsigned 8 bit integer
                var data = new Uint8Array(this.response);
                // backup data 
                if (t.offset) t.bdata.push(data);
                else t.bdata = [data];

                if (data.length == 0) {
                    //console.log("zero content");
                    if (t.timer) clearInterval(t.timer);
                    t.timer = null;
                    setTimeout(function() {
                        t.reqdata();
                    }, T_CHART_ZERODATA);
                    return;
                }
                var res = t.chart.process(data);
                if (res.nc) {
                    t.offset = data.length;
                    t.startOff = xhr.getResponseHeader("LogOffset");
                    //t.getLogName();
                    //console.log("new chart, offset="+t.startOff);
                    if (t.chart.calibrating) {
                        t.chart.getFormula();
                        //  do it again
                        t.chart.process(data);
                        if (t.chart.calculateSG) {
                            Q("#formula-btn").style.display = "block";
                            // update formula
                            t.updateFormula();
                        }
                    }
                } else {
                    t.offset += data.length;
                    if (t.chart.calibrating && res.sg) {
                        // new calibration data available. 
                        //force to reload and re-process the data
                        console.log("New SG availbe. reprocess");
                        t.chart.calculateSG = false;
                        t.reprocesData();
                        // the data will be updated by the "data"
                        t.chart.getFormula(); // derive the formula
                        // this time, the gravity is calculated.
                        t.reprocesData();
                        t.updateChartResult();
                        t.updateFormula();
                        return;
                    }
                }

                t.chart.updateChart();
                updateGravityViewBar();

                if (!isNaN(t.chart.og)) {
                    updateOriginGravity(t.chart.og);
                    t.chart.og = NaN;
                }
                if (t.chart.sg && !isNaN(t.chart.sg)) {
                    updateGravity(t.chart.sg);
                    gravityChangeUpdate(t.chart.filterSg);
                    t.chart.sg = NaN;
                    //checkfgstate();
                }
                if (t.timer == null) t.settimer();
            };
            xhr.ontimeout = function(e) {
                console.error("Timeout!" + (new Date()));
                if (t.timer == null) setTimeout(function() {
                    t.reqdata();
                }, T_CHART_RETRYTO);
            };
            xhr.onerror = function() {
                console.log("Error getting data");
                if (t.timer == null) setTimeout(function() {
                    t.reqdata();
                }, T_CHART_RETRY);
            };
            //console.log(PD);
            xhr.send();
        },
        settimer: function() {
            var t = this;
            //console.log("start timer at "+ t.chart.interval);
            t.timer = setInterval(function() {
                t.reqdata();
            }, t.chart.interval * 1000);
        },
        init: function(id, y1, y2,id2,pl,carbonation,id3,rhLabel) {
            this.chart = new BrewChart(id);
            this.chart.setLabels(y1, y2);
            if(typeof id2 != "undefined") this.chart.setPChart(id2,pl,carbonation)
            if(typeof id3 != "undefined") this.chart.setHChart(id3,rhLabel);
        },
    timer: null,
        start: function() {
            if (this.running) return;
            this.running = true;
            this.offset = 0;
            this.reqdata();
        },
        reqnow: function() {
                var t = this;
                if (t.timer) clearInterval(t.timer);
                t.timer = null;
                t.reqdata();
            }
            /*
            , 
            getLogName: function() {
                s_ajax({
                    url: "loglist.php",
                    m: "GET",
                    success: function(d) {
                        var r = JSON.parse(d);
                        if (r.rec) {
                            Q("#recording").innerHTML = r.log;
                        } else {
                            Q("#recording").innerHTML = "";
                        }
                    },
                    fail: function(d) {
                        console.log("get logname fail");
                    }
                });
            }*/
    };
    /* LCD information */

    var StateText = [
        "<%= state_text_idle %>",
        "<%= state_text_off %>",
        "<%= state_text_door_Open %>",
        "<%= state_text_heating %>",
        "<%= state_text_cooling %>",
        "<%= state_text_wait_to_cool %>",
        "<%= state_text_wait_to_heat %>",
        "<%= state_text_wait_for_peak %>",
        "<%= state_text_cooling_min_time %>",
        "<%= state_text_heating_min_time %>",
        "<%= state_text_invalid %>"
    ];

    function genStateText(state, duration, both) {
        // "both" is only ever true in independent mode when the heater and cooler
        // are simultaneously active; state itself stays a single COOLING/HEATING
        // value (see TempControl::updateIndependentState()) so build the combined
        // text here instead of adding a new state number (would break log format).
        if (!both && (state == 1 || state == 2 || state == 10 || state == 7)) return StateText[state];

        var timestr = "";
        var mm = Math.floor(duration / 60);
        var hh = Math.floor(mm / 60);
        var ss = duration % 60;
        mm = mm - hh * 60;

        function zeropad(n){
            return n>9? ""+n:"0"+n;
        }

        if (hh > 0) {
            timestr = "<%= time_format_long %>".replace("{SS}", zeropad(ss)).replace("{MM}", zeropad(mm)).replace("{HH}", zeropad(hh));
        } else{
            // short
            timestr = "<%= time_format_short %>".replace("{SS}", zeropad(ss)).replace("{MM}", zeropad(mm));
        }
        if (state == 11 || (both && (state == 3 || state == 4))) {
            return "Heating+Cooling for " + timestr;
        }
        return StateText[state].replace("{time}", timestr);
    }


    function renderLcdText(info) {
        var div = Q(".error");
        if (div) div.style.display = "none";

        function T(temp) {
            if (temp < -10000) return "--.--";
            return (temp / 100).toFixed(2) + "&deg;" + info.tu;
        }
        var status = {};
        status.ControlStateSince = info.sl;
        status.ControlState = info.st;
        status.ControlMode = info.md;
        status.unit = info.tu;
        status.BeerTemp = T(info.bt);
        status.BeerSet = T(info.bs);
        status.FridgeTemp = T(info.ft);
        status.FridgeSet = T(info.fs);
        status.RoomTemp = T(info.rt);

        var ModeString = {
            o: "<%= mode_off %>",
            b: "<%= mode_beer_const %>",
            f: "<%= mode_fridge_const %>",
            p: "<%= mode_beer_profile %>",
            i: "Independent"
        };
        var bothActive = (info.md == 'i' && info.ih == 1 && info.ic == 1);

        function writeLive(div, html) {
            if (!div) return;
            div.setAttribute("data-live", html);
            if (!window.__chartHover) div.innerHTML = html;
        }

        Object.keys(status).map(function(key, i) {
            var div = Q("#lcd" + key);
            if (div) {
                // An unknown or missing mode character must not print
                // "undefined"; show a dash until the next status message.
                if (key == "ControlMode") writeLive(div, ModeString[status[key]] || "--");
                else if (key == "ControlState") {
                    var stateHtml = genStateText(status[key], status.ControlStateSince, bothActive);
                    writeLive(div, stateHtml);
                    var tone = "idle";
                    var st = status[key];
                    if (st == 11 || (bothActive && (st == 3 || st == 4))) tone = "both";
                    else if (st == 3 || st == 6 || st == 9) tone = "heat";
                    else if (st == 4 || st == 5 || st == 8) tone = "cool";
                    div.setAttribute("data-tone", tone);
                }
                else writeLive(div, status[key]);
            }
        });
        // keep the info for other usage
        if (typeof status["unit"] != "undefined") window.tempUnit = status.unit;
        if (typeof status["BeerTemp"] != "undefined")  window.beerTemp = (info.bt> -100)? (info.bt/ 100):NaN;

        // Independent mode targets are cs.fridgeSetting/cs.beerSetting under the hood
        // (see TempControl::updateIndependentState()), so pre-fill the control page's
        // independent tab with the currently configured values. Only fill while the
        // box is still empty so an in-progress edit is never overwritten by a status
        // push (control page only - these elements don't exist elsewhere).
        if (info.md == 'i') {
            var coolBox = Q("#independent-cool-t");
            if (coolBox && coolBox.value === '' && info.fs > -10000) coolBox.value = (Math.round(info.fs) / 100).toFixed(2);
            var heatBox = Q("#independent-heat-t");
            if (heatBox && heatBox.value === '' && info.bs > -10000) heatBox.value = (Math.round(info.bs) / 100).toFixed(2);
        }
        if (!window.__chartHover && window.BChart && BChart.chart && BChart.chart.paintRestingSeries) {
            BChart.chart.paintRestingSeries();
            var timeEl = Q(".beer-chart-legend-time");
            var stateEl = Q(".beer-chart-state");
            var lastTime = BChart.chart.lastSampleTime ? BChart.chart.lastSampleTime() : "";
            if (timeEl && lastTime) timeEl.innerHTML = lastTime;
            var stateLive = Q("#lcdControlState");
            if (stateEl && stateLive) stateEl.innerHTML = stateLive.getAttribute("data-live") || stateEl.innerHTML;
        }
    }

    var roomOfridge = false;

    function simLcd(info) {

        var ModeString = {
            o: "Off",
            b: "Beer Const.",
            f: "Fridge Const.",
            p: "Beer Profile",
            i: "Independent"
        };

        function showTemp(tp) {
            // always takes 5 chars
            if (tp < -10000) return "--.--";
            var text = (tp / 100.0).toFixed(2);
            var spaces = "";
            var i = text.length;
            for (; i < 5; i++) spaces += " ";
            return spaces + text;
        }

        var lines = [];
        lines[0] = "Mode   " + ModeString[info.md];
        lines[1] = "Beer  " + showTemp(info.bt) + " " + showTemp(info.bs) + " &deg;" + info.tu;
        if (info.rt > -10000 && roomOfridge)
            lines[2] = "Room  " + showTemp(info.rt) + " " + showTemp(-20000) + " &deg;" + info.tu;
        else
            lines[2] = "Fridge" + showTemp(info.ft) + " " + showTemp(info.fs) + " &deg;" + info.tu;
        roomOfridge = !roomOfridge;
        lines[3] = genStateText(info.st, info.sl, info.md == 'i' && info.ih == 1 && info.ic == 1);
        return lines;
    }

    function displayLcdText(lines) {
        for (var i = 0; i < 4; i++) {
            var d = document.getElementById("lcd-line-" + i);
            if (d) d.innerHTML = lines[i];
        }
    }

    function displayLcd(info) {
        // classic interface
        window.tempUnit = info.tu;
        displayLcdText(simLcd(info));
        // new interface
        renderLcdText(info);
    }

    function hideErrorMsgs() {
        var msgs = document.querySelectorAll(".errormsg");
        for (var i = 0; i < msgs.length; i++)
            msgs[i].style.display = "none";
    }

    function communicationError() {
        var div = Q('.error');
        if (div) {
            hideErrorMsgs();
            Q('#error_connect').style.display = "block";
            div.style.display = "block";
        } else displayLcdText(["Failed to", "connect to", "Server", ""]);
    }

    function controllerError() {
        var div = Q('.error');
        if (div) {
            hideErrorMsgs();
            Q('#error_noupdate').style.display = "block";
            div.style.display = "block";
        } else displayLcdText(["Controller not", "updating data", "...", ""]);
    }

    function checkTime(time, tzoff) {
        var d = new Date();
        var tmoff = 0 - d.getTimezoneOffset() * 60;
        var tm = Math.round(d.getTime() / 1000);
        if (tzoff != tmoff || Math.abs(tm - time) > 1800) {
            // update time & timezone
            s_ajax({
                url: "time",
                m: "POST",
                mime: "application/x-www-form-urlencoded",
                data: "time=" + tm + "&off=" + tmoff,
                success: function() {}
            });

        }
    }

    function GDSetting(msg) {
        function gdevice(){
            Q(".gravity-device-pane").style.display="";
            doAll(".gd-option",function(d){
                d.classList.add("no-display");
            });
        }

        if(typeof msg["dev"] != "undefined"){
            window.GravityDevice=msg.dev;
            if(msg.dev ==1){ //ispindel
                gdevice();
                doAll(".ispindel-info",function(d){
                    d.classList.remove("no-display");
                });

            }else if(msg.dev ==2){
                gdevice();
                doAll(".tilt-info",function(d){
                    d.classList.remove("no-display");
                });
            }else if(msg.dev ==3){ //pill
                gdevice();
                doAll(".pill-info",function(d){
                    d.classList.remove("no-display");
                });
            }else{
                Q(".gravity-device-pane").style.display="none";
                return;
            }
        }
        //if (typeof msg["name"] == "undefined") return;
        if (typeof msg["plato"] != "undefined") {
            window.plato = msg.plato;
            if (window.plato) showPlatoUnit();
        }
        if (typeof msg["fpt"] != "undefined") {
            window.npt = msg["fpt"];
        }

        // before iSpindel report to BPL, the name file is "unknown"
        if (typeof msg["name"] == "undefined") return
            //The first report will be "unknown" if (msg.name.startsWith("iSpindel")) {
            // iSpindel
        
        if (typeof msg["lu"] == "undefined") {
            console.log("iSpindel:" + JSON.stringify(msg));
            return;
        } 
        var ndiv = Q("#iSpindel-name");
        if (ndiv) ndiv.innerHTML = msg.name;

    
        if (typeof msg["lpf"] != "undefined")
            GravityFilter.setBeta(msg["lpf"]);

    }



    function respPtDiff(sg,duration){
        var preG =BChart.chart.getGravityOfTime((new Date().getTime())/1000 - duration);

        if(isNaN(preG)) return "--";

        var value=preG - sg;
        if(window.plato) return value.toFixed(1);

        value = value * 1000;
         return value.toFixed(1);
    }

    function gravityChangeUpdate(fsg){
        Q("#sgchanged").innerHTML = respPtDiff(fsg,48*3600) + "/" + respPtDiff(fsg,24*3600)+ "/" + respPtDiff(fsg,12*3600);
    }

    function updateGravity(sg) {
        //if(typeof window.sg != "undefined") return;
        window.sg = sg;
        Q("#gravity-sg").innerHTML = window.plato ? sg.toFixed(1) : sg.toFixed(3);
        if (typeof window.og != "undefined") {
            Q("#gravity-att").innerHTML = window.plato ? BrewMath.attP(window.og, sg) : BrewMath.att(window.og, sg);
            Q("#gravity-abv").innerHTML = window.plato ? BrewMath.abvP(window.og, sg) : BrewMath.abv(window.og, sg);
        }
    }

    // Corrected vs uncorrected gravity on the dashboard chart.
    //
    // The logged (or streamed) gravity already contains the correction the
    // controller applied. The chart can therefore show the device value by
    // subtracting that correction again, without touching the log or asking the
    // controller for anything new. A recorded log says what it applied in its
    // header; a live chart uses the settings the controller holds now.
    function loadGravityCorrection() {
        s_ajax({
            url: "/gdc?data",
            m: "GET",
            success: function (a) {
                var cfg;
                try { cfg = JSON.parse(a); } catch (e) { return; }
                if (!cfg) return;
                var off = Number(cfg.off) || 0;
                var eq = [off, 0, 0, 0];   // the offset alone is always applied
                if (cfg.tc && Number(cfg.ttceunit) === 1 && cfg.ttce && cfg.ttce.length >= 4) {
                    eq = [off + Number(cfg.ttce[0]), Number(cfg.ttce[1]),
                          Number(cfg.ttce[2]), Number(cfg.ttce[3])];
                }
                BChart.liveCorrection = eq;
                updateGravityViewBar();
            }
        });
    }

    function gravityCorrectionReady() {
        return typeof BChart.chart != "undefined" && !!BChart.chart.hasCorrection
            && BChart.chart.hasCorrection();
    }

    function updateGravityViewBar() {
        var bar = Q("#gravity-view-bar");
        if (!bar) return;
        var show = gravityCorrectionReady();
        bar.classList.toggle("no-display", !show);
        if (!show && BChart.chart && BChart.chart.showUncorrected) {
            BChart.chart.setGravityView(false);
        }
        var raw = !!(BChart.chart && BChart.chart.showUncorrected);
        var noteTextRaw = "<%= gravity_view_note_uncorrected %>";
        var noteTextFixed = "<%= gravity_view_note_corrected %>";
        var note = Q("#gravity-view-note");
        if (note) {
            note.innerHTML = raw ? noteTextRaw : noteTextFixed;
            note.className = "gv-note" + (raw ? " is-raw" : "");
        }
        var radios = document.querySelectorAll('input[name="gravity_view"]');
        for (var i = 0; i < radios.length; i++) {
            radios[i].checked = (radios[i].value === (raw ? "uncorrected" : "corrected"));
        }
        bar.title = raw ? noteTextRaw : noteTextFixed;
    }

    function setGravityView(mode) {
        if (typeof BChart.chart == "undefined" || !BChart.chart.setGravityView) return;
        BChart.chart.setGravityView(mode === "uncorrected");
        updateGravityViewBar();
    }

    function updateOriginGravity(og) {
        if (typeof window.og != "undefined" && window.og == og) return;
        window.og = og;
        Q("#gravity-og").innerHTML = window.plato ? og.toFixed(1) : og.toFixed(3);
        if (typeof window.sg != "undefined")
            updateGravity(window.sg);
    }

    function showgravitydlg(msg) {
        Q('#dlg_addgravity .og').style.display = "none";
        Q('#dlg_addgravity .sg').style.display = "none";
        Q('#dlg_addgravity .' + msg).style.display = "block";
        Q('#dlg_addgravity').style.display = "block";

        var beertemp = parseFloat(Q("#gravity-device-temp").textContent);
        if(isNaN(beertemp)){
            beertemp = parseFloat(Q("#lcdBeerTemp").textContent);
        }
        if(!isNaN(beertemp)){
            Q("#sginput-ispindel-temp").innerHTML = beertemp.toFixed(2);
        }
        // show tilt
        if(window.isog) Q("#tilt-angle").value="--";
        else Q("#tilt-angle").value=(window.GravityDevice==2)? Q("#tilt-raw").textContent:Q("#gdevice-angle").textContent;
        // update temp.
        if (typeof window["tempUnit"] != "undefined") {
            window.celsius = false;
            var defaultTemp = 68;
            var re = /C$/;
            if (re.test(window.tempUnit)) {
                window.celsius = true;
                defaultTemp = 20;
            }

            var tus = document.querySelectorAll("#dlg_addgravity .temp-unit");
            for (var i = 0; i < tus.length; i++)
                tus[i].innerHTML = window.tempUnit;
        } else window.celsius = true;
    }

    function dismissgravity() {
        Q('#dlg_addgravity').style.display = "none";
    }

    function inputsg_change() {
        if(window.isog) return;
        var gravity = Num.parse(Q("#dlg_addgravity .sginput").value);
        if (gravity === null) return;
        // if iSpindel info is available, or beer temp is available.
        var currentBeerTemp=parseFloat(Q("#sginput-ispindel-temp").innerHTML);
        if(!isNaN(currentBeerTemp)){            
            var temp =  window.celsius ? 20 : 68;
            if (window.plato) {
                var sgc = BrewMath.pTempCorrection(window.celsius, gravity, temp, currentBeerTemp);
                Q("#sginput-sg-ispindel").innerHTML = sgc.toFixed(2);
            } else {
                var sgc = BrewMath.tempCorrection(window.celsius, gravity, temp, currentBeerTemp);
                Q("#sginput-sg-ispindel").innerHTML = sgc.toFixed(3);
            }
        }

    }

    function inputgravity() {
        // A comma is refused: Num.parse returns null, and null never passes the
        // range check below, so the user sees "invalid input" instead of a value
        // quietly truncated to its integer part.
        var typed = Num.parse(Q("#dlg_addgravity .sginput").value);
        // Dashboard OG only: a hydrometer reading typed without a dot (1050)
        // is specific gravity times 1000. SG entry is left unchanged.
        if (window.isog && !window.plato && typed !== null && typed >= 800 && typed <= 1250 && typed === Math.round(typed)) {
            typed = typed / 1000;
        }
        var gravity = typed;
        if (!window.isog) {
            var computed = parseFloat(Q("#sginput-sg-ispindel").innerHTML);
            if (isFinite(computed)) gravity = computed;
        }

        if (gravity === null || gravity !== gravity ||
            (!window.plato && (gravity < 0.8 || gravity > 1.25))) {
            alert("<%= ui_invalid_input %>");
            return;
        } 

        dismissgravity();
        openDlgLoading();

        if (window.isog) updateOriginGravity(gravity);
        else {
            // user input
            updateGravity(gravity);
            gravityChangeUpdate(gravity);
        }
        var data = {
            name: "webjs",
            gravity: gravity
        };
        var raw=Num.parse(Q("#tilt-angle").value);
        if(raw !== null){
            data.raw = raw;
        }
        if (window.isog) data.og = 1;
        if (window.plato) data.plato = 1;
        s_ajax({
            url: "gravity",
            m: "POST",
            mime: "application/json",
            data: JSON.stringify(data),
            success: function(d) {
                closeDlgLoading();
                setTimeout(function() {
                    // request to 
                    if (BChart.chart.calibrating) BChart.reqnow();
                }, T_CHART_REFRESH);
            },
            fail: function(d) {
                alert("<%= ui_failed_label %>" + d);
                closeDlgLoading();
            }
        });

    }

    function inputSG() {
        window.isog = false;
        showgravitydlg("sg");
    }

    function inputOG() {
        window.isog = true;
        showgravitydlg("og");
    }

    function wifibar(did,x,ble){
        var strength =(typeof ble =="undefined")? [-1000, -90, -80, -70, -67]:[-1000,-100,-80,-55];
        var bar = 4;
        for (; bar >= 0; bar--) {
            if (strength[bar] < x) break;
        }
        var bars = Q(did).getElementsByClassName("rssi-bar");
        for (var i = 0; i < bars.length; i++) {
            bars[i].style.backgroundColor = (i < bar) ? window.rssiBarColor : "rgba(255,255,255,0.05)";
        }
        Q(did).title = (x > 0) ? "?" : ""+x;

    }

    function displayrssi(x) {
        Q("#rssi").title = (x > 0) ? "?" : Math.min(Math.max(2 * (x + 100), 0), 100);
        wifibar("#rssi",x);
        if (Q("#wifisignal"))
            Q("#wifisignal").innerHTML = (x > 0) ? "?" : Math.min(Math.max(2 * (x + 100), 0), 100);
    }

    function initRssi() {
        var rssi = Q("#rssi");
        window.rssiBarColor = window.getComputedStyle(Q('.rssi-bar1')).getPropertyValue('background-color');
        if (Q("#wifisignal")) {
            rssi.onmouseover = function() {
                Q("#wifisignal").style.display = "block";
            };
            rssi.onmouseout = function() {
                Q("#wifisignal").style.display = "none";
            };
        }
    }

    function ptcshow(msg) {
        if (typeof msg["ptc"] == "undefined" || typeof msg["pt"] == "undefined") return;
        var mode = msg.ptc;
        var time = msg.pt;

        function fortime(t) {
            var hour = Math.floor(t / 3600);
            var min = Math.floor((t - hour * 3600) / 60);
            var sec = t - hour * 3600 - min * 60;
            return ((hour) ? (hour + "H") : "") + ((hour + min) ? (min + "M") : "") + sec + "S";
        }
        var pane = Q("#ptc-pane");
        if (pane) {
            if (mode == "o") pane.style.display = "none";
            else {
                pane.style.display = "block";
            }
        } else return;
        var state = Q("#ptc-state");
        if (state) state.style.backgroundColor = (mode == "c") ? "lightgreen" : "gray";

        var textstateidle = Q("#ptc-state-idle");
        if (textstateidle) {
            var textstaterun = Q("#ptc-state-run");
            if (mode == "c") {
                textstateidle.style.display = "none";
                textstaterun.style.display = "block";
            } else {
                textstateidle.style.display = "block";
                textstaterun.style.display = "none";
            }
        }

        var tinfo = Q("#ptc-time");
        if (tinfo) tinfo.innerHTML = fortime(time);
        if (typeof msg["ptctp"] != "undefined") {
            var temp = Q("#ptc-temp");

            if (temp) temp.innerHTML = (msg.ptctp < -100) ? "NA" : ((msg.ptctp / 100).toFixed(2) + "&deg;C");
        }
        if (typeof msg["ptclo"] != "undefined" && typeof msg["ptcup"] != "undefined") {
            var ts = Q("#ptc-set");
            if (ts) ts.innerHTML = (msg.ptclo / 100).toFixed(2) + " ~ " + (msg.ptcup / 100).toFixed(2) + "&deg;C";
        }
    }

    function showPlatoUnit() {
        var units = document.querySelectorAll(".platounit");
        for (var i = 0; i < units.length; i++) {
            units[i].style.display = "inline-block";
        }
    }
    
    function gDeviceInfo(info){

        // original gravity, saved on the device; sent as SG like "g"
        if (typeof info.og != "undefined" && info.og > 0)
            updateOriginGravity(window.plato? BrewMath.sg2pla(info.og/1000.0) : info.og/1000.0);

        // last update
        if(info.u> 84879460){
            var lu = new Date(info.u * 1000);
            if (Q("#gravity-device-last")) Q("#gravity-device-last").innerHTML = lu.shortLocalizedString();
        }
        // gravity 
        updateGravity(window.plato? BrewMath.sg2pla(info.g/1000.0):info.g/1000.0);

        // temperature
        if(info.t > -20000){
            Q("#gravity-device-temp").innerHTML= (info.t/100).toFixed(2) + "&deg;" + window.tempUnit;
            window.gdtemp = info.t/100;
        }
        // rssi, 
        if(Q("#gravity-device-rssi")){
            if(window.GravityDevice ==1) wifibar("#gravity-device-rssi",info.r);
            else wifibar("#gravity-device-rssi",info.r,true);
        }
        // angle
        if(window.GravityDevice == 2){
            if (Q("#tilt-raw")) Q("#tilt-raw").innerHTML =""  + info.a.toFixed(3);
        }
        else if (Q("#gdevice-angle")) Q("#gdevice-angle").innerHTML = ""  + info.a.toFixed(2) +"&deg;";
        //battery
        if (Q("#gdevice-battery")) {
            var battTxt;
            if (window.GravityDevice == 1) {
                var volts = parseFloat(info.b).toFixed(2) + "V";
                if (typeof info.bp != "undefined" && info.bp >= 0) {
                    battTxt = "<span class=\"tile-num\">" + parseInt(info.bp) + "%</span><span class=\"tile-unit\">" + volts + "</span>";
                } else {
                    battTxt = volts;
                }
            } else {
                battTxt = "" + parseInt(info.b) + "%";
            }
            Q("#gdevice-battery").innerHTML = battTxt;
        }

    }

    function controllerMsg(c) {
        BWF.gotMsg = true;

        if (typeof c.scale != "undefined") {
            updateKegStatus(typeof c.scale == "string" ? JSON.parse(c.scale) : c.scale);
        }

        if (typeof c["rssi"] != "undefined") {
            displayrssi(c["rssi"]);
        }
        if (typeof c["sl"] != "undefined") {
            displayLcd(c);
        }
        if (typeof c["reload"] != "undefined") {
            console.log("Forced reload chart");
            BChart.reqnow();
            if (!Q("#recording").innerHTML || Q("#recording").innerHTML != c.log)
                window.npt = 0; // delete formula to force update to BPL.                
        }
        if (typeof c["ver"] != "undefined") {
            if (JSVERSION != c["ver"]) alert("<%= script_control_version_mismatched %>");
            Q("#verinfo").innerHTML = "v" + c["ver"];
        }
        if (typeof c["tm"] != "undefined" && typeof c["off"] != "undefined") {
            checkTime(c.tm, c.off);
        }
        if (typeof c["log"] != "undefined") {
            Q("#recording").innerHTML = c.log;
        }
        if (typeof c["cap"] != "undefined")
            Capper.status(c["cap"]);
        if (typeof c["plato"] != "undefined") {
            window.plato = c["plato"];
            if (window.plato) showPlatoUnit();
        }

        if (typeof c["pm"] != "undefined" && typeof c["psi"] != "undefined") {
            if (c.pm != 0) {
                Q("#pressure-info-pane").style.display = "block";
                Q("#pressure-psi").innerHTML = c.psi;
            }
        }
        if(typeof c["G"] != "undefined") gDeviceInfo(c.G);

        ptcshow(c);
        // Humidity shares the status card. A reading above 100 is not a real value.
        var humidPane = Q("#humidity-pan");
        function humidOn(v) { return typeof v != "undefined" && v <= 100; }
        var show_h = humidOn(c.h) || humidOn(c.hr);
        if (!show_h) {
            if (humidPane) humidPane.classList.add("no-display");
            ["hc-state-info", "humidity-info", "humidity-set-info", "room-humidity-info"].forEach(function (id) {
                var line = Q("#" + id);
                if (line) line.classList.add("no-display");
            });
        } else {
            if (humidOn(c.h)) {
                Q("#humidity-info").classList.remove("no-display");
                Q("#humidity").innerHTML = c.h + "%";
            } else if (Q("#humidity-info")) {
                Q("#humidity-info").classList.add("no-display");
            }
            if (humidOn(c.hr)) {
                Q("#room-humidity-info").classList.remove("no-display");
                Q("#room-humidity").innerHTML = c.hr + "%";
            } else if (Q("#room-humidity-info")) {
                Q("#room-humidity-info").classList.add("no-display");
            }
            if (typeof c["ht"] != "undefined") {
                Q("#humidity-set-info").classList.remove("no-display");
                Q("#humidity-set").innerHTML = (c.ht <= 100) ? (c.ht + "%") : "--";
            } else if (Q("#humidity-set-info")) {
                Q("#humidity-set-info").classList.add("no-display");
            }
            if (typeof c["hs"] != "undefined") {
                var hstate = ["Idle", "Dehumidifying", "Humidifying", "Wait to Dehumidify", "Wait to Humidify", "Humidify min Time", "Dehumidify min Time"];
                Q("#hc-state-info").classList.remove("no-display");
                Q("#hc-state").innerHTML = hstate[c.hs];
            } else if (Q("#hc-state-info")) {
                Q("#hc-state-info").classList.add("no-display");
            }
            if (humidPane) humidPane.classList.remove("no-display");
        }

    }

    function noteKeyFor(scale, index) {
        return scale ? String(scale.id) : ("slot" + index);
    }

    var noteSaved = { dash: "", keg: {} };
    var ROOM_LABEL_MAX = 24;
    var roomLabelSaved = "";

    // The room sensor card shows a label the user may rename. The default comes
    // from the page (the locale string), so nothing here is language specific.
    function roomDefaultText() {
        var el = Q("#room-name");
        return el ? (el.getAttribute("data-default") || "") : "";
    }

    function applyRoomLabel(text) {
        var el = Q("#room-name");
        if (el) el.textContent = text || roomDefaultText();
    }

    function saveRoomLabel(text) {
        s_ajax({
            url: "/notes",
            m: "POST",
            data: "data=" + encodeURIComponent(JSON.stringify({ room: text })),
            success: function() { roomLabelSaved = text; },
            fail: function() { applyRoomLabel(roomLabelSaved); }
        });
    }

    // A double click on the room label edits it in place. A single click still
    // toggles the chart line, so the card keeps working the way it always has.
    function bindRoomLabel() {
        var el = Q("#room-name");
        if (!el || el.getAttribute("data-bound") === "1") return;
        el.setAttribute("data-bound", "1");
        el.setAttribute("data-default", (el.textContent || "").trim());
        el.addEventListener("click", function(e) {
            if (el.isContentEditable) e.preventDefault();
        });
        el.addEventListener("dblclick", function(e) {
            e.preventDefault();
            e.stopPropagation();
            el.setAttribute("data-before", el.textContent);
            el.contentEditable = "true";
            el.focus();
            var range = document.createRange();
            range.selectNodeContents(el);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
        el.addEventListener("keydown", function(e) {
            if (e.key === "Enter") {
                e.preventDefault();
                el.blur();
            } else if (e.key === "Escape") {
                e.preventDefault();
                el.textContent = el.getAttribute("data-before") || "";
                el.blur();
            }
        });
        el.addEventListener("blur", function() {
            if (!el.isContentEditable) return;
            el.contentEditable = "false";
            var text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, ROOM_LABEL_MAX);
            applyRoomLabel(text);
            if (text === (roomLabelSaved || roomDefaultText())) return;   // nothing changed, no flash write
            saveRoomLabel(text);
        });
    }

    function noteRoot(area) {
        var node = area;
        while (node && node !== document.body) {
            if (node.classList && (node.classList.contains("keg-note") || node.classList.contains("dash-note-card"))) return node;
            node = node.parentNode;
        }
        return null;
    }

    function setNoteResult(area, text, ok) {
        var root = noteRoot(area);
        var el = root ? root.querySelector(".note-result") : null;
        if (!el) return;
        el.textContent = text || "";
        el.classList.toggle("is-ok", !!text && !!ok);
        el.classList.toggle("is-bad", !!text && !ok);
    }

    function syncNoteButton(area) {
        var root = noteRoot(area);
        var button = root ? root.querySelector(".note-save") : null;
        if (button) button.disabled = area.value === (area.getAttribute("data-saved") || "");
    }

    function saveNoteField(body, area, button, done) {
        var sent = area.value;
        button.disabled = true;
        setNoteResult(area, "");
        s_ajax({
            url: "/notes",
            m: "POST",
            data: "data=" + encodeURIComponent(JSON.stringify(body)),
            success: function() {
                if (area.value === sent) {
                    area.setAttribute("data-saved", sent);
                    if (done) done(sent);
                    setNoteResult(area, "Saved", true);
                }
                syncNoteButton(area);
            },
            fail: function() {
                syncNoteButton(area);
                setNoteResult(area, "Failed", false);
            }
        });
    }

    function loadNotes() {
        s_ajax({
            url: "/notes",
            m: "GET",
            success: function(raw) {
                var data = {};
                try { data = JSON.parse(raw) || {}; } catch (e) { data = {}; }
                noteSaved.dash = data.dash || "";
                noteSaved.keg = data.keg || {};
                roomLabelSaved = data.room || "";
                applyRoomLabel(roomLabelSaved);
                var dash = Q("#dash-note");
                if (dash && dash.value === (dash.getAttribute("data-saved") || "")) {
                    dash.value = noteSaved.dash;
                    dash.setAttribute("data-saved", noteSaved.dash);
                    syncNoteButton(dash);
                }
                var areas = document.querySelectorAll("textarea.keg-note-text");
                for (var i = 0; i < areas.length; i++) {
                    var key = areas[i].getAttribute("data-note-key");
                    var saved = noteSaved.keg[key] || "";
                    if (areas[i].value === (areas[i].getAttribute("data-saved") || "")) {
                        areas[i].value = saved;
                        areas[i].setAttribute("data-saved", saved);
                        syncNoteButton(areas[i]);
                    }
                }
            },
            fail: function() {}
        });
    }

    function bindDashNote() {
        var dash = Q("#dash-note");
        var button = Q("#dash-note-save");
        if (!dash || !button || dash.getAttribute("data-bound") === "1") return;
        dash.setAttribute("data-bound", "1");
        dash.setAttribute("data-saved", "");
        dash.addEventListener("input", function() {
            setNoteResult(dash, "");
            syncNoteButton(dash);
        });
        button.onclick = function() {
            saveNoteField({ dash: dash.value }, dash, button, function(saved) { noteSaved.dash = saved; });
        };
    }

    function makeKegNote(key) {
        var box = document.createElement("div");
        box.className = "keg-note";
        var title = document.createElement("div");
        title.className = "keg-note-title";
        var label = document.createElement("span");
        label.textContent = "<%= ui_notes %>";
        var area = document.createElement("textarea");
        area.className = "keg-note-text";
        area.setAttribute("maxlength", "1000");
        area.setAttribute("spellcheck", "false");
        area.setAttribute("aria-label", "<%= ui_notes %>");
        area.setAttribute("data-note-key", key);
        var saved = noteSaved.keg[key] || "";
        area.value = saved;
        area.setAttribute("data-saved", saved);
        var button = document.createElement("button");
        button.type = "button";
        button.className = "btn note-save";
        button.textContent = "<%= ui_save_note %>";
        button.disabled = true;
        var result = document.createElement("span");
        result.className = "note-result";
        result.setAttribute("aria-live", "polite");
        area.addEventListener("input", function() {
            setNoteResult(area, "");
            syncNoteButton(area);
        });
        button.onclick = function() {
            var payload = { keg: {} };
            payload.keg[key] = area.value;
            saveNoteField(payload, area, button, function(savedText) { noteSaved.keg[key] = savedText; });
        };
        title.appendChild(label);
        title.appendChild(button);
        title.appendChild(result);
        box.appendChild(title);
        box.appendChild(area);
        return box;
    }

    function saveKegName(input, id) {
        var name = input.value.trim();
        s_ajax({
            url: "/scale",
            m: "POST",
            mime: "application/x-www-form-urlencoded",
            data: "data=" + encodeURIComponent(JSON.stringify({ action: "kegName", id: id, kegName: name })),
            success: function() {
                input.classList.remove("is-bad");
                input.classList.add("is-ok");
            },
            fail: function() {
                input.classList.remove("is-ok");
                input.classList.add("is-bad");
            }
        });
    }

    function kegBeerInput(scale) {
        var input = document.createElement("input");
        input.type = "text";
        input.className = "keg-beer";
        input.maxLength = 31;
        input.placeholder = "<%= ui_beer_in_keg %>";
        input.setAttribute("aria-label", "<%= ui_beer_in_keg %>");
        input.value = scale.kegName || "";
        input.addEventListener("keydown", function(ev) {
            if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
        });
        input.addEventListener("change", function() { saveKegName(input, scale.id); });
        return input;
    }

    function refreshKegLive(row, scale) {
        if (!scale) return;
        var fill = Math.max(0, Math.min(100, Number(scale.percent) || 0));
        var rect = row.querySelector("clipPath rect");
        if (rect && scale.calibrated) {
            rect.setAttribute("y", String(135 - fill * 1.2));
            rect.setAttribute("height", String(Math.max(0, fill * 1.2)));
        }
        var amount = row.querySelector(".keg-amount");
        if (amount) amount.textContent = scale.remainingLiters === null ? "<%= ui_no_keg %>" : Number(scale.remainingLiters).toFixed(2) + " / " + Number(scale.capacityLiters || 0).toFixed(2) + "<%= ui_unit_l %>";
        var percent = row.querySelector(".keg-percent");
        if (percent) percent.textContent = scale.percent === null ? "--" : fill.toFixed(0) + "<%= ui_percent_remaining %>";
        var temperature = row.querySelector(".keg-temp");
        if (temperature) temperature.textContent = scale.temperatureC === null ? "<%= ui_keg_temp_unavailable %>" : Number(scale.temperatureC).toFixed(2) + "<%= ui_unit_c %>";
        var state = row.querySelector(".keg-state");
        if (state && scale.calibrated) state.textContent = ["<%= ui_keg_state_disabled %>", "<%= ui_keg_state_removed %>", "<%= ui_keg_state_settling %>", "<%= ui_keg_state_stable %>", "<%= ui_keg_state_measuring %>", "<%= ui_keg_state_nosignal %>"][scale.state] || "<%= ui_keg_state_unknown %>";
    }

    function paintKegMain(row, scale, index) {
        var connected = !!scale;
        var beerBox = row.querySelector(".keg-beer");
        if (beerBox && document.activeElement === beerBox) {
            refreshKegLive(row, scale);
            return;
        }
        row.className = "keg-status-row" + (connected ? "" : " is-offline");
        var main = row.querySelector(".keg-main");
        if (!main) {
            main = document.createElement("div");
            main.className = "keg-main";
            row.insertBefore(main, row.firstChild);
        }
        var fill = connected ? Math.max(0, Math.min(100, Number(scale.percent) || 0)) : 0;
        var graphic = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        graphic.setAttribute("viewBox", "0 0 100 150");
        graphic.setAttribute("preserveAspectRatio", "xMidYMid meet");
        graphic.setAttribute("role", "img");
        graphic.setAttribute("aria-label", connected ? ("<%= ui_cornelius_keg %> " + fill.toFixed(0) + " <%= ui_percent_full %>") : "<%= ui_keg_not_connected %>");
        graphic.classList.add("corny-keg");
        var kegShape = "M25 15h50l8 15v85l-8 20H25l-8-20V30z";
        var defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        var clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
        clip.setAttribute("id", "keg-clip-" + index);
        var clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        clipRect.setAttribute("x", "15");
        clipRect.setAttribute("y", String(135 - fill * 1.2));
        clipRect.setAttribute("width", "70");
        clipRect.setAttribute("height", String(fill * 1.2));
        clip.appendChild(clipRect);
        defs.appendChild(clip);
        var liquid = document.createElementNS("http://www.w3.org/2000/svg", "path");
        liquid.setAttribute("d", kegShape);
        liquid.setAttribute("class", "keg-liquid");
        liquid.setAttribute("clip-path", "url(#keg-clip-" + index + ")");
        var outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
        outline.setAttribute("d", kegShape);
        outline.setAttribute("class", "keg-outline");
        outline.setAttribute("fill", "none");
        var neck = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        neck.setAttribute("x", "39"); neck.setAttribute("y", "5");
        neck.setAttribute("width", "22"); neck.setAttribute("height", "12");
        neck.setAttribute("rx", "3"); neck.setAttribute("class", "keg-neck");
        graphic.appendChild(defs); graphic.appendChild(liquid); graphic.appendChild(outline); graphic.appendChild(neck);
        var details = document.createElement("div");
        details.className = "keg-status-details";
        var title = document.createElement("strong");
        var state = document.createElement("div");
        state.className = "keg-state";
        if (!connected) {
            title.textContent = "<%= ui_keg_prefix %> " + (index + 1);
            state.textContent = "<%= ui_not_connected %>";
            details.appendChild(title);
            details.appendChild(state);
        } else if (!scale.calibrated) {
            title.textContent = scale.name || ("<%= ui_scale %> " + (scale.id + 1));
            var beerName = kegBeerInput(scale);
            state.textContent = "<%= ui_connected %>";
            var needCal = document.createElement("div");
            needCal.textContent = "<%= ui_calibration_required %>";
            details.appendChild(title);
            details.appendChild(beerName);
            details.appendChild(state);
            details.appendChild(needCal);
        } else {
            title.textContent = scale.name || ("<%= ui_scale %> " + (scale.id + 1));
            var beer = kegBeerInput(scale);
            var amount = document.createElement("div");
            amount.className = "keg-amount";
            amount.textContent = scale.remainingLiters === null ? (scale.calibrated ? "<%= ui_no_keg %>" : "<%= ui_calibration_required %>") : Number(scale.remainingLiters).toFixed(2) + " / " + Number(scale.capacityLiters || 0).toFixed(2) + "<%= ui_unit_l %>";
            var percent = document.createElement("div");
            percent.className = "keg-percent";
            percent.textContent = scale.percent === null ? "--" : fill.toFixed(0) + "<%= ui_percent_remaining %>";
            var temperature = document.createElement("div");
            temperature.className = "keg-temp";
            temperature.textContent = scale.temperatureC === null ? "<%= ui_keg_temp_unavailable %>" : Number(scale.temperatureC).toFixed(2) + "<%= ui_unit_c %>";
            state.textContent = ["<%= ui_keg_state_disabled %>", "<%= ui_keg_state_removed %>", "<%= ui_keg_state_settling %>", "<%= ui_keg_state_stable %>", "<%= ui_keg_state_measuring %>", "<%= ui_keg_state_nosignal %>"][scale.state] || "<%= ui_keg_state_unknown %>";
            details.appendChild(title); details.appendChild(beer); details.appendChild(amount);
            details.appendChild(percent); details.appendChild(temperature); details.appendChild(state);
        }
        main.textContent = "";
        main.appendChild(graphic);
        main.appendChild(details);
    }

    function updateKegStatus(scaleStatus) {
        var section = Q("#keg-status-section");
        var host = Q("#keg-status-list");
        if (!section || !host) return;
        section.style.display = "block";
        var scales = [];
        if (scaleStatus && scaleStatus.use && scaleStatus.scales) {
            for (var i = 0; i < scaleStatus.scales.length; i++) {
                if (scaleStatus.scales[i].configured) scales.push(scaleStatus.scales[i]);
            }
        }
        while (scales.length < 2) scales.push(null);
        var keys = [];
        for (var n = 0; n < scales.length; n++) keys.push(noteKeyFor(scales[n], n));
        var rows = host.querySelectorAll(".keg-status-row");
        var same = rows.length === keys.length;
        for (var r = 0; r < keys.length && same; r++) {
            if (rows[r].getAttribute("data-note-key") !== keys[r]) same = false;
        }
        if (!same) {
            var notes = {};
            for (var e = 0; e < rows.length; e++) {
                var box = rows[e].querySelector(".keg-note");
                if (box && box.parentNode) box.parentNode.removeChild(box);
                notes[rows[e].getAttribute("data-note-key")] = box;
            }
            host.innerHTML = "";
            for (var c = 0; c < keys.length; c++) {
                var row = document.createElement("article");
                row.setAttribute("data-note-key", keys[c]);
                paintKegMain(row, scales[c], c);
                row.appendChild(notes[keys[c]] || makeKegNote(keys[c]));
                host.appendChild(row);
            }
        } else {
            for (var u = 0; u < keys.length; u++) paintKegMain(rows[u], scales[u], u);
        }
        fitKegGraphics(host);
    }

    function fitKegGraphics(host, tries) {
        if (!host) return;
        var rows = host.children;
        var count = rows.length;
        if (!count) return;
        var chart = document.querySelector(".chart-card");
        var section = document.getElementById("keg-status-section");
        if (!section || !chart) return;
        var chartH = chart.clientHeight;
        if (chartH < 160) {
            if ((tries || 0) < 12) requestAnimationFrame(function() { fitKegGraphics(host, (tries || 0) + 1); });
            return;
        }
        var head = section.querySelector(".keg-status-heading");
        var headH = head ? head.offsetHeight : 36;
        var gap = 8;
        var room = chartH - headH - 24 - gap * (count - 1);
        var rowH = Math.max(72, Math.floor(room / count));
        var svgH = Math.min(132, rowH - 16);
        var svgW = Math.round(svgH * 84 / 132);
        for (var i = 0; i < count; i++) {
            var row = rows[i];
            var svg = row.querySelector(".corny-keg");
            row.style.flex = "0 0 " + rowH + "px";
            row.style.height = rowH + "px";
            row.style.minHeight = rowH + "px";
            row.style.maxHeight = rowH + "px";
            row.style.overflow = "hidden";
            if (!svg) continue;
            svg.style.width = svgW + "px";
            svg.style.height = svgH + "px";
            svg.style.flexBasis = svgW + "px";
        }
    }

    function connBWF() {
        BWF.init({
            //            reconnect: false,
            onconnect: function() {
                BWF.send("c");
                if (window.lcdTimer) clearInterval(window.lcdTimer);
                window.lcdTimer = setInterval(function() {
                    if (!BWF.gotMsg) {
                        if (window.rcTimeout) {
                            // reconnect timer is running.
                            BWF.rcCount++;
                            console.log("rcTimeout failed.");
                            // let the reconnecting timer has more chances to do its job                         
                            if (BWF.rcCount < 3) return;
                            // restart reconect timer
                            clearTimer(window.rcTimeout);
                        }
                        // once connected.
                        //  no data for 5 seconds
                        controllerError();
                        window.rcTimeout = setTimeout(function() {
                            window.rcTimeout = null;
                            if (!BWF.gotMsg) BWF.reconnect(true);
                        }, T_BWF_RECONNECT);
                        BWF.rcCount = 0;
                        // setTimer might not be reliable. when the computer enter suspended state.
                        // keep this timer for saftey.
                        // clearInterval(window.lcdTimer);
                        //window.lcdTimer = null;
                        return;
                    }
                    //gotMsg==true, set flag and send
                    BWF.gotMsg = false;
                    //BWF.send("l");
                }, T_BWF_LCD);
            },
            error: function(e) {
                //console.log("error");
                // when connection establishment fails 
                // or connection broken
                communicationError();
                // do nothing, let BWF do the resconnection.
                //              setTimeout(function() {
                //                   if (!BWF.gotMsg) BWF.reconnect();
                //              }, 12000);
                closeDlgLoading();
            },
            handlers: {
                /*                L: function(lines) {
                                    BWF.gotMsg = true;
                                    processLcdText(lines);
                            },*/
                A: controllerMsg,
                G: function(c) {
                    GDSetting(c);
                },
                // for control page. 
                C: function(c) { if (typeof ccparameter != "undefined") ccparameter(c); },
                B: function(c) { if (typeof rcvBeerProfile != "undefined") rcvBeerProfile(c); }
            }
        });
    }

    function init() {
        Q("#pressure-info-pane").style.display = "none";
        Q(".gravity-device-pane").style.display = "none";
        window.plato = false;
        BChart.init("div_g", Q('#ylabel').innerHTML, Q('#y2label').innerHTML,"div_p",Q('#psilabel').innerHTML,Q('#vollabel').innerHTML,"div_h",Q("#rhlabel").innerHTML);
        initRssi();
        Capper.init();
        BWF.gotMsg = true;
        connBWF();
        loadGravityCorrection();
        setTimeout(function() { BChart.start(); }, T_LOAD_CHART);
        getActiveNavItem();
        dressChartLegend();
        dressSideCards();
        updateKegStatus(null);
        bindDashNote();
        bindRoomLabel();
        loadNotes();
        window.addEventListener("resize", function() {
            var kegs = Q("#keg-status-list");
            if (kegs) fitKegGraphics(kegs);
        });
    }

    function dressSideCards() {
        function paintDots() {
            if (typeof BrewChart == "undefined" || !BrewChart.ClassLabels || !BrewChart.Colors) return;
            var dots = document.querySelectorAll(".status-series");
            for (var i = 0; i < dots.length; i++) {
                var idx = BrewChart.ClassLabels.indexOf(dots[i].getAttribute("data-series"));
                if (idx > 0 && BrewChart.Colors[idx - 1]) dots[i].style.backgroundColor = BrewChart.Colors[idx - 1];
            }
        }
        var measureIds = ["lcdBeerTemp", "lcdBeerSet", "lcdFridgeTemp", "lcdFridgeSet", "lcdRoomTemp", "gdevice-angle", "gdevice-battery", "gravity-device-temp"];
        var valueIds = measureIds.concat(["gravity-og", "gravity-sg", "gravity-att", "gravity-abv", "sgchanged", "tilt-raw", "gravity-device-last"]);
        function dressOne(node) {
            if (!node) return;
            var text = node.textContent || "";
            var compact = text.replace(/\s/g, "");
            node.classList.toggle("is-empty", compact === "" || compact.indexOf("--") === 0);
            if (measureIds.indexOf(node.id) < 0) return;
            if (node.getAttribute("data-dress") === text && (node.classList.contains("is-empty") || node.querySelector(".tile-num"))) return;
            node.setAttribute("data-dress", text);
            if (node.classList.contains("is-empty")) return;
            var parts = text.match(/^(\s*-?[\d.]+)(.*)$/);
            if (parts && parts[2] && /[\u00B0\u00BA%V]/.test(parts[2])) {
                node.innerHTML = '<span class="tile-num">' + parts[1] + '</span><span class="tile-unit">' + parts[2] + '</span>';
            }
        }
        function paint() {
            for (var i = 0; i < valueIds.length; i++) dressOne(Q("#" + valueIds[i]));
        }
        paintDots();
        paint();
        var side = Q("[side]");
        if (!side || side._infoDressed) return;
        side._infoDressed = true;
        new MutationObserver(paint).observe(side, { subtree: true, childList: true, characterData: true });
    }

    function dressChartLegend() {
        var legend = Q(".chart-legend");
        if (!legend || legend._dressed) return;
        legend._dressed = true;

        function paintTime() {
            var timeEl = Q(".beer-chart-legend-time");
            if (!timeEl || timeEl.querySelector(".legend-clock")) return;
            var text = timeEl.textContent || "";
            var cut = text.lastIndexOf(" ");
            if (cut < 1 || text.indexOf(":") < 0) return;
            timeEl.innerHTML = '<span class="legend-date">' + text.slice(0, cut) + '</span><span class="legend-clock">' + text.slice(cut + 1) + '</span>';
        }

        function paintState() {
            var stateEl = Q(".beer-chart-state");
            if (!stateEl || stateEl.querySelector(".state-chip")) return;
            var text = (stateEl.textContent || "").replace(/^\s+|\s+$/g, "");
            if (!text) return;
            var parts = text.split(/\s+for\s+/i);
            var name = parts[0];
            var dur = parts.length > 1 ? parts.slice(1).join(" for ") : "";
            var low = name.toLowerCase();
            var heat = low.indexOf("heat") >= 0;
            var cool = low.indexOf("cool") >= 0;
            var html = "";
            if (heat && cool) {
                var bits = name.split("+");
                for (var i = 0; i < bits.length; i++) {
                    var bit = bits[i].replace(/^\s+|\s+$/g, "");
                    if (!bit) continue;
                    var tone = bit.toLowerCase().indexOf("cool") >= 0 ? "cool" : "heat";
                    html += '<span class="state-chip" data-tone="' + tone + '">' + bit + '</span>';
                }
            } else {
                var toneOne = heat ? "heat" : (cool ? "cool" : "idle");
                html = '<span class="state-chip" data-tone="' + toneOne + '">' + name + '</span>';
            }
            if (dur) html += '<span class="state-chip state-chip-time">' + dur + '</span>';
            stateEl.innerHTML = html;
        }

        function paintValues() {
            var nodes = legend.querySelectorAll(".legend-value");
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                var text = node.textContent || "";
                if (node.getAttribute("data-dress") === text && node.querySelector(".legend-num")) {
                    node.classList.toggle("is-empty", text.replace(/\s/g, "").indexOf("--") === 0);
                    continue;
                }
                node.setAttribute("data-dress", text);
                var empty = text.replace(/\s/g, "") === "--" || text.replace(/\s/g, "") === "";
                node.classList.toggle("is-empty", empty);
                if (empty) continue;
                var unitAt = text.indexOf("°");
                if (unitAt < 0) unitAt = text.indexOf("º");
                if (unitAt > 0) {
                    node.innerHTML = '<span class="legend-num">' + text.slice(0, unitAt) + '</span><span class="legend-unit">' + text.slice(unitAt) + '</span>';
                }
            }
        }

        function paint() {
            paintTime();
            paintState();
            paintValues();
        }

        var obs = new MutationObserver(paint);
        obs.observe(legend, { subtree: true, childList: true, characterData: true });
        paint();
    }
