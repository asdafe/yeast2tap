var PCTRL = {
    init: function() {
        // get values from the controller
        s_ajax({
            url: "psi",
            m: "GET",
            success: function(json) {
                var d = JSON.parse(json);
                if (d.mode == 1) {
                    Q("#pt-enabled").checked = true;
                    Q("#pt-control").checked = false;
                } else if (d.mode == 2) {
                    Q("#pt-enabled").checked = true;
                    Q("#pt-control").checked = true;
                } else {
                    Q("#pt-enabled").checked = false;
                    Q("#pt-control").checked = false;
                }
                Q("#fpb").value = d.b;
                Q("#fpa").value = d.a;
                Q("#pt-adc").checked = (d.adc !=0);
                Q("#pt-gain").value = d.gn;
            },
            fail: function(b) {
                alert("<%= press_err_connect %>");
            }
        });

    },
    apply: function() {
        // save data to the controller
        var data = {};
        if (Q("#pt-enabled").checked) {
            if (Q("#pt-control").checked) data.mode = 2;
            else data.mode = 1;
        } else data.mode = 0;
        data.a = Num.field(Q("#fpa"),"<%= press_coefficient_a %>");
        if(data.a===null) return;
        data.b = Num.field(Q("#fpb"),"<%= press_coefficient_b %>");
        if(data.b===null) return;
        data.adc = (Q("#pt-adc").checked)? 1:0;
        data.gn = Q("#pt-gain").value;
        var json = JSON.stringify(data);
        s_ajax({
            url: "psi",
            m: "POST",
            mime: "application/x-www-form-urlencoded",
            data: "data=" + encodeURIComponent(json),
            success: function(d) {
                alert("<%= done %>")
            },
            fail: function(d) {
                alert("<%= script_control_failed_to_save %>");
            }
        });

    },
    cal: function() {
        Q("#dlg_calibrate").style.display = "block";
        //        Q("#cal1").disabled = true;
    },
    xcal: function() {
        Q("#dlg_calibrate").style.display = "none";
    },
    cal0: function() {
        s_ajax({
            url: "psi?r=1",
            m: "GET",
            success: function(json) {
                var d = JSON.parse(json);
                //                Q("#cal1").disabled = false;
                Q("#fpb").value = d.a0;
            },
            fail: function() {
                alert("<%= press_err_connect %>");
            }
        });
    },
    cal1: function() {
        s_ajax({
            url: "psi?r=1",
            m: "GET",
            success: function(json) {
                var d = JSON.parse(json);
                Q("#fpa").value = PCTRL.conv(d.a0);
            },
            fail: function() {
                alert("<%= press_err_connect %>");
            }
        });
    },
    conv: function(a0) {
        var b = Num.parse(Q("#fpb").value);
        var psi = Num.parse(Q("#calpsi").value);
        if(b===null || psi===null) return "--";
        //(a0 - b) * a =  psi
        // a = psi / (a0-b)
        var den = a0 - b;
        if(!isFinite(den) || den === 0) return "--";
        return (psi / den).toFixed(4);
    }
};

function loaded() {
    PCTRL.init();
}