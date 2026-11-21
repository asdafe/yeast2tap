function invoke(arg) {
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (xhttp.readyState == 4) {
            if (xhttp.status == 200) {
                arg.success(xhttp.responseText);
            } else {
                xhttp.onerror(xhttp.status);
            }
        }
    };
    xhttp.ontimeout = function() {
            if (typeof arg["timeout"] != "undefined")
                arg.timeout();
            else
                xhttp.onerror(-1);
        },
        xhttp.onerror = function(a) {
            if (typeof arg["fail"] != "undefined")
                arg.fail(a);
        };

    xhttp.open(arg.m, arg.url, true);
    if (typeof arg["data"] != "undefined") {
        xhttp.setRequestHeader("Content-Type", (typeof arg["mime"] != "undefined") ? arg["mime"] : "application/x-www-form-urlencoded");
        xhttp.send(arg.data);
    } else
        xhttp.send();
}

var BWF = {
//    BrewProfile: "/brewing.json",
    pendingWrites: [],
    process: function(msg) {
        if (this.raw != null) {
            this.raw(msg);
            return;
        }
        //console.log("rcv:" + msg);
        eval("m={" + msg + "}");
        //	console.log("json:"+m);
        // The controller refused a write: this client is no longer authorised.
        // Ask for the credentials again; the next command then goes through.
        if (typeof m.E != "undefined") {
            this.authorized = false;
            this.authorize();
            return;
        }
        for (var key in m) {
            if (typeof this.handlers[key] != "undefined") {
                this.handlers[key](m[key]);
            }
        }
    },
    on: function(lb, handler) {
        this.handlers[lb] = handler;
    },
    send: function(data) {
        if (this.ws.readyState != 1) return;
        // Reading is public; changing the controller is not. Writes go through
        // one authenticated request first, so the ESP32 can check them, and the
        // browser's cached credentials answer it without a second prompt.
        if (!this.needsAuth(data) || this.authorized) {
            this.ws.send(data);
            return;
        }
        // Several writes can be queued while the single /authz request is in
        // flight (a restore sends "E" and then one "U" per device, and the
        // settings restore sends batches of six), so keep them all, in order.
        this.pendingWrites.push(data);
        this.authorize();
    },
    needsAuth: function(data) {
        if (!data) return false;
        // PiLink commands that change the controller; reads (t s c v n l d h e) pass.
        return "jCSwZREUAa".indexOf(data.charAt(0)) >= 0;
    },
    authorize: function() {
        var me = this;
        if (me.authPending) return;
        me.authPending = true;
        s_ajax({
            url: "/authz",
            m: "POST",
            success: function() {
                me.authPending = false;
                me.authorized = true;
                var pending = me.pendingWrites;
                me.pendingWrites = [];
                for (var i = 0; i < pending.length; i++)
                    if (me.ws.readyState == 1) me.ws.send(pending[i]);
            },
            fail: function() {
                me.authPending = false;
                me.authorized = false;
                me.pendingWrites = [];
                alert("Login required to change settings.");
            }
        });
    },
    reconnecting: false,
    status:function(){
        if(typeof this.ws == "undefined") return -1; // not initialized
        if(this.ws.readyState == 1) return 0;
        return 1;  
    },
    connect: function() {
        var me = this;
        if (typeof WebSocket !== "undefined") {
            var ws = new WebSocket('ws://' + document.location.host + '/ws');
            me.ws = ws;
            ws.onopen = function() {
                console.log("Connected");
                me.onconnect();
            };

            ws.onclose = function() {
                if (me.reconnecting) return;
                console.log("WS close");
                me.error(-2);
                if (me.auto) setTimeout(function() { me.reconnect(); }, 5000);
            };

            /*ws.onerror = function() {
                console.log("ws error");
            };*/

            ws.onmessage = function(e) {
                me.process(e.data);
            };
        } else {
            //console.log("not support WebSocket");
            alert("Error! WebSocket Not Supported!");
        }
    },
    reconnect: function(forced) {
        forced = (typeof forced == "undefined") ? false : true;
        var me = this;
        if (me.reconnecting) return;
        if (!forced && me.ws.readyState == 1) return;
        console.log("reconnect forced:" + forced + " state:" + me.ws.readyState);
        me.reconnecting = true;
        me.ws.close();
        // this might triger onerror, and result in "reconnect" call again.
        me.connect();
        me.reconnecting = false;
    },
    init: function(arg) {
        var b = this;
        b.error = (typeof arg.error == "undefined") ? function() {} : arg.error;
        b.handlers = (typeof arg.handlers == "undefined") ? {} : arg.handlers;
        b.raw = (typeof arg.raw == "undefined") ? null : arg.raw;
        b.onconnect = (typeof arg.onconnect == "undefined") ? function() {} : arg.onconnect;
        b.auto = (typeof arg.reconnect == "undefined") ? true : arg.reconnect;

        b.connect();
    },
    save: function(file, data, success, fail) {
        invoke({
            m: "POST",
            url: "/fputs",
            data: "path=" + file + "&content=" + encodeURIComponent(data),
            success: function() { success(); },
            fail: function(e) { fail(e); }
        });
    },
    load: function(file, success, fail) {
        invoke({
            m: "GET",
            url: file,
            success: function(d) { success(d); },
            fail: function(e) { fail(e); }
        });
    }
};