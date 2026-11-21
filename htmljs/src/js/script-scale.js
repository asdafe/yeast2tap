var ScalePage = {
	settings: null,
	chart: null,
	selectedId: 0,
	init: function() {
		getActiveNavItem();
		Q("#save-use").onclick = this.saveUse.bind(this);
		Q("#tare-button").onclick = this.tare.bind(this);
		Q("#calibrate-button").onclick = this.calibrate.bind(this);
		Q("#keg-change-button").onclick = this.confirmKegChange.bind(this);
		Q("#measure-button").onclick = this.measureNow.bind(this);
		Q("#reset-history-button").onclick = this.resetHistory.bind(this);
		Q("#export-data-button").onclick = this.exportData.bind(this);
		Q("#save-keg").onclick = this.saveKeg.bind(this);
		Q("#save-cal-limit").onclick = this.saveCalLimit.bind(this);
		Q("#cal-limit").oninput = this.showLimitGrams.bind(this);
		Q("#save-daily").onclick = this.saveDaily.bind(this);
		Q("#sample-start").onclick = this.startSampling.bind(this);
		Q("#sample-stop").onclick = this.stopSampling.bind(this);
		Q("#save-correction").onclick = this.saveCorrection.bind(this);
		Q("#clear-correction").onclick = this.clearCorrection.bind(this);
		Q("#scale-select").onchange = this.selectScale.bind(this);
		Q("#scale-legend").onclick = this.onLegendClick.bind(this);
		BWF.init({handlers:{A:function(message){
			if (message.scale) ScalePage.updateStatus(typeof message.scale === "string" ? JSON.parse(message.scale) : message.scale);
		}}});
		this.load();
	},
	load: function() {
		var self = this;
		s_ajax({url:"/scale",m:"GET",success:function(data){
			self.settings = JSON.parse(data);
			self.renderSettings();
			self.loadHistory();
		},fail:function(error){Q("#scale-state").textContent="<%= scale_unable_load_settings %> "+error;}});
	},
	renderSettings: function() {
		var select=Q("#scale-select"), self=this;
		select.innerHTML="";
		this.settings.scales.forEach(function(scale){
			var option=document.createElement("option");
			option.value=scale.id;
			option.textContent=scale.name || ("<%= scale_heading %> "+(scale.id+1));
			select.appendChild(option);
		});
		select.value=this.selectedId;
		var enabled=document.querySelector('input[name="use-scale"][value="'+(this.settings.use?"1":"0")+'"]');
		if(enabled) enabled.checked=true;
		Q("#retention-days").value=this.settings.retentionDays || 90;
		Q("#daily-time").value=this.minuteText(this.settings.dailyMinute === undefined ? 480 : this.settings.dailyMinute);
		Q("#sample-minutes").value=this.settings.sampleMinutes || 2;
		Q("#sample-hours").value=this.settings.sampleHours || 24;
		this.renderSelectedScale();
		this.updateStatus(this.settings);
	},
	minuteText: function(minute) {
		function pad(value) { return (value < 10 ? "0" : "") + value; }
		return pad(Math.floor(minute / 60)) + ":" + pad(minute % 60);
	},
	currentScale: function() { return this.settings.scales[this.selectedId]; },
	selectScale: function() {
		this.selectedId=parseInt(Q("#scale-select").value,10)||0;
		this.renderSelectedScale();
	},
	renderSelectedScale: function() {
		var scale=this.currentScale();
		Q("#scale-device-name").textContent=scale.name || ("<%= scale_heading %> "+(scale.id+1));
		Q("#scale-keg-name").textContent=scale.kegName || "<%= scale_keg_not_set %>";
		Q("#empty-keg").value=scale.emptyKegGrams || 0;
		Q("#capacity-liters").value=((scale.capacityMl || 19000)/1000).toFixed(2);
		Q("#beer-density").value=scale.beerDensityKgPerL || 1.010;
		Q("#calibration-state").textContent=this.calLabel(scale);
		Q("#cal-limit").value=scale.calibrationLimitCounts || 1000;
		Q("#correction-formula").value=this.correctionText(scale);
		this.showLimitGrams();
	},
	showLimitGrams: function() {
		var scale=this.currentScale(), factor=Math.abs(scale.calibrationFactor || 0), limit=Num.parse(Q("#cal-limit").value) || 0;
		Q("#cal-limit-grams").textContent=scale.calibrated && factor > 0.000001 ? "<%= scale_about %> " + (limit / factor).toFixed(1) + " <%= scale_unit_g %>" : "";
	},
	saveCalLimit: function() {
		var limit=Num.parse(Q("#cal-limit").value);
		if(limit===null || limit !== Math.floor(limit) || limit < 1 || limit > 8388607) return alert("<%= scale_err_limit %>");
		this.currentScale().calibrationLimitCounts=limit;
		this.saveUse();
	},
	saveUse: function(done) {
		var payload=JSON.parse(JSON.stringify(this.settings));
		payload.action="settings";
		payload.scales.forEach(function(scale){
			delete scale.calibrated;
			delete scale.zeroOffset;
			delete scale.calibrationFactor;
		});
		payload.use=document.querySelector('input[name="use-scale"]:checked').value==="1";
		this.post(payload,"<%= scale_settings_saved %>",done);
	},
	saveKeg: function() {
		var scale=this.currentScale();
		var empty=Num.field(Q("#empty-keg"),"<%= scale_field_empty_keg %>");
		var capacity=Num.field(Q("#capacity-liters"),"<%= scale_field_capacity %>");
		var density=Num.field(Q("#beer-density"),"<%= scale_field_density %>");
		if(empty===null || capacity===null || density===null) return;
		if(!(empty >= 0)) return alert("<%= scale_err_empty_mass %>");
		if(!(capacity >= 1)) return alert("<%= scale_err_capacity %>");
		if(!(density >= 0.8 && density <= 1.3)) return alert("<%= scale_err_density %>");
		scale.emptyKegGrams=empty;
		scale.capacityMl=Math.round(capacity*1000);
		scale.beerDensityKgPerL=density;
		this.saveUse();
	},
	saveDaily: function() {
		var days=Num.parse(Q("#retention-days").value), time=/^(\d{1,2}):(\d{2})/.exec(Q("#daily-time").value||"");
		var minutes=Num.parse(Q("#sample-minutes").value), hours=Num.parse(Q("#sample-hours").value);
		if(days===null || days !== Math.floor(days) || days < 1 || days > 365) return alert("<%= scale_err_history_days %>");
		if(minutes===null || minutes !== Math.floor(minutes) || minutes < 1 || minutes > 120) return alert("<%= scale_err_sample_interval %>");
		if(hours===null || hours !== Math.floor(hours) || hours < 1 || hours > 72) return alert("<%= scale_err_sample_duration %>");
		if(!time || parseInt(time[1],10) > 23 || parseInt(time[2],10) > 59) return alert("<%= scale_err_daily_time %>");
		this.settings.retentionDays=days;
		this.settings.dailyMinute=parseInt(time[1],10)*60+parseInt(time[2],10);
		this.settings.sampleMinutes=minutes;
		this.settings.sampleHours=hours;
		this.saveUse();
	},
	startSampling: function() {
		var minutes=Num.parse(Q("#sample-minutes").value), hours=Num.parse(Q("#sample-hours").value);
		if(minutes===null || minutes !== Math.floor(minutes) || minutes < 1 || minutes > 120) return alert("<%= scale_err_sample_interval %>");
		if(hours===null || hours !== Math.floor(hours) || hours < 1 || hours > 72) return alert("<%= scale_err_sample_duration %>");
		if(!confirm("<%= scale_confirm_samples %>\n\n<%= scale_confirm_samples_body %>")) return;
		this.settings.sampleMinutes=minutes;
		this.settings.sampleHours=hours;
		var self=this;
		this.saveUse(function(){ self.post({action:"sampleStart"},null); });
	},
	stopSampling: function() { this.post({action:"sampleStop"}); },
	updateSamplingStatus: function(status) {
		var el=Q("#sample-state"), text=status.sampleActive ? "<%= scale_sampling_prefix %> "+Math.ceil((status.sampleRemainingSec||0)/60)+" <%= scale_min_left %>" : "";
		if(el.textContent!==text) el.textContent=text;
	},
	correctionText: function(scale) {
		var c=scale && scale.tempCorrection;
		if(!c || c.length<4) return "";
		// JavaScript switches to exponent notation below 1e-6, which the page's
		// own parser rejects, so render tiny values in fixed notation.
		function num(v) {
			var s=String(v);
			return s.indexOf("e")<0 ? s : String(Number(v).toFixed(9)).replace(/\.?0+$/,"");
		}
		var text=num(c[0]);
		for(var i=1;i<4;i++) if(c[i]) text+=(c[i]<0?" ":" +")+num(c[i])+(i===1?" t":" t^"+i);
		return text;
	},
	parseCorrection: function(text) {
		var s=String(text==null?"":text).replace(/\s+/g,"");
		if(!s || s.indexOf(",")>=0) return null;
		var c=[0,0,0,0], seen=[false,false,false,false];
		var term=/^([+-]?)(\d*\.?\d*)(t(?:\^(\d+))?)?/;
		while(s.length){
			var m=term.exec(s), power, value;
			if(!m[0] || (m[2]==="" && !m[3])) return null;
			power=m[3] ? (m[4] ? parseInt(m[4],10) : 1) : 0;
			if(power>3 || seen[power]) return null;
			value=m[2]==="" ? (m[1]==="-" ? -1 : 1) : parseFloat(m[1]+m[2]);
			if(!isFinite(value) || Math.abs(value) > 1e6) return null;
			c[power]=value;
			seen[power]=true;
			s=s.slice(m[0].length);
		}
		return c;
	},
	saveCorrection: function() {
		var parsed=this.parseCorrection(Q("#correction-formula").value), state=Q("#correction-state");
		state.classList.remove("is-error");
		if(parsed===null){
			state.textContent="<%= scale_err_formula %>";
			state.classList.add("is-error");
			return;
		}
		state.textContent="";
		this.currentScale().tempCorrection=parsed;
		this.saveUse();
	},
	clearCorrection: function() {
		this.currentScale().tempCorrection=[0,0,0,0];
		this.saveUse();
	},
	calLabel: function(scale) {
		if (scale && scale.calibrating) {
			var action = scale.calAction === "tare" ? "<%= scale_zeroing %>" : "<%= scale_averaging %>";
			return action + " " + (scale.calCount || 0) + "/" + (scale.calTarget || 30);
		}
		if (scale && scale.calError) {
			var reasons = {
				noLoad: "<%= scale_reason_no_load %>",
				notZeroed: "<%= scale_reason_not_zeroed %>",
				timeout: "<%= scale_reason_timeout %>"
			};
			return (scale.calError === "tare" ? "<%= scale_zeroing_failed %>" : "<%= scale_calibration_failed %>") + ": " + (reasons[scale.calErrorReason] || "<%= scale_reason_load_changed %>");
		}
		if (scale && scale.calResult) {
			return (scale.calResult === "tare" ? "<%= scale_zeroed %>" : "<%= scale_calibrated %>") + ", std dev " + this.countsText(scale, scale.calStdDev);
		}
		return scale && scale.calibrated ? "<%= scale_calibrated %>" : "<%= scale_not_calibrated %>";
	},
	countsText: function(scale, counts) {
		var text = Number(counts || 0).toFixed(1) + " <%= scale_raw_counts %>";
		var factor = Math.abs(scale.calFactor || 0);
		if (factor > 0.000001) text += " (" + (counts / factor).toFixed(1) + " <%= scale_unit_g %>)";
		return text;
	},
	calSummary: function(scale) {
		if (!scale.calResult && !scale.calError) return "<%= scale_err_no_average %>";
		var lines = [];
		if (scale.calError) {
			lines.push(this.calLabel(scale));
			if (scale.calMean === undefined) return lines[0];
			lines.push(scale.calErrorReason === "noLoad" ? "<%= scale_nothing_saved %>" : "<%= scale_nothing_saved_noisy %>");
		} else {
			lines.push(scale.calResult === "tare" ? "<%= scale_zero_done %>" : "<%= scale_cal_done %>");
			lines.push("<%= scale_average_prefix %> " + scale.calMean + " <%= scale_raw_counts %>");
			if (scale.calResult === "factor") lines.push("<%= scale_factor_prefix %> " + Number(scale.calFactor).toFixed(3) + " <%= scale_raw_per_gram %>");
		}
		lines.push("<%= scale_first_last_prefix %> " + this.countsText(scale, scale.calHalfDiff) + "<%= scale_limit_infix %> " + this.countsText(scale, scale.calLimit));
		lines.push("<%= scale_std_dev_label %> " + this.countsText(scale, scale.calStdDev));
		lines.push("<%= scale_spread_label %> " + this.countsText(scale, scale.calSpread));
		lines.push("<%= scale_samples_label %> " + (scale.calTarget || 30));
		return lines.join("\n");
	},
	tare: function() { this.runCalibration({action:"tare",id:this.selectedId}); },
	calibrate: function() {
		var known=Num.field(Q("#known-weight"),"<%= scale_field_known_weight %>");
		if(known===null) return;
		if(!(known >= 10)) return alert("<%= scale_err_known_weight %>");
		this.runCalibration({action:"calibrate",id:this.selectedId,knownWeightGrams:known});
	},
	runCalibration: function(payload) {
		var self=this, id=this.selectedId;
		Q("#tare-button").disabled=true;
		Q("#calibrate-button").disabled=true;
		Q("#calibration-state").textContent=payload.action==="tare"?"<%= scale_zeroing_progress %>":"<%= scale_averaging_progress %>";
		s_ajax({url:"/scale",m:"POST",data:"data="+encodeURIComponent(JSON.stringify(payload)),success:function(){
			self.pollCalibration(id, Date.now());
		},fail:function(error){
			alert("<%= scale_err_request %> "+error+(window.__ajaxErrorBody?" - "+window.__ajaxErrorBody:""));
			self.load();
		}});
	},
	pollCalibration: function(id, started) {
		var self=this;
		setTimeout(function(){
			s_ajax({url:"/scale",m:"GET",success:function(data){
				var status=JSON.parse(data), scale=status.scales && status.scales[id];
				if(!scale) return self.load();
				if(id===self.selectedId) self.updateStatus(status);
				if(scale.calibrating && Date.now()-started < 30000) return self.pollCalibration(id, started);
				alert(self.calSummary(scale));
				self.load();
			},fail:function(){
				if(Date.now()-started < 30000) self.pollCalibration(id, started);
				else self.load();
			}});
		},500);
	},
	confirmKegChange: function() {
		this.post({action:"kegChange",id:this.selectedId},"<%= scale_keg_change_note %>");
	},
	resetHistory: function() {
		if(!confirm("<%= scale_confirm_history %>\n\n<%= scale_confirm_history_body %>")) return;
		this.post({action:"resetHistory"},"<%= scale_history_deleted %>");
	},
	exportData: function() {
		var self=this;
		s_ajax({url:"/scale?daily=255",m:"GET",success:function(data){
			var payload={exportedAt:new Date().toISOString(),settings:self.settings,records:JSON.parse(data).records||[]};
			var link=document.createElement("a"), url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
			link.href=url;
			link.download="scale_daily.json";
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			setTimeout(function(){URL.revokeObjectURL(url);},1000);
		},fail:function(error){alert("<%= scale_err_export %> "+error);}});
	},
	measureNow: function() {
		var self=this;
		Q("#measure-button").disabled=true;
		Q("#measure-state").textContent="<%= scale_measuring_every_keg %>";
		s_ajax({url:"/scale",m:"POST",data:"data="+encodeURIComponent(JSON.stringify({action:"measure"})),success:function(){
			self.pollMeasurement([], Date.now());
		},fail:function(){
			alert("<%= scale_err_measure_start %>");
			self.load();
		}});
	},
	pollMeasurement: function(started, since) {
		var self=this;
		setTimeout(function(){
			s_ajax({url:"/scale",m:"GET",success:function(data){
				var status=JSON.parse(data), scales=status.scales||[], busy=false;
				for(var i=0;i<scales.length;i++){
					if(!scales[i]) continue;
					if(scales[i].measuring && started.indexOf(scales[i].id)<0) started.push(scales[i].id);
					if(scales[i].measuring) busy=true;
				}
				self.updateStatus(status);
				if(busy && Date.now()-since < 180000) return self.pollMeasurement(started, since);
				self.reportMeasurement(scales, started);
			},fail:function(){
				if(Date.now()-since < 180000) self.pollMeasurement(started, since);
				else self.load();
			}});
		},2000);
	},
	reportMeasurement: function(scales, started) {
		var self=this;
		s_ajax({url:"/scale?daily=255",m:"GET",success:function(data){
			self.measurementSummary(scales, started, JSON.parse(data).records||[]);
		},fail:function(){
			alert("<%= scale_err_history_read %>");
			self.load();
		}});
	},
	measurementSummary: function(scales, started, records) {
		// "2,301" for readability; plain ES5 on purpose (no toLocaleString, no template strings).
		function fmt(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
		var list=[], lines=[], missed=[], i, j, scale, record, label, time, g, liters, density, total=0, totalLiters=0, count=0, timed=0;
		for(i=0;i<scales.length;i++){
			scale=scales[i];
			if(!scale || scale.measuring) continue;
			// Only kegs that were seen measuring during this run, unless the run was too
			// short to catch any of them (then every keg that reported a result counts).
			if(started.indexOf(scale.id)>=0 || (!started.length && scale.measureResult)) list.push(scale);
		}
		for(i=0;i<list.length;i++){
			scale=list[i];
			label=scale.kegName || scale.name || ("<%= scale_keg_prefix %> "+(scale.id+1));
			// noSignal never carries measureTime in the firmware status, so test it first.
			if(scale.measureResult==="noSignal"){ missed.push("  "+label+": <%= scale_no_reading %>"); continue; }
			time=Number(scale.measureTime||0);
			if(!time) continue;
			timed++;
			record=null;
			for(j=0;j<records.length && !record;j++)
				if(Number(records[j][1])===time && Number(records[j][5])===Number(scale.id)) record=records[j];
			if(!record){ missed.push("  "+label+": <%= scale_no_reading %>"); continue; }
			g=Number(record[3])||0;
			density=scale.beerDensityKgPerL || (this.scaleById(scale.id)||{}).beerDensityKgPerL || 1.010;
			liters=g/1000/density;
			total+=g; totalLiters+=liters; count++;
			lines.push("  "+label+": "+liters.toFixed(2)+" <%= scale_unit_l %> ("+fmt(g)+" <%= scale_unit_g %>)");
		}
		var body;
		if(!records.length || (!timed && !missed.length)) body="<%= scale_clock_not_synced_note %>";
		else if(!count) body=missed.length ? missed.join("\n") : "<%= scale_no_consumption %>";
		else if(total===0) body="<%= scale_no_consumption %>"+(missed.length ? "\n"+missed.join("\n") : "");
		else body="<%= scale_today_prefix %> "+totalLiters.toFixed(2)+" <%= scale_unit_l %> ("+fmt(total)+" <%= scale_unit_g %>) <%= scale_across %> "+count+" <%= scale_keg_unit %>"+(count===1?"":"<%= scale_plural_s %>")+".\n"+lines.concat(missed).join("\n");
		alert("<%= scale_measurement_finished %>\n"+body);
		this.load();
	},
	measureStatusText: function(scale, status) {
		var notes=[];
		if (status.timeSynced === false) notes.push("<%= scale_clock_paused %>");
		if (scale.measuring) notes.push((scale.measureAction === "scheduled" ? "<%= scale_daily_measurement %>" : "<%= scale_measuring %>") + " " + (scale.measureCount || 0) + "/" + (scale.measureTarget || 50) + " <%= scale_readings %>");
		else if (scale.retryPending) notes.push("<%= scale_retry_note %>");
		if (scale.kegChangePending) notes.push("<%= scale_keg_change_pending %>");
		return notes.join(" ");
	},
	post: function(payload,message,done) {
		var self=this;
		s_ajax({url:"/scale",m:"POST",data:"data="+encodeURIComponent(JSON.stringify(payload)),success:function(){
			if(message) alert(message);
			if(typeof done === "function") done(); else self.load();
		},fail:function(error){alert("<%= scale_err_request %> "+error+(window.__ajaxErrorBody?" - "+window.__ajaxErrorBody:""));}});
	},
	updateStatus: function(status) {
		var scale=null, ready=false, busy=false, scales=status.scales||[];
		for(var i=0;i<scales.length;i++){
			if(!scales[i]) continue;
			if(scales[i].id===this.selectedId) scale=scales[i];
			// A measurement can only run on a configured, calibrated and enabled keg.
			if(scales[i].configured && scales[i].calibrated && scales[i].state!==0) ready=true;
			if(scales[i].calibrating || scales[i].measuring) busy=true;
		}
		if(!scale) return;
		var calibrating=!!scale.calibrating, scaleBusy=calibrating || !!scale.measuring;
		Q("#gross-weight").textContent=(!calibrating && scale.calibrated && scale.grossGrams!==null) ? Number(scale.grossGrams).toFixed(0)+" <%= scale_unit_g %>" : Number(scale.rawCounts||0)+" <%= scale_raw_counts %>";
		Q("#scale-state").textContent=calibrating ? this.calLabel(scale) : (["<%= scale_state_disabled %>","<%= scale_state_no_keg %>","<%= scale_state_settling %>","<%= control_stable %>","<%= scale_state_measuring %>","<%= scale_state_no_signal %>"][scale.state]||"<%= scale_unknown %>");
		Q("#keg-temperature").textContent=scale.temperatureC===null?"--":Number(scale.temperatureC).toFixed(2)+" <%= scale_unit_c %>";
		Q("#calibration-state").textContent=this.calLabel(scale);
		Q("#measure-state").textContent=this.measureStatusText(scale, status);
		Q("#tare-button").disabled=scaleBusy;
		Q("#calibrate-button").disabled=scaleBusy;
		// One manual measurement covers every keg, so the button needs every keg ready.
		Q("#measure-button").disabled=!ready || busy;
		this.updateSamplingStatus(status);
	},
	scaleById: function(id) {
		var scales=this.settings && this.settings.scales || [];
		for (var i=0;i<scales.length;i++) if (scales[i] && scales[i].id===id) return scales[i];
		return null;
	},
	loadHistory: function() {
		var self=this;
		if(!this.settings) return;
		s_ajax({url:"/scale?daily=255",m:"GET",success:function(data){
			self.renderHistory(JSON.parse(data).records||[]);
		},fail:function(){self.renderHistory([]);}});
	},
	renderHistory: function(records) {
		var self=this, days={}, kegIds=[];
		records.forEach(function(record){
			if((record[4]||0) & 32) return;
			var day=record[0], slot=days[day]||(days[day]={cons:0,level:{},flags:0});
			var id=record.length>5 ? record[5] : 0;
			var scale=self.scaleById(id)||{};
			var density=scale.beerDensityKgPerL||1.010;
			slot.cons += (record[3]||0)/1000/density;
			slot.level[id] = Math.max(0, (record[2]-(scale.emptyKegGrams||0))/1000/density);
			slot.flags |= record[4]||0;
			if(kegIds.indexOf(id)<0) kegIds.push(id);
		});
		// One series group per keg that has a record, in a stable order, so colours do not move.
		kegIds.sort(function(a,b){return a-b;});
		var kegs=kegIds.map(function(id){
			var scale=self.scaleById(id)||{};
			return {id:id, label:scale.kegName || scale.name || ("<%= scale_heading %> "+(id+1))};
		});
		var points=[], notes=[];
		Object.keys(days).sort(function(a,b){return a-b;}).forEach(function(key){
			var slot=days[key], utc=new Date(Number(key)*86400000);
			var date=new Date(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate());
			var row=[date, slot.cons];
			kegs.forEach(function(keg){
				var level=slot.level[keg.id];
				row.push(level===undefined ? null : level);
			});
			points.push(row);
			var mark="";
			if(slot.flags&2) mark+="K";
			if(slot.flags&4) mark+="U";
			if(mark) notes.push({x:date.getTime(),shortText:mark,text:(slot.flags&2?"<%= scale_keg_change_mark %> ":"")+(slot.flags&4?"<%= scale_load_changed_mark %>":"")});
		});
		var today=new Date(), start=new Date(today.getFullYear(),today.getMonth(),today.getDate());
		if(!points.length) points=[[start,0].concat(kegs.map(function(){return null;}))];
		var dayMs=86400000, range=[points[0][0].getTime()-dayMs*0.6, points[points.length-1][0].getTime()+dayMs*0.6];
		function decimal(y) { return (y == null || isNaN(y)) ? "" : Number(y).toFixed(2); }
		var palette=["#c0392b","#2d6fb3","#2e8b57","#8e44ad","#d68910","#16a085","#b03a8c","#5d6d7e"];
		// Series keys must equal the label strings dygraphs draws, and those are
		// translated at build time. The key is therefore taken from the runtime
		// labels array: the minifier folds a constant string key into dot
		// notation during the build, which produces invalid code once the
		// placeholder has been replaced.
		var labels=["<%= log_date %>","<%= scale_consumed_l %>"];
		var series={};
		series[labels[1]]={plotter:this.barPlotter,color:"#9ec5e8"};
		kegs.forEach(function(keg,index){
			var color=palette[index%palette.length];
			labels.push(keg.label+" <%= scale_left_l %>");
			series[labels[labels.length-1]]={color:color,drawPoints:true,pointSize:3};
		});
		var options={labels:labels,ylabel:"<%= scale_litres %>",
			series:series,
			axes:{y:{valueFormatter:decimal,axisLabelFormatter:decimal}},
			includeZero:true,dateWindow:range,legend:"always",labelsDiv:"scale-legend",connectSeparatedPoints:true,
			legendFormatter:this.legendFormatter};
		if(!this.chart) this.chart=new Dygraph(Q("#scale-chart"),points,options);
		else this.chart.updateOptions(Object.assign({file:points},options));
		this.chart.setAnnotations(notes);
	},
	// The legend is also the series switch: every item carries its series number, and
	// a hidden series stays listed (dimmed) so it can be brought back.
	legendFormatter: function(data) {
		var visible=data.dygraph.visibility(), html="";
		if(data.xHTML) html+='<span class="scale-legend-x">'+data.xHTML+'</span>';
		for(var i=0;i<data.series.length;i++){
			var s=data.series[i];
			html+='<span class="scale-legend-item'+(visible[i]?"":" is-off")+'" data-series="'+i+'" style="color:'+s.color+'">'+s.dashHTML+' '+s.labelHTML+(s.yHTML?" "+s.yHTML:"")+'</span>';
		}
		return html;
	},
	onLegendClick: function(event) {
		var node=event.target;
		while(node && node.nodeType===1 && !node.getAttribute("data-series")) node=node.parentNode;
		if(!node || node.nodeType!==1 || !this.chart) return;
		var index=parseInt(node.getAttribute("data-series"),10);
		if(isNaN(index)) return;
		this.chart.setVisibility(index, !this.chart.visibility()[index]);
	},
	barPlotter: function(e) {
		var g=e.dygraph, ctx=e.drawingContext, zero=g.toDomYCoord(0);
		var width=Math.max(2, Math.min(60, Math.floor((g.toDomXCoord(86400000)-g.toDomXCoord(0))*0.6)));
		ctx.fillStyle=e.color;
		e.points.forEach(function(p){
			if(isNaN(p.canvasy)) return;
			ctx.fillRect(p.canvasx-width/2, Math.min(p.canvasy, zero), width, Math.abs(zero-p.canvasy));
		});
	}
};
