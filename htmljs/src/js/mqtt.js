function mqttLoadSetting() {
    s_ajax({
        url: "mqtt",
        m: "GET",
        success: function(data) {
            var j = JSON.parse(data);
            Object.keys(j).map(function(key) {
                var name = "mqtt_" + key;
                var div = Q(".mqtt-input[name=" + name + "]");
                if (div) {
                    if (div.type == "checkbox") div.checked = (j[key] != 0);
                    else div.value = j[key];
                }
            });
            if (typeof j.open != "undefined") {
                var opener = Q("#mqtt-open");
                if (opener) opener.checked = (j.open != 0);
            }
            window.mqttReady = true;
            syncMqttCard();
        },
        fail: function(d) {
            alert("<%= log_error_getting_data_colon %>" + d);
        }
    });
}

function syncMqttCard() {
    var card = Q("#mqtt");
    var on = Q("#mqtt-open") && Q("#mqtt-open").checked;
    if (card) card.classList.toggle("is-collapsed", !on);
}

function mqttSave(quiet) {
    var ins = document.querySelectorAll(".mqtt-input");
    var json = {};
    Object.keys(ins).map(function(key, i) {
        if (ins[i].type != "submit") {
            if (ins[i].name && ins[i].name != "") {
                var val;
                if (ins[i].type == "checkbox") val = (ins[i].checked ? 1 : 0);
                else val = ins[i].value.trim();
                json[ins[i].name.split("_")[1]] = val;
            }
        }
    });
    var opener = Q("#mqtt-open");
    json.open = opener && opener.checked ? 1 : 0;

    console.log(JSON.stringify(json));
    s_ajax({
        url: "mqtt",
        data: "data=" + encodeURIComponent(JSON.stringify(json)),
        m: "POST",
        success: function(data) {
            if (!quiet) alert("<%= log_done %>");
        },
        fail: function(d) {
            if (quiet && opener) {
                opener.checked = !opener.checked;
                syncMqttCard();
            }
            alert("<%= log_error_saving_data_colon %>" + d);
        }
    });
}

function mqttInit() {
    var opener = Q("#mqtt-open");
    if (opener) opener.onchange = function() {
        syncMqttCard();
        if (window.mqttReady) mqttSave(true);
    };
    syncMqttCard();
    mqttLoadSetting();
    Q("#submitsavemqtt").onclick = function(e) {
        e.preventDefault();
        mqttSave();
        return false;
    };

}
