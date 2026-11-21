#include <ArduinoJson.h>
#include <time.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <IPAddress.h>
#include <FS.h>

#ifdef ESP8266
#include <ESP8266WiFi.h>
#elif defined(ESP32)
#include <WiFi.h>
#if UseLittleFS
#include <LittleFS.h>
#else
#include <SPIFFS.h>
#endif
#include <rom/spi_flash.h>
#include <esp_ota_ops.h>
#endif

#include "Config.h"
#include "Y2TSettings.h"
#include "BrewLogger.h"
#include "NumberParse.h"
#include "ExternalData.h"

Y2TSettings theSettings;

#define SETTING_FILE_NAME "/bpl.cfg"

static void stringNcopy(char *dst,const char *src,size_t n);

#ifndef WL_MAC_ADDR_LENGTH
#define WL_MAC_ADDR_LENGTH 6
#endif

void Y2TSettings::preFormat(void){
	brewLogger.onFormatFS();
}

void Y2TSettings::postFormat(void){
	save();
}


void Y2TSettings::load()
{
	DBG_PRINTF("syscfg:%d, timeinfo:%d, gdc:%d, \
		tempSchedule:%d, brewStatus:%d, logFileIndexes:%d, \
		remoteLogginInfo:%d, autoCapSettings:%d, parasiteTempControlSettings:%d\n",\
		 offsetof(Settings,syscfg),offsetof(Settings,timeinfo),offsetof(Settings,gdc),
		 offsetof(Settings,tempSchedule),offsetof(Settings,brewStatus),offsetof(Settings,logFileIndexes),
		 offsetof(Settings,remoteLogginInfo),offsetof(Settings,autoCapSettings),
		 offsetof(Settings,parasiteTempControlSettings));

	fs::File f = FileSystem.open(SETTING_FILE_NAME, "r");
	if(!f){
		// A failed swap can leave only the backup behind; recover it instead of
		// rebuilding every setting from defaults.
		if(FileSystem.exists("/bpl.cfg.bak")){
			DBG_PRINTF("settings: main file missing, recovering backup\n");
			FileSystem.rename("/bpl.cfg.bak", SETTING_FILE_NAME);
			f = FileSystem.open(SETTING_FILE_NAME, "r");
		}
		if(!f){
			setDefault();
			return;
		}
	}
	const size_t storedSize = f.size();
	const size_t legacySysCfgSize = 156; // SystemConfiguration before DuckDNS fields
	const size_t limitOffset = offsetof(Settings, scale) + offsetof(ScaleSettings, calibrationLimitCounts);
	const size_t preLimitSize = (limitOffset + alignof(Settings) - 1) / alignof(Settings) * alignof(Settings);
	const size_t kegBuildSize = preLimitSize - (sizeof(SystemConfiguration) - legacySysCfgSize);
	const size_t dailyOffset = offsetof(Settings, scale) + offsetof(ScaleSettings, dailyMinute);
	const size_t preDailySize = (dailyOffset + alignof(Settings) - 1) / alignof(Settings) * alignof(Settings);
	const size_t twoScaleOffset = offsetof(Settings, scale) + offsetof(ScaleSettings, extraDevices);
	const size_t twoScaleSize = (twoScaleOffset + alignof(Settings) - 1) / alignof(Settings) * alignof(Settings);
	const size_t sampleOffset = offsetof(Settings, scale) + offsetof(ScaleSettings, sampleMinutes);
	const size_t preSampleSize = (sampleOffset + alignof(Settings) - 1) / alignof(Settings) * alignof(Settings);
	// Where the scale block actually lives. A file at least this long carries the
	// whole structure, so its scale settings must never be replaced by defaults
	// just because fields appended AFTER the block are missing.
	const size_t scaleEnd = offsetof(Settings, scale) + sizeof(ScaleSettings);
	static_assert((offsetof(Settings, scale) + offsetof(ScaleSettings, dailyMinute) + alignof(Settings) - 1) / alignof(Settings) * alignof(Settings) < sizeof(Settings),
		"pre-daily settings file must be smaller than the current one");
	static_assert(preSampleSize < sizeof(Settings), "pre-sample settings file must be smaller than the current one");
	memset(&_data, 0, sizeof(_data));
	if(storedSize == kegBuildSize){
		// Earlier keg-scale build: no DuckDNS fields in SystemConfiguration, Scale at the end.
		f.read((uint8_t*)&_data, legacySysCfgSize);
		f.read(((uint8_t*)&_data) + sizeof(SystemConfiguration), storedSize - legacySysCfgSize);
	}else{
		f.read((uint8_t*)&_data, storedSize < sizeof(_data) ? storedSize : sizeof(_data));
	}
	f.close();
	if(storedSize < sizeof(_data)){
		if(storedSize == kegBuildSize || storedSize == preLimitSize || storedSize == preDailySize){
			// Scale history became daily records: start with the daily defaults.
			_data.scale.dailyMinute = SCALE_DEFAULT_DAILY_MINUTE;
			_data.scale.retentionDays = SCALE_DEFAULT_RETENTION_DAYS;
		}else if(storedSize == twoScaleSize){
			for(uint8_t i=SCALE_LEGACY_COUNT;i<SCALE_COUNT;i++){
				ScaleDeviceSettings &extra = scaleSlot(_data.scale, i);
				extra.doutPin = -1;
				extra.clockPin = -1;
				extra.capacityMl = 19000;
				extra.beerDensityKgPerL = 1.010f;
				scaleCalLimit(_data.scale, i) = SCALE_DEFAULT_CAL_LIMIT_COUNTS;
			}
		}else if(storedSize == preSampleSize){
			// Tail beyond the stored size is zero from the memset: no correction.
			_data.scale.sampleMinutes = SCALE_DEFAULT_SAMPLE_MINUTES;
			_data.scale.sampleHours = SCALE_DEFAULT_SAMPLE_HOURS;
		}else if(storedSize >= scaleEnd){
			// The scale block is complete; what is missing is only the tail added
			// after it (AP password, GravityMon). Those keep their memset/default
			// values (handled below), and the user's scales survive untouched.
			DBG_PRINTF("settings: %u bytes, scale block intact, tail defaulted\n", (unsigned)storedSize);
		}else{
			DBG_PRINTF("settings: %u bytes, scale block incomplete -> defaults\n", (unsigned)storedSize);
			defaultScaleSettings();
		}
		save();
	}
	// The AP password was appended to Settings after the scale block, so a file
	// written by an older build has no bytes for it and the memset leaves it
	// empty. An empty key makes WiFiSetup open the access point UNPROTECTED, so
	// fall back to the shipped default whenever the field is blank.
	bool apFixed = false;
	if(_data.apPassword[0] == '\0'){
		stringNcopy(_data.apPassword, DEFAULT_AP_PASSWORD, sizeof(_data.apPassword));
		apFixed = true;
	}
	if(apFixed) save();
	bool scaleFixed = false;
	for(uint8_t i=0;i<SCALE_COUNT;i++){
		int32_t &limit = scaleCalLimit(_data.scale, i);
		if(limit < 1 || limit > SCALE_MAX_CAL_LIMIT_COUNTS){
			limit = SCALE_DEFAULT_CAL_LIMIT_COUNTS;
			scaleFixed = true;
		}
	}
	if(_data.scale.dailyMinute >= 1440){
		_data.scale.dailyMinute = SCALE_DEFAULT_DAILY_MINUTE;
		scaleFixed = true;
	}
	if(_data.scale.retentionDays < 1 || _data.scale.retentionDays > SCALE_MAX_RETENTION_DAYS){
		_data.scale.retentionDays = SCALE_DEFAULT_RETENTION_DAYS;
		scaleFixed = true;
	}
	if(_data.scale.sampleMinutes < 1 || _data.scale.sampleMinutes > SCALE_MAX_SAMPLE_MINUTES){
		_data.scale.sampleMinutes = SCALE_DEFAULT_SAMPLE_MINUTES;
		scaleFixed = true;
	}
	if(_data.scale.sampleHours < 1 || _data.scale.sampleHours > SCALE_MAX_SAMPLE_HOURS){
		_data.scale.sampleHours = SCALE_DEFAULT_SAMPLE_HOURS;
		scaleFixed = true;
	}
	for(uint8_t i=0;i<SCALE_COUNT;i++){
		float *coeff = _data.scale.tempCorrection[i];
		bool bad = false;
		for(uint8_t j=0;j<4;j++){
			if(!isfinite(coeff[j]) || fabsf(coeff[j]) > 1e6f){ bad = true; break; }
		}
		if(bad){
			memset(coeff, 0, sizeof(_data.scale.tempCorrection[i]));
			scaleFixed = true;
		}
	}
	if(scaleFixed) save();
	// Older config files end before the DuckDNS fields were added.
	if(_data.syscfg.duckdnsDomain[0] == '\0'
		&& _data.syscfg.duckdnsToken[0] == '\0'
		&& _data.syscfg.duckdnsInterval == 0){
		stringNcopy(_data.syscfg.duckdnsDomain, DEFAULT_DUCKDNS_DOMAIN, sizeof(_data.syscfg.duckdnsDomain));
		stringNcopy(_data.syscfg.duckdnsToken, DEFAULT_DUCKDNS_TOKEN, sizeof(_data.syscfg.duckdnsToken));
		_data.syscfg.duckdnsInterval = 30;
		_data.syscfg.duckdnsEnabled = true;
		save();
	}
	// check invalid value, and correct
	// sanity check

     if(!systemConfigurationSanity()){
			setDefault();
	 }
     //timeInformationSanity();
     gravityConfigSantiy();
     beerProfileSanity();
     logFileIndexesSanity();
     remoteLoggingSanity();
     //autoCapSettingsSanity();
#if EanbleParasiteTempControl   
    // parasiteTempControlSettingsSanity();
#endif
#if EnableHumidityControlSupport
     //humidityControlSettingsSanity();
#endif
	mqttSettingSanity();
}

void Y2TSettings::save()
{
	// Write to a scratch file and swap it in only after every byte landed. A
	// plain "w" open truncates the live file first, so a full file system or a
	// power cut mid-write used to leave a short /bpl.cfg behind, and load() then
	// saw an unexpected size and rebuilt the defaults, wiping the user's scale
	// configuration.
	static const char *tmpName = "/bpl.cfg.tmp";
	static const char *bakName = "/bpl.cfg.bak";

	fs::File f = FileSystem.open(tmpName, "w");
	if(!f){
		DBG_PRINTF("error open configuration file\n");
		return;
	}
	size_t written = f.write((uint8_t*)&_data, sizeof(_data));
	f.close();
	if(written != sizeof(_data)){
		DBG_PRINTF("settings write short: %u/%u\n", (unsigned)written, (unsigned)sizeof(_data));
		FileSystem.remove(tmpName);
		return;
	}
	// Swap with a backup step so a failed rename cannot leave the device without
	// any configuration at all.
	if(FileSystem.exists(SETTING_FILE_NAME)){
		FileSystem.remove(bakName);
		FileSystem.rename(SETTING_FILE_NAME, bakName);
	}
	if(!FileSystem.rename(tmpName, SETTING_FILE_NAME)){
		if(FileSystem.exists(bakName)) FileSystem.rename(bakName, SETTING_FILE_NAME);
		DBG_PRINTF("settings swap failed, previous file restored\n");
		return;
	}
	if(FileSystem.exists(bakName)) FileSystem.remove(bakName);
}


void Y2TSettings::setDefault(void)
{

	DBG_PRINTF("\n\n*** RESET all SETTINGS ***\n\n");

	// clear. to be safe
	memset((char*)&_data,'\0',sizeof(_data));
	// 
	defaultSystemConfiguration();
    defaultTimeInformation();
    defaultGravityConfig();
    defaultBeerProfile();
    defaultLogFileIndexes();
    defaultRemoteLogging();
    defaultAutoCapSettings();
	defaultMqttSetting();
	defaultScaleSettings();
#ifdef SaveWiFiConfiguration
	// Station mode: WiFiSetup opens the backup AP when the connection fails.
	_data.syscfg.wifiMode = WIFI_STA;
	stringNcopy(_data.wifiConfiguration.ssid, DEFAULT_WIFI_SSID, sizeof(_data.wifiConfiguration.ssid));
	stringNcopy(_data.wifiConfiguration.pass, DEFAULT_WIFI_PASSWORD, sizeof(_data.wifiConfiguration.pass));
#endif

#if EanbleParasiteTempControl
    defaultParasiteTempControlSettings();
#endif
#if EnableHumidityControlSupport
	defaultHumidityControlSettings();
#endif
}

void Y2TSettings::defaultScaleSettings(void){
	ScaleSettings *settings = scaleSettings();
	memset(settings, 0, sizeof(*settings));
	settings->useScale = 0;
	settings->retentionDays = SCALE_DEFAULT_RETENTION_DAYS;
	settings->eventThresholdGrams = 100;
	settings->maxPourMl = 1500;
	settings->dailyMinute = SCALE_DEFAULT_DAILY_MINUTE;
	settings->sampleMinutes = SCALE_DEFAULT_SAMPLE_MINUTES;
	settings->sampleHours = SCALE_DEFAULT_SAMPLE_HOURS;
	for(uint8_t i=0;i<SCALE_COUNT;i++){
		ScaleDeviceSettings &scale = scaleSlot(*settings, i);
		scale.doutPin = -1;
		scale.clockPin = -1;
		scale.capacityMl = 19000;
		scale.beerDensityKgPerL = 1.010f;
		scaleCalLimit(*settings, i) = SCALE_DEFAULT_CAL_LIMIT_COUNTS;
	}
}

String Y2TSettings::jsonScaleSettings(void){
	DynamicJsonDocument doc(4096);
	ScaleSettings *settings = scaleSettings();
	doc["use"] = settings->useScale != 0;
	doc["retentionDays"] = settings->retentionDays;
	doc["eventThresholdGrams"] = settings->eventThresholdGrams;
	doc["maxPourMl"] = settings->maxPourMl;
	doc["dailyMinute"] = settings->dailyMinute;
	doc["sampleMinutes"] = settings->sampleMinutes;
	doc["sampleHours"] = settings->sampleHours;
	doc["scaleLimit"] = SCALE_COUNT;
	JsonArray scales = doc.createNestedArray("scales");
	for(uint8_t i=0;i<SCALE_COUNT;i++){
		ScaleDeviceSettings &scale = scaleSlot(*settings, i);
		JsonObject item = scales.createNestedObject();
		item["id"] = i;
		item["configured"] = scale.configured != 0;
		item["name"] = scale.name;
		item["kegName"] = scale.kegName;
		item["doutPin"] = scale.doutPin;
		item["clockPin"] = scale.clockPin;
		item["calibrated"] = scale.calibrated != 0;
		item["zeroOffset"] = scale.zeroOffset;
		item["calibrationFactor"] = scale.calibrationFactor;
		item["emptyKegGrams"] = scale.emptyKegGrams;
		item["capacityMl"] = scale.capacityMl;
		item["beerDensityKgPerL"] = scale.beerDensityKgPerL;
		item["calibrationLimitCounts"] = scaleCalLimit(*settings, i);
		JsonArray correction = item.createNestedArray("tempCorrection");
		for(uint8_t j=0;j<4;j++) correction.add(settings->tempCorrection[i][j]);
	}
	String json;
	serializeJson(doc, json);
	return json;
}

bool Y2TSettings::dejsonScaleSettings(String json, const char** why){
	#define SCALE_REJECT(reason) do { if(why) *why = reason; return false; } while(0)
	if(why) *why = NULL;
	DynamicJsonDocument doc(1024 + json.length());
	if(deserializeJson(doc, json)) SCALE_REJECT("bad json");
	ScaleSettings updated = *scaleSettings();
	// A restore file from another build may omit "use"; keeping the stored value
	// is safer than silently disabling the scale.
	bool useScale = doc["use"] | (updated.useScale != 0);
	updated.useScale = useScale ? 1 : 0;
	uint16_t retention = doc["retentionDays"] | updated.retentionDays;
	uint16_t threshold = doc["eventThresholdGrams"] | updated.eventThresholdGrams;
	uint16_t maxPour = doc["maxPourMl"] | updated.maxPourMl;
	uint16_t dailyMinute = doc["dailyMinute"] | updated.dailyMinute;
	uint16_t sampleMinutes = doc["sampleMinutes"] | updated.sampleMinutes;
	uint16_t sampleHours = doc["sampleHours"] | updated.sampleHours;
	if(retention < 1 || retention > 3650 || threshold < 10 || threshold > 5000 || maxPour < 100 || maxPour > 20000 || dailyMinute >= 1440
		|| sampleMinutes < 1 || sampleMinutes > SCALE_MAX_SAMPLE_MINUTES
		|| sampleHours < 1 || sampleHours > SCALE_MAX_SAMPLE_HOURS) SCALE_REJECT("out of range setting");
	// Older backups may carry up to 3650 days; daily records are kept for at most a year.
	updated.retentionDays = retention > SCALE_MAX_RETENTION_DAYS ? SCALE_MAX_RETENTION_DAYS : retention;
	updated.dailyMinute = dailyMinute;
	updated.sampleMinutes = sampleMinutes;
	updated.sampleHours = sampleHours;
	updated.eventThresholdGrams = threshold;
	updated.maxPourMl = maxPour;
	if(doc["scales"].is<JsonArray>()){
		JsonArray scales = doc["scales"].as<JsonArray>();
		bool usedPins[40] = {};
		// ESP32 flash, serial, and boot pins, plus the fixed OneWire and I2C pins.
		// Input-only GPIO 34-39 stay usable as DOUT; SCK is rejected below because it must drive the pin.
		const uint8_t reservedPins[] = {
			0, 1, 2, 3, 5,
			6, 7, 8, 9, 10, 11,
			12, 15,
			20, 21, 22, 23, 24,
			28, 29, 30, 31,
			37, 38
		};
		for(uint8_t i=0;i<sizeof(reservedPins);i++) usedPins[reservedPins[i]] = true;
		bool encoderPins[40] = {};
#if BREWPI_ROTARY_ENCODER
		// Block the pins the encoder actually uses (Config.h, overridable from the
		// build), not a fixed 25/32/33: the encoder moved to 13/14/18 so the scale
		// defaults 25/26 and 27/33 stay usable.
		const uint8_t rotaryPins[] = {rotaryAPin, rotaryBPin, rotarySwitchPin};
		for(uint8_t i=0;i<sizeof(rotaryPins);i++){
			if(rotaryPins[i] >= sizeof(usedPins)) continue;
			usedPins[rotaryPins[i]] = true;
			encoderPins[rotaryPins[i]] = true;
		}
#endif
		bool seen[SCALE_COUNT] = {};
		for(JsonObject item : scales){
			uint8_t id = item["id"] | 255;
			if(id >= SCALE_COUNT) SCALE_REJECT("scale id out of range");
			seen[id] = true;
			ScaleDeviceSettings &scale = scaleSlot(updated, id);
			if(item.containsKey("configured")) scale.configured = item["configured"].as<bool>();
			if(item.containsKey("name")) strlcpy(scale.name, item["name"] | "", sizeof(scale.name));
			if(item.containsKey("kegName")) strlcpy(scale.kegName, item["kegName"] | "", sizeof(scale.kegName));
			if(item.containsKey("doutPin")) scale.doutPin = item["doutPin"] | -1;
			if(item.containsKey("clockPin")) scale.clockPin = item["clockPin"] | -1;
			if(item.containsKey("calibrated")) scale.calibrated = item["calibrated"].as<bool>();
			if(item.containsKey("zeroOffset")) scale.zeroOffset = item["zeroOffset"] | 0L;
			if(item.containsKey("calibrationFactor")) scale.calibrationFactor = item["calibrationFactor"] | 0.0f;
			if(item.containsKey("emptyKegGrams")) scale.emptyKegGrams = item["emptyKegGrams"] | 0.0f;
			if(item.containsKey("capacityMl")) scale.capacityMl = item["capacityMl"] | scale.capacityMl;
			if(item.containsKey("beerDensityKgPerL")) scale.beerDensityKgPerL = item["beerDensityKgPerL"] | 1.010f;
			if(item.containsKey("calibrationLimitCounts")){
				int32_t limit = item["calibrationLimitCounts"] | (int32_t)SCALE_DEFAULT_CAL_LIMIT_COUNTS;
				if(limit < 1 || limit > SCALE_MAX_CAL_LIMIT_COUNTS) SCALE_REJECT("calibration limit out of range");
				scaleCalLimit(updated, id) = limit;
			}
			if(item["tempCorrection"].is<JsonArray>()){
				JsonArray correction = item["tempCorrection"];
				// Malformed (wrong length or non-number) is ignored, not fatal: keep the stored coefficients.
				if(correction.size() == 4
					&& correction[0].is<float>() && correction[1].is<float>()
					&& correction[2].is<float>() && correction[3].is<float>()){
					// Same rule as the boot sanity pass: finite and |c| <= 1e6, else the
					// whole set is dropped (zeroed) instead of stored.
					float *coeff = updated.tempCorrection[id];
					bool bad = false;
					for(uint8_t j=0;j<4;j++){
						coeff[j] = correction[j].as<float>();
						if(!isfinite(coeff[j]) || fabsf(coeff[j]) > 1e6f){ bad = true; break; }
					}
					if(bad) memset(coeff, 0, sizeof(updated.tempCorrection[id]));
				}
			}
			if(scale.configured){
				if(scale.doutPin < 0 || scale.doutPin > 39 || scale.clockPin < 0 || scale.clockPin > 33 || scale.doutPin == scale.clockPin)
					SCALE_REJECT("invalid gpio pair");
				if(usedPins[scale.doutPin] || usedPins[scale.clockPin]){
					// Name the pin and the reason: a scale silently dropped from a
					// restore is otherwise impossible to diagnose from the page.
					static char pinWhy[72];
					uint8_t bad = usedPins[scale.doutPin] ? scale.doutPin : scale.clockPin;
					snprintf(pinWhy, sizeof(pinWhy), "gpio %u is %s",
						(unsigned)bad,
						encoderPins[bad] ? "reserved by the rotary encoder" : "reserved for another function");
					SCALE_REJECT(pinWhy);
				}
				usedPins[scale.doutPin] = true;
				usedPins[scale.clockPin] = true;
				if(scale.capacityMl == 0 || scale.beerDensityKgPerL < 0.8f || scale.beerDensityKgPerL > 1.3f)
					SCALE_REJECT("invalid keg capacity or density");
			}
		}
		for(uint8_t id=SCALE_LEGACY_COUNT; id<SCALE_COUNT; id++){
			if(seen[id]) continue;
			ScaleDeviceSettings &dropped = scaleSlot(updated, id);
			memset(&dropped, 0, sizeof(dropped));
			dropped.doutPin = -1;
			dropped.clockPin = -1;
			dropped.capacityMl = 19000;
			dropped.beerDensityKgPerL = 1.010f;
			scaleCalLimit(updated, id) = SCALE_DEFAULT_CAL_LIMIT_COUNTS;
		}
	}
	*scaleSettings() = updated;
	#undef SCALE_REJECT
	return true;
}

void Y2TSettings::defaultTimeInformation(void){}
void Y2TSettings::defaultAutoCapSettings(void){}

void Y2TSettings::defaultLogFileIndexes(void){
	FileIndexes* info= & _data.logFileIndexes;
	info->logname[0] = '\0';
	info->writeOnBufferFull = false;
	
	for(int i=0;i<MAX_LOG_FILE_NUMBER;i++){
		info->files[i].name[0]='\0';
	}

}

bool Y2TSettings::autoCapSettingsSanity(void){ return true;}

//***************************************************************
// system configuration
#define  KeyLcdBackLight "aoff"
#define  KeyPageTitle "title"
#define  KeyHostName "name"
#define  KeyPort     "port"
#define  KeyUsername  "user"
#define  KeyPassword  "pass"
#define  KeyProtect   "protect"
#define  KeyWifi      "wifi"
#define  KeyIpAddress "ip"
#define  KeyGateway   "gw"
#define  KeyNetmask    "mask"
#define  KeyDNS "dns"
#define  KeySecuredAP "eap"

#define KeyFlashChipId "fid"
#define KeyFlashRealSize "frsize"
#define KeyFlashAssignedSize "fsize"
#define KeyFileSystemSize "fs"
#define KeyFirmwareSize "fwsize"
#define KeyAppSlotSize "appslot"
#define KeyAppSlotName "appname"
#define KeyUpdateSlotSize "otaslot"
#define KeyMacAddress "mac"
#define KeyBuildTime "date"

#define KeyDisplayMode "dis"

#define KeyGlycol "glycol"
#define KeyDuckdnsDomain "duckdnsDomain"
#define KeyDuckdnsToken "duckdnsToken"
#define KeyDuckdnsInterval "duckdnsInterval"
#define KeyDuckdnsEnabled "duckdnsEnabled"
// Appended Settings fields (outside SystemConfiguration).
#define KeyApPassword "appass"
#define KeyGravityMon "gravitymon"
#define KeyGravityMonDetected "gravitymondetected"

bool Y2TSettings::systemConfigurationSanity(void){
	SystemConfiguration *cfg=  systemConfiguration();
	if( *( cfg->hostnetworkname) == '\0'
		|| strlen(cfg->hostnetworkname)>32
		|| strlen(cfg->titlelabel) > 32
		|| cfg->wifiMode ==0){
			DBG_PRINTF("\n\n*****invalid system configuration!*****\n\n");
			return false;
	}

	return true;
}

extern IPAddress scanIP(const char *str);

SystemConfiguration* Y2TSettings::systemConfiguration(){
    return &_data.syscfg;
}

const char* Y2TSettings::themeName(void){
	switch(_data.syscfg.theme){
		case 1: return "brew";
		case 2: return "lab";
		case 3: return "hops";
		case 4: return "amber";
		case 5: return "sage";
		case 6: return "slate";
		case 7: return "plum";
		default: return "";
	}
}

bool Y2TSettings::setThemeName(const char* name){
	uint8_t id = 0;
	if(name && name[0]){
		if(strcmp(name,"brew") == 0) id = 1;
		else if(strcmp(name,"lab") == 0) id = 2;
		else if(strcmp(name,"hops") == 0) id = 3;
		else if(strcmp(name,"amber") == 0) id = 4;
		else if(strcmp(name,"sage") == 0) id = 5;
		else if(strcmp(name,"slate") == 0) id = 6;
		else if(strcmp(name,"plum") == 0) id = 7;
		else return false;
	}
	_data.syscfg.theme = id;
	return true;
}

// Soft-AP key. Kept separate from syscfg.password so the access point can have
// its own credential; shorter keys are refused by WiFiSetup's >=8 check anyway,
// so an empty value restores the shipped default.
bool Y2TSettings::setApPassword(const char* value){
	if(!value) return false;
	if(strlen(value) >= sizeof(_data.apPassword)) return false;
	if(value[0] == '\0'){
		stringNcopy(_data.apPassword, DEFAULT_AP_PASSWORD, sizeof(_data.apPassword));
		return true;
	}
	stringNcopy(_data.apPassword, value, sizeof(_data.apPassword));
	return true;
}

    // decode json
static void stringNcopy(char *dst,const char *src,size_t n){
	if(strlen(src) < n){
		strcpy(dst,src);
	}else{
		strncpy(dst,src,n-1);
		dst[n-1]='\0';
	}
}


void Y2TSettings::defaultSystemConfiguration(void){
    SystemConfiguration *syscfg=&_data.syscfg;

    stringNcopy(syscfg->titlelabel,DEFAULT_PAGE_TITLE,32);
    stringNcopy(syscfg->hostnetworkname,DEFAULT_HOSTNAME,32);
    stringNcopy(syscfg->username,DEFAULT_USERNAME,32);
    stringNcopy(syscfg->password,DEFAULT_PASSWORD,32);
    
	syscfg->port = 80;
    syscfg->passwordLcd = false;
    syscfg->wifiMode = WIFI_AP_STA;
    syscfg->backlite = 0;
    syscfg->ip = (uint32_t) IPAddress(0,0,0,0);
    syscfg->gw = (uint32_t) IPAddress(0,0,0,0);
    syscfg->netmask = (uint32_t) IPAddress(0,0,0,0);
    syscfg->dns = (uint32_t) IPAddress(0,0,0,0);
    syscfg->glycolChilling = 0;
	syscfg->securedAp = false;
	stringNcopy(syscfg->duckdnsDomain, DEFAULT_DUCKDNS_DOMAIN, sizeof(syscfg->duckdnsDomain));
	stringNcopy(syscfg->duckdnsToken, DEFAULT_DUCKDNS_TOKEN, sizeof(syscfg->duckdnsToken));
	syscfg->duckdnsInterval = 30;
	syscfg->duckdnsEnabled = true;
	syscfg->theme = 0;
	#if TWOFACED_LCD
	syscfg->displayMode = 0;
	#endif
	// Fields appended to Settings (not SystemConfiguration).
	stringNcopy(_data.apPassword, DEFAULT_AP_PASSWORD, sizeof(_data.apPassword));
	_data.gravityMon = 0;
}

bool Y2TSettings::dejsonSystemConfiguration(String json){

	SystemConfiguration *syscfg=&_data.syscfg;

	const int BUFFER_SIZE = JSON_OBJECT_SIZE(22);
	
	#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(BUFFER_SIZE +json.length());

	auto error = deserializeJson(root,json);

	if(!error)

	#else

 	StaticJsonBuffer<BUFFER_SIZE> jsonBuffer;
	JsonObject& root = jsonBuffer.parseObject(json.c_str());

    if (root.success())
	#endif
	{
        stringNcopy(syscfg->titlelabel,root[KeyPageTitle],32);
        stringNcopy(syscfg->hostnetworkname,root[KeyHostName],32);
        stringNcopy(syscfg->username,root[KeyUsername],32);
        if(root.containsKey(KeyPassword)) stringNcopy(syscfg->password,root[KeyPassword],32);

        syscfg->port = root[KeyPort];
        syscfg->passwordLcd = root[KeyProtect];
        syscfg->wifiMode = root[KeyWifi];
        syscfg->backlite = root[KeyLcdBackLight];
		syscfg->securedAp = root[KeySecuredAP];
		#if TWOFACED_LCD
		syscfg->displayMode = root[KeyDisplayMode];
		#endif
        syscfg->glycolChilling=root[KeyGlycol];
		if(root.containsKey(KeyDuckdnsDomain)) stringNcopy(syscfg->duckdnsDomain,root[KeyDuckdnsDomain],sizeof(syscfg->duckdnsDomain));
		if(root.containsKey(KeyDuckdnsToken)) stringNcopy(syscfg->duckdnsToken,root[KeyDuckdnsToken],sizeof(syscfg->duckdnsToken));
		if(root.containsKey(KeyDuckdnsInterval)){
			uint32_t interval = root[KeyDuckdnsInterval];
			syscfg->duckdnsInterval = (interval > 1440) ? 1440 : (uint16_t)interval;
		}
		if(root.containsKey(KeyDuckdnsEnabled)) syscfg->duckdnsEnabled=root[KeyDuckdnsEnabled];
		// Soft-AP key, independent of the web login password above.
		if(root.containsKey(KeyApPassword)) setApPassword(root[KeyApPassword] | "");
		// GravityMon: 0 auto, 1 on, 2 off.
		if(root.containsKey(KeyGravityMon)){
			uint8_t gm = root[KeyGravityMon];
			_data.gravityMon = (gm > 2) ? 0 : gm;
		}		// Static network settings are exported in the same object, so a restored
		// backup must put them back. Only a non-zero address is applied; an empty
		// or "0.0.0.0" value keeps whatever the device already uses.
		{
			const char* keys[4] = {KeyIpAddress, KeyGateway, KeyNetmask, KeyDNS};
			uint32_t* targets[4] = {&syscfg->ip, &syscfg->gw, &syscfg->netmask, &syscfg->dns};
			for(uint8_t i=0;i<4;i++){
				if(!root.containsKey(keys[i])) continue;
				IPAddress parsed;
				const char* text = root[keys[i]] | "";
				if(!text[0] || !parsed.fromString(text) || parsed == IPAddress()) continue;
				*targets[i] = (uint32_t)parsed;
			}
		}
		if(root.containsKey("theme")){
			const char* theme = root["theme"] | "";
			if(!setThemeName(theme)) return false;
		}
		return true;
    }
	return false;
}
    // encod json
String Y2TSettings::jsonSystemConfiguration(bool redactSecrets){
	#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(1024);
	#else
    DynamicJsonBuffer jsonBuffer;
    JsonObject& root = jsonBuffer.createObject();
	#endif

    SystemConfiguration *syscfg=&_data.syscfg;

    root[KeyPageTitle]=syscfg->titlelabel;
    root[KeyHostName]= syscfg->hostnetworkname;
    root[KeyUsername]= syscfg->username;
    // The interface is readable without a login, so the two secrets are left out
    // of an unauthenticated reply. dejsonSystemConfiguration only overwrites a
    // secret when its key is present, so an absent key keeps the stored value.
    if(!redactSecrets) root[KeyPassword]= syscfg->password;

    root[KeyPort]=   syscfg->port;
    root[KeyProtect]=    syscfg->passwordLcd;
    root[KeyWifi] =   syscfg->wifiMode;
    root[KeyLcdBackLight] =   syscfg->backlite;

    root[KeyIpAddress]= IPAddress(syscfg->ip).toString();
    root[KeyGateway]= IPAddress(syscfg->gw).toString();
    root[KeyNetmask]= IPAddress(syscfg->netmask).toString();
	root[KeyDNS] = IPAddress(syscfg->dns).toString();
	root[KeyGlycol] = syscfg->glycolChilling;
	root[KeyDuckdnsDomain] = syscfg->duckdnsDomain;
	if(!redactSecrets) root[KeyDuckdnsToken] = syscfg->duckdnsToken;
	root[KeyDuckdnsInterval] = syscfg->duckdnsInterval;
	root[KeyDuckdnsEnabled] = syscfg->duckdnsEnabled;
	root["theme"] = themeName();
	root[KeySecuredAP] = syscfg->securedAp;
	// The AP key is a secret like the login password: withheld on an
	// unauthenticated read so it is not exposed to a visitor.
	if(!redactSecrets) root[KeyApPassword] = _data.apPassword;
	root[KeyGravityMon] = _data.gravityMon;
	#if TWOFACED_LCD
	root[KeyDisplayMode] = syscfg->displayMode;
	#endif

// system info
#if ESP32
	root[KeyFlashChipId]=g_rom_flashchip.device_id;
	root[KeyFlashRealSize]=g_rom_flashchip.chip_size;
	root[KeyFileSystemSize]=FileSystem.totalBytes();
#else
	root[KeyFlashChipId]=ESP.getFlashChipId();
	root[KeyFlashRealSize]=ESP.getFlashChipRealSize();

	FSInfo fs_info;
	FileSystem.info(fs_info);
	root[KeyFileSystemSize]=fs_info.totalBytes;

#endif

	root[KeyFlashAssignedSize]=ESP.getFlashChipSize();
#if defined(ESP32)
	{
		uint32_t firmwareSize = ESP.getSketchSize();
		const esp_partition_t *running = esp_ota_get_running_partition();
		const esp_partition_t *updateSlot = esp_ota_get_next_update_partition(NULL);
		root[KeyFirmwareSize] = firmwareSize;
		root[KeyAppSlotSize] = running ? running->size : 0;
		root[KeyAppSlotName] = running ? running->label : "";
		root[KeyUpdateSlotSize] = updateSlot ? updateSlot->size : 0;
	}
#endif
	root[KeyBuildTime] = __DATE__ __TIME__;
	uint8_t mac[WL_MAC_ADDR_LENGTH];
	WiFi.macAddress(mac);
	JsonArray data = root.createNestedArray(KeyMacAddress);
	
	for(int i=0;i<WL_MAC_ADDR_LENGTH;i++){
		data.add(mac[i]);
	}

    String ret;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif

    return ret;
}
   
//***************************************************************
// gravity device configuration

#define KeyGravityDeviceType "dev"
#define KeyCalibrateFormula "cal"
#define KeyGravityOffset "off"

#define KeyLPFBeta "lpc"
#define KeyStableGravityThreshold "stpt"
#define KeyNumberCalPoints "npt"
#define KeyUsePlato "plato"

#define KeyTiltColor "color"
#define KeyCalibrationPoints "calpts"

#define KeyPillMacAddress "mac"
#define KeyTemperatureCorrection "tc"
#define KeyTiltCorrectionCoefficient "ttce"
#define KeyTtceUnit "ttceunit"
#define KeyGravtyCalibrationCoefficient "gcce"

bool Y2TSettings::gravityConfigSantiy(){
	GravityDeviceConfiguration *gdc = &_data.gdc;

	if(gdc->gravityDeviceType > MaxDeviceTypeNumber){
		defaultGravityConfig();
		return false;
	}

	// A file written before ttceUnit existed reads it as zero (it was padding).
	// Derive it from the active path so the numbers keep their old meaning.
	if(gdc->ttceUnit != TTCE_UNIT_SG && gdc->ttceUnit != TTCE_UNIT_TILT){
		gdc->ttceUnit = gdc->calbybpl ? TTCE_UNIT_TILT : TTCE_UNIT_SG;
		save();
	}

	return true;
}

bool Y2TSettings::dejsonGravityConfig(char* json)
{
		#if ARDUINOJSON_VERSION_MAJOR == 6
//		StaticJsonDocument<JSON_OBJECT_SIZE(16) + 256> root;
		StaticJsonDocument<2048> root;
		auto error = deserializeJson(root,json);
		if (error)

		#else
    	const int BUFFER_SIZE = JSON_OBJECT_SIZE(16);
		StaticJsonBuffer<BUFFER_SIZE> jsonBuffer;
		JsonObject& root = jsonBuffer.parseObject(json);
		if (!root.success())
		#endif
		{
  			DBG_PRINTF("Invalid JSON  data:%s\n",json);
  			return false;
		}
        GravityDeviceConfiguration *gdc = &_data.gdc;

		gdc->gravityDeviceType=root[KeyGravityDeviceType];
		gdc->stableThreshold=root[KeyStableGravityThreshold];
		gdc->usePlato = root.containsKey(KeyUsePlato)? root[KeyUsePlato]:0;
		gdc->lpfBeta =root[KeyLPFBeta];

		gdc->calbybpl = root[KeyCalibrateFormula];
		gdc->offset = root[KeyGravityOffset];
		gdc->tempCorrection = root[KeyTemperatureCorrection];

		// The four ttce numbers only describe one quantity at a time: the tilt
		// angle when the curve turns an angle into SG, the reported SG otherwise.
		// A request without "ttce" (most saves) must not touch them at all: only
		// the page that actually edited the formula may retag and replace them.
		if(root.containsKey(KeyTiltCorrectionCoefficient)){
			uint8_t newUnit = gdc->calbybpl ? TTCE_UNIT_TILT : TTCE_UNIT_SG;
			if(root.containsKey(KeyTtceUnit)){
				uint8_t requested = root[KeyTtceUnit];
				if(requested == TTCE_UNIT_SG || requested == TTCE_UNIT_TILT) newUnit = requested;
			}
			if(gdc->ttceUnit != TTCE_UNIT_UNKNOWN && gdc->ttceUnit != newUnit){
				// Numbers from the other mode mean a different quantity; keeping
				// them would silently apply an angle curve to SG.
				memset(gdc->tiltCorrectionCoeff, 0, sizeof(gdc->tiltCorrectionCoeff));
			}
			gdc->ttceUnit = newUnit;
		}

		if(gdc->gravityDeviceType == GravityDeviceIspindel){
		}

		JsonArray calpts = root[KeyCalibrationPoints].as<JsonArray>();
		int numpt=0;
		for(JsonVariant v : calpts) {
				JsonArray point=v.as<JsonArray>();
				gdc->calPoints[numpt].raw=  point[0].as<int>();
				gdc->calPoints[numpt].calsg= point[1].as<int>();
				numpt++;
				if(numpt >= MaxNumberCalibrationPoints) break;
		}
		gdc->numCalPoints = numpt;

		// GravityMon preference comes with the gravity settings (0 auto, 1 on, 2 off).
		if(root.containsKey(KeyGravityMon)){
			uint8_t gm = root[KeyGravityMon];
			_data.gravityMon = (gm > 2) ? 0 : gm;
		}

		if(root.containsKey(KeyGravtyCalibrationCoefficient)){
			JsonArray gcce = root[KeyGravtyCalibrationCoefficient].as<JsonArray>();
			int t=0;
			for(JsonVariant v : gcce) {
				gdc->gravityFormulaCoeff[t]=(float) v.as<float>();
				t++;
				if(t>=4) break;
			}
		}
		if(root.containsKey(KeyTiltCorrectionCoefficient)){

			JsonArray ttce = root[KeyTiltCorrectionCoefficient].as<JsonArray>();
			int t=0;
			for(JsonVariant v : ttce) {
				gdc->tiltCorrectionCoeff[t]=(float) v.as<float>();
				t++;
				if(t>=4) break;
			}
		}

		#if SupportTiltHydrometer
		if(gdc->gravityDeviceType == GravityDeviceTilt){
			TiltConfiguration *tcfg = & _data.bleHydrometerConfiguration.tilt;
			tcfg->tiltColor = root[KeyTiltColor];
		}
		#endif

		#if SupportPillHydrometer
		if(gdc->gravityDeviceType == GravityDevicePill){
			PillConfiguration *pcfg = & _data.bleHydrometerConfiguration.pill;
		
			JsonArray mac = root[KeyPillMacAddress].as<JsonArray>();
			int a=0;
			for(JsonVariant v : mac) {
				pcfg->macAddress[a]=(uint8_t) v.as<int>();
				a++;
			}
		}
		#endif


	return true;
}

String Y2TSettings::jsonGravityConfig(void){
		// save to file

		#if ARDUINOJSON_VERSION_MAJOR == 6
		// Two keys were added for GravityMon (setting + detection).
		DynamicJsonDocument root(1152);
		#else
    	const int BUFFER_SIZE = JSON_OBJECT_SIZE(16);
		StaticJsonBuffer<BUFFER_SIZE> jsonBuffer;
		JsonObject& root = jsonBuffer.createObject();
		#endif

        GravityDeviceConfiguration *gdc = &_data.gdc;

		root[KeyGravityDeviceType] = gdc->gravityDeviceType;
		root[KeyStableGravityThreshold] = gdc->stableThreshold;
		root[KeyUsePlato] = gdc->usePlato;
		root[KeyLPFBeta] =gdc->lpfBeta;

		root[KeyCalibrateFormula] = gdc->calbybpl;

		
		root[KeyNumberCalPoints] = gdc->numCalPoints;
		root[KeyGravityOffset] = gdc->offset;		
		root[KeyTemperatureCorrection] = gdc->tempCorrection;
		root[KeyTtceUnit] = gdc->ttceUnit;

		if(gdc->numCalPoints > 0){
			JsonArray points = root.createNestedArray(KeyCalibrationPoints);
			for(int i=0;i< gdc->numCalPoints;i++){
				JsonArray point= points.createNestedArray();
				point.add(gdc->calPoints[i].raw);
				point.add(gdc->calPoints[i].calsg);
			}
		}

		JsonArray gcce = root.createNestedArray(KeyGravtyCalibrationCoefficient);
		for(int i=0;i< 4;i++){
				gcce.add(gdc->gravityFormulaCoeff[i]);
		}

		
		JsonArray ttce = root.createNestedArray(KeyTiltCorrectionCoefficient);
		for(int i=0;i< 4;i++){
				ttce.add(gdc->tiltCorrectionCoeff[i]);
		}

		// GravityMon is an iSpindel over the wire; the only signal is the name it
		// reports, so the page gets both the stored choice and the detection.
		root[KeyGravityMon] = _data.gravityMon;
		root[KeyGravityMonDetected] = externalData.gravityMonDetected() ? 1 : 0;


		#if SupportTiltHydrometer
		if(gdc->gravityDeviceType == GravityDeviceTilt){
			TiltConfiguration *tcfg = & _data.bleHydrometerConfiguration.tilt;

			root[KeyTiltColor]	=	tcfg->tiltColor;
		}
		#endif
		#if SupportPillHydrometer
		if(gdc->gravityDeviceType == GravityDevicePill){
			PillConfiguration *pcfg = & _data.bleHydrometerConfiguration.pill;

			JsonArray macs = root.createNestedArray(KeyPillMacAddress);
			for(int i=0;i< 6;i++){
				macs.add(pcfg->macAddress[i]);
			}
		}
		#endif

	 String ret;

	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif
    return ret;
}	

void Y2TSettings::defaultGravityConfig(void)
{
	GravityDeviceConfiguration *gdc = &_data.gdc;
	for(int i=0;i<4;i++){
		gdc->gravityFormulaCoeff[i]=0;
	}
    gdc->gravityFormulaCoeff[1]=1;

	// Default BeerTemp×SG correction (from BPLLogViewer GravityMon fit)
	gdc->tiltCorrectionCoeff[0]=0.0030552861280739307f;
	gdc->tiltCorrectionCoeff[1]=-0.00010718428529798985f;
	gdc->tiltCorrectionCoeff[2]=-0.000012412606338330079f;
	gdc->tiltCorrectionCoeff[3]=5.066802941655624e-7f;

    gdc->lpfBeta = 0.1;
	gdc->offset =0;

	// GravityMon talks iSpindel-compatible JSON; BPL calc off by default
	gdc->gravityDeviceType  = GravityDeviceIspindel;

    gdc->calbybpl=0;
	gdc->numCalPoints=0;
    gdc->stableThreshold=1;

	gdc->usePlato=0;
    gdc->tempCorrection=1;
    // The shipped coefficients are an SG-vs-beer-temperature correction.
    gdc->ttceUnit=TTCE_UNIT_SG;
}
  
//***************************************************************
// Beer profile

/*
 * Reconstitute "struct tm" elements into a time_t count value.
 * Note that the year argument is offset from 1970.
 */
#define SECS_PER_MIN  (60UL)
#define SECS_PER_HOUR (3600UL)
#define SECS_PER_DAY  (SECS_PER_HOUR * 24UL)
#define DAYS_PER_WEEK (7UL)
#define SECS_PER_WEEK (SECS_PER_DAY * DAYS_PER_WEEK)
#define SECS_PER_YEAR (SECS_PER_WEEK * 52UL)
#define SECS_YR_2000  (946684800UL)	// The time_t value at the very start of Y2K.
static	const uint8_t monthDays[]={31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
#define LEAP_YEAR(Y)		 ( ((1970+Y)>0) && !((1970+Y)%4) && ( ((1970+Y)%100) || !((1970+Y)%400) ) )
time_t tm_to_timet(struct tm *tm_time){

	int i;
	time_t seconds;

	seconds= tm_time->tm_year*(SECS_PER_DAY * 365);
	for (i = 0; i < tm_time->tm_year; i++) {
		if (LEAP_YEAR(i)) {
			seconds += SECS_PER_DAY;	// Add extra days for leap years.
		}
	}
	// Add the number of elapsed days for the given year. Months start from 1.
	for (i = 1; i < tm_time->tm_mon; i++) {
		if ( (i == 2) && LEAP_YEAR(tm_time->tm_year)) {
			seconds += SECS_PER_DAY * 29;
		} else {
			seconds += SECS_PER_DAY * monthDays[i-1];	// "monthDay" array starts from 0.
		}
	}
	seconds+= (tm_time->tm_mday-1) * SECS_PER_DAY;		// Days...
	seconds+= tm_time->tm_hour * SECS_PER_HOUR;		// Hours...
	seconds+= tm_time->tm_min * SECS_PER_MIN;		// Minutes...
	seconds+= tm_time->tm_sec;				// ...and finally, Seconds.
	return (time_t)seconds;
}
// got from https://github.com/PaulStoffregen/Time
void makeTime(time_t timeInput, struct tm &tm){
// break the given time_t into time components
// this is a more compact version of the C library localtime function
// note that year is offset from 1970 !!!

  uint8_t year;
  uint8_t month, monthLength;
  uint32_t time;
  unsigned long days;

  time = (uint32_t)timeInput;
  tm.tm_sec = time % 60;
  time /= 60; // now it is minutes
  tm.tm_min = time % 60;
  time /= 60; // now it is hours
  tm.tm_hour = time % 24;
  time /= 24; // now it is days
  tm.tm_wday = ((time + 4) % 7) + 1;  // Sunday is day 1

  year = 0;
  days = 0;
  while((unsigned)(days += (LEAP_YEAR(year) ? 366 : 365)) <= time) {
    year++;
  }
  tm.tm_year = year +1970; // year is offset from 1970

  days -= LEAP_YEAR(year) ? 366 : 365;
  time  -= days; // now it is days in this year, starting at 0

  days=0;
  month=0;
  monthLength=0;
  for (month=0; month<12; month++) {
    if (month==1) { // february
      if (LEAP_YEAR(year)) {
        monthLength=29;
      } else {
        monthLength=28;
      }
    } else {
      monthLength = monthDays[month];
    }

    if (time >= monthLength) {
      time -= monthLength;
    } else {
        break;
    }
  }
  tm.tm_mon = month + 1;  // jan is month 1
  tm.tm_mday = time + 1;     // day of month
}


bool Y2TSettings::beerProfileSanity(void){
	BeerTempSchedule *schedule = & _data.tempSchedule;
	if(schedule->_padding[0] > 1) schedule->_padding[0] = 0;
	if(schedule->_padding[1] > 1) schedule->_padding[1] = 0;
	if(schedule->_padding[2] > 1) schedule->_padding[2] = 0;
	if(schedule->_padding[3] > 1) schedule->_padding[3] = 0;
	if(schedule->numberOfSteps > MaximumSteps 
		|| (schedule->unit != 'C' && schedule->unit != 'F')){
		DBG_PRINTF("\n\n**** Error Beer invalid unit:%d  ***\n\n",schedule->unit);
		defaultBeerProfile();
		return false;
	}
	char conditions[]="tgsaouvbxwer";
	for(int i=0;i< schedule->numberOfSteps ;i++){
		ScheduleStep *step = &schedule->steps[i];
		if(strchr(conditions,step->condition) == NULL){
			DBG_PRINTF("\n\n**** Error Beer profile, invalid condition:%d ***\n\n",step->condition);

			defaultBeerProfile();
			return false;
		}
	}
	return true;
}

 void Y2TSettings::defaultBeerProfile(void)
 {
	BeerTempSchedule *tempSchedule = & _data.tempSchedule;
	tempSchedule->unit = 'C';
	tempSchedule->numberOfSteps =1;
	memset(tempSchedule->_padding, 0, sizeof(tempSchedule->_padding));
	ScheduleStep *step = &tempSchedule->steps[0];
	step->condition = 't';
	step->days = ScheduleDayFromJson(7);
	step->temp = ScheduleTempFromJson(20);
 }

bool Y2TSettings::dejsonBeerProfile(String json)
{
	const int PROFILE_JSON_BUFFER_SIZE = JSON_ARRAY_SIZE(15) + MaximumSteps *JSON_OBJECT_SIZE(2) + JSON_OBJECT_SIZE(3) + 3*JSON_OBJECT_SIZE(4) + 5*JSON_OBJECT_SIZE(6);
	#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(PROFILE_JSON_BUFFER_SIZE + json.length());
	auto error = deserializeJson(root,json);
	if(error)
	#else
	DynamicJsonBuffer jsonBuffer(PROFILE_JSON_BUFFER_SIZE);
	JsonObject& root = jsonBuffer.parseObject(json.c_str());

	if(!root.success())
	#endif
	{
		DBG_PRINTF("JSON parsing failed json size:%d\n",PROFILE_JSON_BUFFER_SIZE);
		return false;
	}
	if(!root.containsKey("s")
		|| !root.containsKey("u")
		|| !root.containsKey("t")){
		DBG_PRINTF("JSON file not include necessary fields\n");
		return false;
	}
	#if ARDUINOJSON_VERSION_MAJOR == 6
	if (!root.as<JsonVariant>()["t"].is<JsonArray>()){
	#else
	if (!root["t"].is<JsonArray&>()){
	#endif
		DBG_PRINTF("JSON t is not array\n");		
		return false;
	}
	BeerTempSchedule *tempSchedule = & _data.tempSchedule;
	// get starting time

	tempSchedule->startDay=root["s"];

	#if ARDUINOJSON_VERSION_MAJOR == 6
	JsonArray schedule = root["t"];
	#else
	JsonArray& schedule = root["t"];
	#endif
	tempSchedule->numberOfSteps=schedule.size();
	if(tempSchedule->numberOfSteps > MaximumSteps) tempSchedule->numberOfSteps=MaximumSteps;

	for(int i=0;i< tempSchedule->numberOfSteps ;i++){
		ScheduleStep *step = &tempSchedule->steps[i];
		#if ARDUINOJSON_VERSION_MAJOR == 6
		JsonObject	 entry= schedule[i];
		#else
		JsonObject&	 entry= schedule[i];
		#endif
		//{"c":"g","d":6,"t":12,"g":1.026},{"c":"r","d":1}
		const char* constr= entry["c"];
		step->condition = *constr;
		step->days = ScheduleDayFromJson(entry["d"].as<float>());

		DBG_PRINTF("%d ,type:%c time:",i,step->condition );
		DBG_PRINT(step->days);

		if(step->condition != 'r'){ // all but not ramping
			float temp=entry["t"];
			step->temp= ScheduleTempFromJson(temp);

			if(entry.containsKey("g")){
    			if(entry["g"].is<const char*>()){
					step->attSpecified=false;
    			    const char* attStr=entry["g"];
    			    // "75%" or "2,75%" attenuation. The number is fitted to a dot
    			    // decimal; a comma must not drop the step.
    			    if(strchr(attStr, '%')){
    			        float att;
    			        if(NumberParse::gravity(attStr, att)){
	    			        DBG_PRINTF(" att:%s sg:%d ",attStr,step->gravity.sg);
						    step->attSpecified=true;
						    step->gravity.attenuation =(uint8_t) att;
                        }
                    }
    			}
				if(! step->attSpecified){
    			    float fsg;
    			    bool fsgValid = true;
    			    if(entry["g"].is<const char*>()){
    			        // Device and imported profiles may use a comma. Fit it to a
    			        // dot decimal and keep the step; do not reject the profile.
    			        fsgValid = NumberParse::gravity(entry["g"].as<const char*>(), fsg);
    			    }else{
    			        fsg= entry["g"].as<float>();
    			    }
    			    if(fsgValid){
						if(_data.gdc.usePlato){
		    		    	step->gravity.sg = PlatoToGravity(fsg);
						}else{
		    		    	step->gravity.sg = SGToGravity(fsg);
						}
	    			    DBG_PRINTF(" sg:%d",step->gravity.sg);
	    			}
    		    }
			}

			if(entry.containsKey("s")){
    			int st= entry["s"];
	    		step->stable.stableTime =st;
	    		step->stable.stablePoint=(entry.containsKey("x"))? entry["x"]:_data.gdc.stableThreshold;

    			DBG_PRINTF("Stable :%d@%d",step->stable.stablePoint,step->stable.stableTime);
			}

			DBG_PRINT(" temp:");
			DBG_PRINT(step->temp);
		}
		DBG_PRINTF("\n");
	}

	// unit
	const char *uintStr=root["u"];
	tempSchedule->unit=  *uintStr;
	if(root.containsKey("tg")){
		const char* tg = root["tg"] | "";
		tempSchedule->_padding[0] = (tg[0] == 'f') ? 1 : 0;
	}
	if(root.containsKey("hr")) tempSchedule->_padding[1] = ((int)root["hr"]) ? 1 : 0;
	if(root.containsKey("sp")) tempSchedule->_padding[2] = ((int)root["sp"]) ? 1 : 0;
	tempSchedule->_padding[3] = 0;

	DBG_PRINTF("Load finished, st:%ld, unit:%c, _numberOfSteps:%d\n",(long)tempSchedule->startDay,
	tempSchedule->unit,tempSchedule->numberOfSteps);

	return true;
}

String Y2TSettings::jsonBeerProfile(void)
{

	#if ARDUINOJSON_VERSION_MAJOR == 6
		DynamicJsonDocument root(2048);
	#else
 	const int PROFILE_JSON_BUFFER_SIZE = JSON_ARRAY_SIZE(15) + 7*JSON_OBJECT_SIZE(2) + JSON_OBJECT_SIZE(3) + 3*JSON_OBJECT_SIZE(4) + 5*JSON_OBJECT_SIZE(6);
	DynamicJsonBuffer jsonBuffer(PROFILE_JSON_BUFFER_SIZE);
	JsonObject& root = jsonBuffer.createObject();
	#endif

	BeerTempSchedule *tempSchedule = & _data.tempSchedule;

	//start date
	//ISO time:
	//2016-07-01T05:22:33.351Z

	root["s"]=tempSchedule->startDay;
	// unit, unfortunatly, no "char" type in JSON. "char" will be integer.
	//root["u"]=(char)tempSchedule->unit;
	char unitBuffer[2];
	unitBuffer[0]=tempSchedule->unit;
	unitBuffer[1]='\0';
	root["u"]=unitBuffer;
	root["tg"] = tempSchedule->_padding[0] ? "f" : "b";
	root["hr"] = tempSchedule->_padding[1] ? 1 : 0;
	root["sp"] = tempSchedule->_padding[2] ? 1 : 0;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	JsonArray steps=root.createNestedArray("t");
	#else
	JsonArray& steps=root.createNestedArray("t");
	#endif

	char conditionBuf[MaximumSteps][4];
	char pertages[MaximumSteps][16];
	int  pertageIndex=0;

	if(tempSchedule->numberOfSteps <= MaximumSteps)
	for(int i=0;i< tempSchedule->numberOfSteps;i++){
		ScheduleStep *s_step= & tempSchedule->steps[i];
		#if ARDUINOJSON_VERSION_MAJOR == 6
		JsonObject jstep = steps.createNestedObject();
		#else
		JsonObject& jstep = steps.createNestedObject();
		#endif
		// condition
		//jstep["c"] =(char) s_step->condition;
		sprintf(conditionBuf[i],"%c", s_step->condition);
		jstep["c"] = conditionBuf[i];
		// days
		jstep["d"] =ScheduleDayToJson(s_step->days);
		// temp.
		if( s_step->condition != 'r' ){ // not rampping
			jstep["t"]= ScheduleTempToJson(s_step->temp);
		}
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
		if(strchr("gaobxwe",s_step->condition)){ 
			// gravity
			if(s_step->attSpecified){
				
				sprintf(pertages[pertageIndex],"%d%%",s_step->gravity.attenuation);
				jstep["g"]= pertages[pertageIndex];
				pertageIndex++;
			}else{
				DBG_PRINTF("  sg:%d \n",s_step->gravity.sg);
				if(_data.gdc.usePlato){
					jstep["g"]= GravityToPlato(s_step->gravity.sg);
					#if SerialDebug
					Serial.print("SG:");
					Serial.println(GravityToPlato(s_step->gravity.sg));
					#endif
				}else{
					jstep["g"]= GravityToSG(s_step->gravity.sg);
				}
			}
		}
		if(strchr("suvbxwe",s_step->condition)){ 
			// stable.
			jstep["s"]= s_step->stable.stableTime;
			jstep["x"]= s_step->stable.stablePoint;
		}
	}// end of for
	
	String ret;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif

    return ret;
}


static void writeStandby(uint8_t* pad, int slot, int16_t t){
	memcpy(pad + slot, &t, 2);
	pad[4] = (uint8_t)(pad[4] | (slot == 0 ? 0x01 : 0x02));
}
static bool readStandby(const uint8_t* pad, int slot, int16_t* out){
	if((pad[4] & (slot == 0 ? 0x01 : 0x02)) == 0) return false;
	memcpy(out, pad + slot, 2);
	return true;
}
void Y2TSettings::setStandbyBeer(int16_t t){ writeStandby(_data.brewStatus._padding, 0, t); }
void Y2TSettings::setStandbyFridge(int16_t t){ writeStandby(_data.brewStatus._padding, 2, t); }
bool Y2TSettings::standbyBeer(int16_t* out){ return readStandby(_data.brewStatus._padding, 0, out); }
bool Y2TSettings::standbyFridge(int16_t* out){ return readStandby(_data.brewStatus._padding, 2, out); }

bool Y2TSettings::logFileIndexesSanity(void){
	FileIndexes* info= & _data.logFileIndexes;
	if(strlen(info->logname) > MaximumLogFileName){
		defaultLogFileIndexes();
		return false;
	}
	
	for(int i=0;i<MAX_LOG_FILE_NUMBER;i++){
		if(info->files[i].name[0] == 0) break;
		if(strlen(info->files[i].name) > MaximumLogFileName){
			defaultLogFileIndexes();
			return false;
		}
	}
	return true;
}

//***************************************************************
// Remote data logging

bool Y2TSettings::remoteLoggingSanity(void){
	RemoteLoggingInformation* info = & _data.remoteLogginInfo;
	if(info->service > 3){
		defaultRemoteLogging();
		return false;
	}
	if(strlen(info->url) > MaximumUrlLength
		|| strlen(info->format) > MaximumFormatLength
		|| strlen(info->contentType)> MaximumContentTypeLength){

		defaultRemoteLogging();
		return false;
	}
	return true;
}

void Y2TSettings::defaultRemoteLogging(void)
{
	RemoteLoggingInformation* info = & _data.remoteLogginInfo;
	info->enabled=0;
	info->url[0]='\0';
	info->format[0]='\0';
	info->contentType[0]='\0';
	info->service =0;
}

bool Y2TSettings::dejsonRemoteLogging(String json)
{

	RemoteLoggingInformation *logInfo = remoteLogInfo();
	logInfo->enabled=false;

#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(JSON_OBJECT_SIZE(10)+ json.length());
	auto error = deserializeJson(root,json);
	if(error
#else
	const int GSLOG_JSON_BUFFER_SIZE = JSON_OBJECT_SIZE(10);
	DynamicJsonBuffer jsonBuffer(GSLOG_JSON_BUFFER_SIZE);
	JsonObject& root = jsonBuffer.parseObject(json.c_str());

	if(!root.success()
#endif	
		|| !root.containsKey("enabled")
		|| !root.containsKey("format")
		|| !root.containsKey("url")
		|| !root.containsKey("type")
		|| !root.containsKey("method")
		|| !root.containsKey("period")){
#if ARDUINOJSON_VERSION_MAJOR == 6	
		DBG_PRINTF("dejsonRemoteLogging error:%s",error.c_str());
#endif
		return false;
	}

	const char *url=root["url"];
	const char *method=root["method"];
	const char *format=root["format"];
	const char *contentType=root["type"];

	bool enabled= root["enabled"];
	uint32_t period = root["period"];
		
	if( enabled &&( url == NULL || method==NULL || format==NULL 
		|| strcmp(url,"") ==0 || strcmp(method,"") ==0 || strcmp(format,"") ==0)){
		DBG_PRINTF("Enable null service\n");
		return false;
	}

	if(strlen(url) >=MaximumUrlLength) return false;
	if(strlen(format) >= MaximumFormatLength) return false;
	if(strlen(contentType)>=MaximumContentTypeLength) return false;

	if(strcmp(method,"GET") ==0) logInfo->method = mHTTP_GET;
	else if(strcmp(method,"POST") ==0) logInfo->method = mHTTP_POST;
	else if(strcmp(method,"PUT") ==0)  logInfo->method = mHTTP_PUT;
	else return false;
	strcpy(logInfo->url,url);
	strcpy(logInfo->format,format);
	strcpy(logInfo->contentType,contentType);
	logInfo->period = period;
	logInfo->enabled = enabled;
	logInfo->service = root.containsKey("service")? root["service"]:0;

  	return true;
}

String Y2TSettings::jsonRemoteLogging(void)
{
	
#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(512);
#else
    const int GSLOG_JSON_BUFFER_SIZE = JSON_OBJECT_SIZE(10);
	DynamicJsonBuffer jsonBuffer(GSLOG_JSON_BUFFER_SIZE);
	JsonObject& root = jsonBuffer.createObject();
#endif

	RemoteLoggingInformation *logInfo = remoteLogInfo();
	root["enabled"] = logInfo->enabled;
	root["period"] = logInfo->period;
	root["service"] = logInfo->service;

	if(logInfo->method ==mHTTP_GET) root["method"]="GET";
	else if(logInfo->method ==mHTTP_PUT) root["method"]="PUT";
	else if(logInfo->method ==mHTTP_POST) root["method"]="POST";

	root["url"]=(logInfo->url)? logInfo->url:"";
	root["format"]=(logInfo->format)? logInfo->format:"";
	root["type"]=(logInfo->contentType)? logInfo->contentType:"";

	String ret;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif
    return ret;
}

//***************************************************************
// parasite control
#if EanbleParasiteTempControl
#define EnableKey "enabled"
#define SetTempKey "temp"
#define TrigerTempKey "stemp"
#define MinCoolKey "mincool"
#define MinIdleKey "minidle"


void Y2TSettings::defaultParasiteTempControlSettings(void)
{
	ParasiteTempControlSettings *ps=parasiteTempControlSettings();
    ps->minIdleTime = 300 * 1000;
    ps->minCoolingTime = 300 * 1000;
    ps->setTemp = 0;
    ps->maxIdleTemp = 4;
}

bool Y2TSettings::dejsonParasiteTempControlSettings(String json){
#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(JSON_OBJECT_SIZE(10) + json.length());
	auto error = deserializeJson(root,json);
	if(error
#else
    DynamicJsonBuffer jsonBuffer(JSON_OBJECT_SIZE(10));
	JsonObject& root = jsonBuffer.parseObject(json.c_str());
	if(!root.success()
#endif
		|| !root.containsKey(SetTempKey)
		|| !root.containsKey(TrigerTempKey)
		|| !root.containsKey(MinCoolKey)
		|| !root.containsKey(MinIdleKey)){
            return false;
        }
	ParasiteTempControlSettings *ps=parasiteTempControlSettings();

    float n_setTemp = root[SetTempKey];
    float n_maxIdleTemp = root[TrigerTempKey];
    uint32_t n_mincool=root[MinCoolKey] ;
    uint32_t n_minidle= root[MinIdleKey];

    ps->minIdleTime = n_minidle * 1000;
    ps->minCoolingTime = n_mincool * 1000;
    ps->setTemp = n_setTemp;
    ps->maxIdleTemp = n_maxIdleTemp;

    return true;
}

String Y2TSettings::jsonParasiteTempControlSettings(bool enabled){
    // using string operation for simpler action?
    const int BUFFER_SIZE = 2*JSON_ARRAY_SIZE(6) + JSON_OBJECT_SIZE(9);

	#if ARDUINOJSON_VERSION_MAJOR == 6
		DynamicJsonDocument root(BUFFER_SIZE + 512);
	#else

    StaticJsonBuffer<BUFFER_SIZE> jsonBuffer;
    JsonObject& root = jsonBuffer.createObject();
	#endif

    root[EnableKey]= enabled;
    
	ParasiteTempControlSettings *ps=parasiteTempControlSettings();

    root[SetTempKey]=ps->setTemp ;
    root[TrigerTempKey] =ps->maxIdleTemp;
    root[MinCoolKey] = ps->minCoolingTime /  1000;
    root[MinIdleKey]=  ps->minIdleTime / 1000;
    String ret;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif
    return ret;
}


#endif
//***************************************************************
// pressure control
#if SupportPressureTransducer
#define PressureMonitorModeKey "mode"
#define ConversionAKey "a"
#define ConversionBKey "b"
#define AdcTypeKey "adc"
#define GainKey "gn"

bool Y2TSettings::dejsonPressureMonitorSettings(String json){

#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(JSON_OBJECT_SIZE(10) + json.length());
	auto error = deserializeJson(root,json);
	if(error
#else

    DynamicJsonBuffer jsonBuffer(JSON_OBJECT_SIZE(10));
	JsonObject& root = jsonBuffer.parseObject(json.c_str());
	DBG_PRINTF("PM json:\"%s\"\n",json.c_str());
	DBG_PRINTF("success:%d\n",root.success());
	if(!root.success()
#endif
		|| !root.containsKey(PressureMonitorModeKey)
		|| !root.containsKey(ConversionAKey)
		|| !root.containsKey(AdcTypeKey)
		|| !root.containsKey(ConversionBKey)){
            return false;
        }
	PressureMonitorSettings *settings=pressureMonitorSettings();
	settings->mode = root[PressureMonitorModeKey];
	settings->fa = root[ConversionAKey];
	settings->fb = root[ConversionBKey];
	settings->adc_type = root[AdcTypeKey];
	settings->adc_gain = root[GainKey];
	if(root.containsKey("psi")) settings->psi = root["psi"];
	return true;
}

String Y2TSettings::jsonPressureMonitorSettings(void){
    const int BUFFER_SIZE = JSON_OBJECT_SIZE(9);

	#if ARDUINOJSON_VERSION_MAJOR == 6
	
	DynamicJsonDocument root(BUFFER_SIZE +512);
	
	#else

    StaticJsonBuffer<BUFFER_SIZE> jsonBuffer;
    JsonObject& root = jsonBuffer.createObject();
	#endif

	PressureMonitorSettings *settings=pressureMonitorSettings();
	root[PressureMonitorModeKey]=settings->mode;
	root[ConversionAKey]=settings->fa;
	root[ConversionBKey]=settings->fb;
	root[AdcTypeKey] = settings->adc_type;
	root[GainKey] =	settings->adc_gain;
	root["psi"] = settings->psi;

    String ret;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif
    return ret;

}
#endif
//***************************************************************
// MQTT control
#if SupportMqttRemoteControl
#define EnableRemoteControlKey "enabled"
#define ServerAddressKey "server"
#define ServerPort "port"
#define MqttUsernameKey "user"
#define MqttPasswordKey "pass"

#define ModePathKey "mode"
#define BeerSetPathKey "beerset"
#define FridgeSetPathKey "fridgeset"
#define PtcPathKey "ptc"
#define CapPathKey "cap"

#define MqttLoggingKey "log"
#define MqttLogPeriodKey "period"
#define ReportBasePathKey "base"
#define MqttReportFormatKey "format"

void Y2TSettings::defaultMqttSetting(void){
	MqttRemoteControlSettings *settings=mqttRemoteControlSettings();
	settings->mode = MqttModeOff;
	settings->reportFormat=MqttReportIndividual;
	settings->serverOffset =0;
	settings->usernameOffset =0;
	settings->passwordOffset=0;
	settings->modePathOffset=0;
	settings->beerSetPathOffset=0;
	settings->capControlPathOffset=0;
	settings->ptcPathOffset=0;
	settings->fridgeSetPathOffset=0;
	settings->reportBasePathOffset=0;
	settings->open=0;
}

bool Y2TSettings::mqttSettingSanity(void){
	MqttRemoteControlSettings *settings=mqttRemoteControlSettings();
	if(settings->mode > 3
		|| settings->reportFormat > 1){
		defaultMqttSetting();
		return false;
	}
	if(settings->serverOffset > MqttSettingStringSpace
		|| settings->usernameOffset > MqttSettingStringSpace
		|| settings->passwordOffset > MqttSettingStringSpace
		|| settings->modePathOffset > MqttSettingStringSpace
		|| settings->beerSetPathOffset > MqttSettingStringSpace
		|| settings->capControlPathOffset > MqttSettingStringSpace
		|| settings->ptcPathOffset > MqttSettingStringSpace
		|| settings->fridgeSetPathOffset > MqttSettingStringSpace
		|| settings->reportBasePathOffset > MqttSettingStringSpace){
			defaultMqttSetting();
			return false;
		}

	return true;
}

String Y2TSettings::jsonMqttRemoteControlSettings(void){

	#if ARDUINOJSON_VERSION_MAJOR == 6
		DynamicJsonDocument root(1024);
	#else
    const int BUFFER_SIZE = JSON_OBJECT_SIZE(12);

    DynamicJsonBuffer jsonBuffer(BUFFER_SIZE);
    JsonObject& root = jsonBuffer.createObject();
	#endif
	MqttRemoteControlSettings *settings=mqttRemoteControlSettings();
	
	root[EnableRemoteControlKey] = (settings->mode == MqttModeControl || settings->mode == MqttModeBothControlLoggging)? 1:0;
	root[ServerPort] =  settings->port;

	root[MqttLoggingKey] =  (settings->mode == MqttModeLogging || settings->mode == MqttModeBothControlLoggging)? 1:0;
	root[MqttLogPeriodKey] = settings->reportPeriod;
	root[MqttReportFormatKey] = settings->reportFormat;
	root["open"] = settings->open ? 1 : 0;

	if(settings->reportBasePathOffset){
		char* base=(char*) (settings->_strings + settings->reportBasePathOffset);
		DBG_PRINTF("base path:%s offset:%d\n",base, settings->reportBasePathOffset);
		root[ReportBasePathKey] =base;
	}

	if(settings->modePathOffset){
		char* modepath=(char*) (settings->_strings + settings->modePathOffset);
		DBG_PRINTF("mode path:%s offset:%d\n",modepath, settings->modePathOffset);
		root[ModePathKey] =modepath;
	}

	if(settings->beerSetPathOffset){
		char* setpath=(char*) (settings->_strings + settings->beerSetPathOffset);
		DBG_PRINTF("beerSet path:%s offset:%d\n",setpath, settings->beerSetPathOffset);
		root[BeerSetPathKey] = setpath;
	}

	if(settings->fridgeSetPathOffset){
		char* setpath=(char*) (settings->_strings + settings->fridgeSetPathOffset);
		DBG_PRINTF("fridgeSet path:%s offset:%d\n",setpath, settings->fridgeSetPathOffset);
		root[FridgeSetPathKey] = setpath;
	}


#if	EanbleParasiteTempControl
	if(settings->ptcPathOffset){
		root[PtcPathKey] = settings->_strings + settings->ptcPathOffset;
	}
#endif

#if AUTO_CAP
	if(settings->capControlPathOffset){
		root[CapPathKey] = settings->_strings + settings->capControlPathOffset;
	}
#endif

	if(settings->serverOffset){
		root[ServerAddressKey] =(char*) (settings->_strings + settings->serverOffset);
	}

	if(settings->usernameOffset){
		root[MqttUsernameKey] =(char*)(settings->_strings + settings->usernameOffset);
	}

	if(settings->passwordOffset){
		root[MqttPasswordKey] =(char*) (settings->_strings + settings->passwordOffset);
	}

    String ret;
	#if ARDUINOJSON_VERSION_MAJOR == 6
	serializeJson(root,ret);
	#else
    root.printTo(ret);
	#endif

	DBG_PRINTF("json:--\n%s\n--\n",ret.c_str());
    return ret;

}
#if ARDUINOJSON_VERSION_MAJOR == 6
static char *copyIfExist(JsonDocument &root,const char* key,uint16_t &offset,char* ptr,char* base){
#else
static char *copyIfExist(JsonObject& root,const char* key,uint16_t &offset,char* ptr,char* base){
#endif
	if(root.containsKey(key)){
		const char* str=root[key];
		size_t length = strlen(str) +1;
		if(length==1){
			offset =0;
			return ptr;
		} 


		if(ptr - base  +length > MqttSettingStringSpace ) return NULL;
		strcpy(ptr,str);
		offset = (uint16_t)(ptr - base);

		size_t rto4= (length & 0x3)? ((length & ~0x3) + 4):length;
		ptr += rto4;

		DBG_PRINTF("mqtt set:%s offset:%d, length:%d, ptr inc:%d\n",key,offset,length,rto4);
	}

	return ptr;
}

bool Y2TSettings::dejsonMqttRemoteControlSettings(String json){

#if ARDUINOJSON_VERSION_MAJOR == 6
	DynamicJsonDocument root(JSON_OBJECT_SIZE(15) +json.length());
	auto error = deserializeJson(root,json);
	if(error
#else

    DynamicJsonBuffer jsonBuffer(JSON_OBJECT_SIZE(10));
	JsonObject& root = jsonBuffer.parseObject(json.c_str());
	if(!root.success()
#endif
		|| !root.containsKey(EnableRemoteControlKey)
		|| !root.containsKey(ServerPort)){

#if ARDUINOJSON_VERSION_MAJOR == 6	
		DBG_PRINTF("dejsonMqttRemoteControlSettings error:%s",error.c_str());
#endif

        return false;
    }
	MqttRemoteControlSettings *settings=mqttRemoteControlSettings();

	memset((char*)settings,'\0',sizeof(MqttRemoteControlSettings));

	bool rc=root[EnableRemoteControlKey];
	if(!root.containsKey(MqttLoggingKey)){
		settings->mode= rc? MqttModeControl:MqttModeOff;
		// everything else is "cleared" by memset to zero
	}else{
		bool log=root[MqttLoggingKey];
		settings->mode= (rc && log)? MqttModeBothControlLoggging:
						( rc? MqttModeControl:
							( log? MqttModeLogging:MqttModeOff));		
		settings->reportPeriod=root[MqttLogPeriodKey];
		settings->reportFormat=root[MqttReportFormatKey];
	}
	settings->open = root.containsKey("open") ? (root["open"] ? 1 : 0) : 0;



	settings->port=root[ServerPort];

	char *base=(char*) settings->_strings;
	char *ptr=base +4;

	if(!(ptr=copyIfExist(root,ServerAddressKey,settings->serverOffset,ptr,base))) return false;
	if(!(ptr=copyIfExist(root,MqttUsernameKey,settings->usernameOffset,ptr,base))) return false;
	if(!(ptr=copyIfExist(root,MqttPasswordKey,settings->passwordOffset,ptr,base))) return false;
	if(!(ptr=copyIfExist(root,ModePathKey,settings->modePathOffset,ptr,base))) return false;
	if(!(ptr=copyIfExist(root,BeerSetPathKey,settings->beerSetPathOffset,ptr,base))) return false;
	if(!(ptr=copyIfExist(root,FridgeSetPathKey,settings->fridgeSetPathOffset,ptr,base))) return false;

	if(!(ptr=copyIfExist(root,ReportBasePathKey,settings->reportBasePathOffset,ptr,base))) return false;

	#if	EanbleParasiteTempControl
	if(!(ptr=copyIfExist(root,PtcPathKey,settings->ptcPathOffset,ptr,base))) return false;
	#endif

	#if AUTO_CAP
	if(!(ptr=copyIfExist(root,CapPathKey,settings->capControlPathOffset,ptr,base))) return false;
	#endif

	return true;
}

#endif



#if EnableHumidityControlSupport

void Y2TSettings::defaultHumidityControlSettings(void){

}

#endif
