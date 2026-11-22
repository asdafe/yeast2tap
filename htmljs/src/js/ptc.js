var valueurl = "/ptc";
var saveurl = "/ptc"

var PTC = {
    fill: function(setting) {
        for (var name in setting) {
            var ele = Q("input[name=" + name + "]");
            if (ele) {
                ele.value = setting[name];
            }
        }
    },

    apply: function() {
        var inputs = this.div.querySelectorAll("input");
        var setting = {};
        for (var i = 0; i < inputs.length; i++) {
            var ele = inputs[i];
            if (ele.name && ele.name != "") {
                // Paracite control settings are numbers; refuse a comma rather
                // than letting parseFloat cut it at the comma.
                var v = Num.parse(ele.value);
                if (v === null) return alert((ele.name || "<%= setup_value %>") + ": " + Num.message);
                setting[ele.name] = v;
            }
        }
        console.log("result=" + JSON.stringify(setting));
        s_ajax({
            url: saveurl,
            m: "POST",
            mime: "application/x-www-form-urlencoded",
            data: "c=" + encodeURI(JSON.stringify(setting)),
            success: function(a) {
                alert("<%= press_ptc_done %>");
            },
            fail: function(a) {
                alert("<%= script_control_failed_updating_data %>" + a)
            }
        });
    },

    config: function(a) {
        if (a.enabled) {
            this.div.style.display = "block";
            this.fill(a);
        }
    },
    init: function(div) {
        div.style.display = "none";
        this.div = div;
    }
};
