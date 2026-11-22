#ifndef Y2TSettings_H
#define Y2TSettings_H
#include <FS.h>
#include <time.h>
#include "Config.h"

#define SCALE_LEGACY_COUNT 2
#define SCALE_COUNT 8
#define SCALE_NAME_LENGTH 24
#define SCALE_KEG_NAME_LENGTH 32
#define SCALE_DEFAULT_CAL_LIMIT_COUNTS 1000
#define SCALE_MAX_CAL_LIMIT_COUNTS 8388607
#define SCALE_DEFAULT_DAILY_MINUTE 480
#define SCALE_DEFAULT_RETENTION_DAYS 90
#define SCALE_MAX_RETENTION_DAYS 365
#define SCALE_DEFAULT_SAMPLE_MINUTES 2
#define SCALE_MAX_SAMPLE_MINUTES 120
#define SCALE_DEFAULT_SAMPLE_HOURS 24
#define SCALE_MAX_SAMPLE_HOURS 72

typedef struct _ScaleDeviceSettings {
    char name[SCALE_NAME_LENGTH];
    char kegName[SCALE_KEG_NAME_LENGTH];
    int8_t doutPin;
    int8_t clockPin;
    uint8_t configured;
    uint8_t calibrated;
    int32_t zeroOffset;
    float calibrationFactor;
    float emptyKegGrams;
    uint16_t capacityMl;
    float beerDensityKgPerL;
} ScaleDeviceSettings;

typedef struct _ScaleSettings {
    uint8_t useScale;
    uint16_t retentionDays;
    uint16_t eventThresholdGrams;
    uint16_t maxPourMl;
    ScaleDeviceSettings devices[SCALE_LEGACY_COUNT];
    // Fields below are appended in order; files saved before each of them are migrated by size in Y2TSettings::load().
    int32_t calibrationLimitCounts[SCALE_LEGACY_COUNT];
    uint16_t dailyMinute;
    // Extra slots stay after the original two-scale file so an older /bpl.cfg still lines up.
    ScaleDeviceSettings extraDevices[SCALE_COUNT - SCALE_LEGACY_COUNT];
    int32_t extraCalibrationLimitCounts[SCALE_COUNT - SCALE_LEGACY_COUNT];
    // Files saved before these fields are migrated by size in Y2TSettings::load().
    uint16_t sampleMinutes;                // 1..SCALE_MAX_SAMPLE_MINUTES
    uint16_t sampleHours;                  // 1..SCALE_MAX_SAMPLE_HOURS
    float tempCorrection[SCALE_COUNT][4];  // c0..c3, raw counts, t in °C; all zero = no correction
} ScaleSettings;

inline ScaleDeviceSettings& scaleSlot(ScaleSettings& settings, uint8_t id) {
    return id < SCALE_LEGACY_COUNT ? settings.devices[id] : settings.extraDevices[id - SCALE_LEGACY_COUNT];
}
inline const ScaleDeviceSettings& scaleSlot(const ScaleSettings& settings, uint8_t id) {
    return id < SCALE_LEGACY_COUNT ? settings.devices[id] : settings.extraDevices[id - SCALE_LEGACY_COUNT];
}
inline int32_t& scaleCalLimit(ScaleSettings& settings, uint8_t id) {
    return id < SCALE_LEGACY_COUNT ? settings.calibrationLimitCounts[id] : settings.extraCalibrationLimitCounts[id - SCALE_LEGACY_COUNT];
}
inline const int32_t& scaleCalLimit(const ScaleSettings& settings, uint8_t id) {
    return id < SCALE_LEGACY_COUNT ? settings.calibrationLimitCounts[id] : settings.extraCalibrationLimitCounts[id - SCALE_LEGACY_COUNT];
}

//*****************************************************
// 264 bytes
#define DEFAULT_DUCKDNS_DOMAIN ""
#define DEFAULT_DUCKDNS_TOKEN ""
// Wi-Fi tried on first boot (empty settings); if it fails the device opens its own AP.
#define DEFAULT_WIFI_SSID ""
#define DEFAULT_WIFI_PASSWORD ""
// Soft-AP key used until the user sets their own; independent of the web login.
#define DEFAULT_AP_PASSWORD "yeast2tap"
typedef struct _SystemConfiguration{
    char  username[32];
    char  password[32];
    char  hostnetworkname[32];
    char  titlelabel[32];
    uint32_t  backlite;
    uint32_t  ip;
    uint32_t  gw;
    uint32_t  netmask;
    uint16_t  port;
    uint8_t passwordLcd;
    uint8_t wifiMode;
    uint32_t dns;
    uint8_t  displayMode;
    uint8_t glycolChilling;
    uint8_t securedAp;
    uint8_t _padding;
    char duckdnsDomain[64];
    char duckdnsToken[64];
    uint16_t duckdnsInterval;
    uint8_t duckdnsEnabled;
    uint8_t theme;
}SystemConfiguration;

//*****************************************************
// time information
// 12
typedef struct _TimeInformation{
    uint32_t savedTime;
    uint32_t timezoneoffset;
    uint8_t _padding[4];
} TimeInformation;

//*****************************************************
// gravity device
//  36
#define GravityDeviceNone 0
#define GravityDeviceIspindel 1
#define GravityDeviceTilt 2
#define GravityDevicePill 3
#define MaxDeviceTypeNumber 3


#define SGFromSetting(a)  ((float)(a) /10000.0)
#define SGToSetting(a)   ((uint16_t)(((a) * 10000.0) + 0.5))

#define PlatoFromSetting(a)  ((float)(a) /100.0)
#define PlatoToSetting(a)   ((uint16_t)(((a) * 100.0)+0.5))

#define AngleFromSetting(a)  ((float)(a) /100.0)
#define AngleToSetting(a)   ((uint16_t)(((a) * 100.0) + 0.5))
#define MaxNumberCalibrationPoints 10

typedef  struct _CalibrationPoint{
        uint16_t raw;
        uint16_t calsg;
} CalibrationPoint;

/*
 * What the four tiltCorrectionCoeff numbers describe.
 *
 * The same array is used by two mutually exclusive paths: with calbybpl=1 the
 * firmware derives gravity from the tilt angle, so the coefficients correct the
 * angle (degrees); with calbybpl=0 the device reports SG itself and the
 * coefficients correct that SG against the beer temperature. The numbers mean
 * completely different things in the two cases, so storing which one is in use
 * stops a config written for one mode from being applied in the other.
 *
 * TTCE_UNIT_UNKNOWN is what a file written before this field existed reads as
 * (the byte was padding, hence zero). It is resolved from calbybpl on load.
 */
#define TTCE_UNIT_UNKNOWN 0
#define TTCE_UNIT_SG      1   // coefficients over beer temperature, SG/Plato domain
#define TTCE_UNIT_TILT    2   // coefficients over the tilt angle in degrees


typedef struct _GravityDeviceConfiguration{
    float   tiltCorrectionCoeff[4];
    float   gravityFormulaCoeff[4];
    CalibrationPoint calPoints[MaxNumberCalibrationPoints];

    float   lpfBeta;
	float   offset;
    
    uint8_t  gravityDeviceType;
    uint8_t  calbybpl;
    uint8_t  numCalPoints;
	uint8_t  stableThreshold;

	uint8_t  usePlato;
    uint8_t  tempCorrection;
    // Unit of tiltCorrectionCoeff. Reuses one padding byte, so the settings file
    // keeps its size and no migration is needed.
    uint8_t  ttceUnit;
    uint8_t  _padding[17];

}GravityDeviceConfiguration;


#if SupportBleHydrometer

typedef struct _TiltConfiguratoin{
    uint8_t  tiltColor;
    uint8_t  _padding[10];
} TiltConfiguration;

typedef struct _PillConfiguratoin{
    uint8_t  macAddress[6];
    uint8_t  _padding[5];
} PillConfiguration;

typedef union _BleHydrometerConfiguration{
    TiltConfiguration tilt;
    PillConfiguration pill;
}BleHydrometerConfiguration;

#endif
//*****************************************************
// Beer Profile

// 
#define InvalidStableThreshold 0xFF
#define MaximumSteps 10
// datys are encoded by *100
#define ScheduleDayFromJson(d)  ((uint16_t) ((d) * 100.0))
#define ScheduleDayToJson(d)  ((float)(d)/100.0)
#define ScheduleDayToTime(d) ((uint32_t)(d) * 864) //((uint32_t)((float)(d)/100.0 * 86400))
#define ScheduleTempFromJson(t) ((int16_t)((t)*100.0))
#define ScheduleTempToJson(t) ((float)(t)/100.0)

#define ScheduleTemp(t) ((float)t/100.0)
typedef int16_t Gravity;

#define INVALID_GRAVITY -1
#define IsGravityValid(g) ((g)>0)

#define PointToGravity(p) (1000+(Gravity)((p)+0.5))

#define PlatoToGravity(p) ((uint16_t)((p)*10.0 + 0.5))
#define SGToGravity(p) ((uint16_t)((p)*1000.0 + 0.5))
#define GravityToSG(g) (((float)(g) / 1000.0))
#define GravityToPlato(g) (((float)(g) / 10.0))

// 12
typedef struct _ScheduleStep{
    int16_t   temp;
    uint16_t  days;
    union GravityT{
        uint16_t  sg;
        uint16_t  attenuation;
    } gravity;
    struct _StableT{
        uint8_t  stableTime;
        uint8_t  stablePoint;
    } stable;
    uint8_t  attSpecified;
    char     condition;
    uint8_t _padding[2];
} ScheduleStep; // 12bytes
// 12 * 10 +12 = 132
typedef struct _BeerTempSchedule{
	ScheduleStep steps[MaximumSteps];
	time_t   startDay;
    uint8_t  numberOfSteps;
    char     unit;
    // _padding[0] profile target: 0 beer (legacy), 1 fridge ramp
    // _padding[1] independent heater follows the profile: 0 no, 1 yes
    // _padding[2] start policy: 0 set start to now when the ramp mode is entered, 1 keep startDay
    // _padding[3] ramp finished and the final temperature was stored once
    uint8_t  _padding[6];
} BeerTempSchedule;

typedef struct _BrewStatus{
	time_t   startingDate;
	time_t   timeEnterCurrentStep;
	time_t   currentStepDuration;
	uint16_t  OGPoints;
	uint8_t  currentStep;
    // _padding[0..1] standby beer internal temp, [2..3] standby fridge, [4] bit0/bit1 valid
    uint8_t _padding[5];
}BrewStatus;

//*****************************************************
// Local logging
#define MAX_LOG_FILE_NUMBER 10

#define MaximumLogFileName 24

typedef struct _FileIndexEntry{
	char name[MaximumLogFileName];
	unsigned long time;
} FileIndexEntry;

typedef struct _FileIndexes
{
	FileIndexEntry files[MAX_LOG_FILE_NUMBER];
	char logname[MaximumLogFileName];
	unsigned long starttime;
    uint8_t writeOnBufferFull;
    uint8_t _padding[7];
} FileIndexes;

//*****************************************************
// Remote logging
#define MaximumContentTypeLength 48
#define MaximumUrlLength 128
#define MaximumFormatLength 256
#define mHTTP_GET 0 
#define mHTTP_POST 1
#define mHTTP_PUT 2 

typedef struct _RemoteLoggingInformation{
	char url[MaximumUrlLength];
	char format[MaximumFormatLength];
	char contentType[MaximumContentTypeLength];
	time_t period;
	uint8_t method;
	uint8_t enabled;
	uint8_t service;
    uint8_t _padding[2];
} RemoteLoggingInformation;


//*****************************************************
// Auto Cap

typedef struct _AutoCapSettings{
    union _condition{
        uint32_t targetTime;
        float    targetGravity;
    }condition;
    uint8_t autoCapMode;
    uint8_t _padding[7];
} AutoCapSettings;

//*****************************************************
// Parasite temp control
typedef struct _ParasiteTempControlSettings{
    float setTemp;
    float maxIdleTemp;
    uint32_t minCoolingTime;
    uint32_t minIdleTime;
    uint8_t _padding[4];
}ParasiteTempControlSettings;

//*****************************************************
// MQtt remote control
// too many strings. fixed allocation wastes too much.
// server, user, pass, 4x path = 128 * 7 
// Furthermore, ArduinoJson will modify the "source" buffer.
// so additional buffer is neede to decode.
// So let's store the strings in  a compact way 
#if SupportMqttRemoteControl

#define MqttModeOff 0
#define MqttModeControl 1
#define MqttModeLogging 2
#define MqttModeBothControlLoggging 3

#define MqttReportIndividual 0
#define MqttReportJson 1

#define MqttSettingStringSpace 320
typedef struct _MqttRemoteControlSettings{
    uint16_t port;
    uint8_t  mode;
    uint8_t  reportFormat;

    uint16_t  serverOffset;
    uint16_t  usernameOffset;
    uint16_t  passwordOffset;
    uint16_t  modePathOffset;
    uint16_t  beerSetPathOffset;
    uint16_t  capControlPathOffset;
    uint16_t  ptcPathOffset;
    uint16_t  fridgeSetPathOffset;

    uint16_t  reportBasePathOffset;
    uint16_t  reportPeriod;
    uint8_t   open;
    uint8_t   _padding2;

    uint8_t   _strings[MqttSettingStringSpace];
}MqttRemoteControlSettings;
#endif

//*****************************************************
// Pressure Sensor
#if SupportPressureTransducer
#define PMModeOff 0
#define PMModeMonitor 1
#define PMModeControl 2

#define TransducerADC_Internal 0
#define TransducerADC_ADS1115 1

typedef struct _PressureMonitorSettings{
    float fa;
    int16_t fb;
    uint8_t mode;
    uint8_t psi;
    uint8_t adc_type;
    uint8_t adc_gain;
    uint8_t _padding[7];
}PressureMonitorSettings;
#endif

#ifdef SaveWiFiConfiguration
typedef struct _WiFiConfiguration{
    char ssid[33];
    char pass[33];
    char _padding[30];
} WiFiConfiguration;
#endif

//####################################################
/* HumidityControl */
// 28 bytes

typedef struct _HumidityControlSettings{
    uint8_t  mode;
    uint8_t  target;
    uint8_t  idleLow;
    uint8_t  idleHigh;
    uint8_t  humidifyingTargetHigh;
    uint8_t  dehumidifyingTargetLow;
    uint8_t  _reserved0;
    uint8_t  _reserved1;

    uint16_t minHumidifyingIdleTime;
    uint16_t minHumidifyingRunningTime;
    uint16_t minDehumidifyingIdleTime;
    uint16_t minDehumidifyingRunningTime;
    uint16_t minDeadTime;
    uint8_t  _reserved2;
    uint8_t  _reserved3;

    uint8_t  _reserved4[8];
} HumidityControlSettings;


//####################################################
// whole structure
struct Settings{
    SystemConfiguration syscfg; //0:156
    TimeInformation  timeinfo; //156:12
    GravityDeviceConfiguration gdc;  //168:36
    BeerTempSchedule tempSchedule; // 204:96
    BrewStatus  brewStatus; // 300:20
    FileIndexes  logFileIndexes; // 320:316
    RemoteLoggingInformation remoteLogginInfo; // 636: 444
    AutoCapSettings autoCapSettings; // 1080: 12
    ParasiteTempControlSettings parasiteTempControlSettings; //1092: 20

#if SupportPressureTransducer
    PressureMonitorSettings pressureMonitorSettings; // 16
#endif
#if SupportMqttRemoteControl
    MqttRemoteControlSettings mqttRemoteControlSettings;
#endif
#ifdef SaveWiFiConfiguration
    WiFiConfiguration wifiConfiguration;
#endif
#if SupportBleHydrometer
    BleHydrometerConfiguration bleHydrometerConfiguration;
#endif
#if EnableHumidityControlSupport
    HumidityControlSettings humidityControl;
#endif
    ScaleSettings scale;

    // Appended after the scale block so an older /bpl.cfg still lines up byte
    // for byte: everything above keeps its offset, and these two come back as
    // zeroes from the memset when the file is shorter.
    char apPassword[32];     // soft-AP key, independent of the web login password
    // 0 = decide from the hydrometer name (see ExternalData::gravityMonDetected),
    // 1 = user says GravityMon, 2 = user says not GravityMon.
    uint8_t gravityMon;
    uint8_t _tailPadding[3];
};


class Y2TSettings
{
public:
    Y2TSettings(){}

    void load();
    void save();
    ScaleSettings* scaleSettings(void){ return &_data.scale; }
    String jsonScaleSettings(void);
    // `why` receives a short, non-localised reason when the settings are
    // rejected (e.g. "gpio 33 is reserved by the rotary encoder"), so the UI can
    // say what to fix instead of only "save failed".
    bool dejsonScaleSettings(String json, const char** why = NULL);
    void defaultScaleSettings(void);
    // system configuration
    SystemConfiguration* systemConfiguration();
    const char* themeName(void);
    bool setThemeName(const char* name);
    bool dejsonSystemConfiguration(String json);
    String jsonSystemConfiguration(bool redactSecrets = false);
    // time info
    TimeInformation* timeInformation(void){ return &_data.timeinfo;}
    // gravity device
    GravityDeviceConfiguration* GravityConfig(void){return &_data.gdc; }
    bool dejsonGravityConfig(char* json);
    String jsonGravityConfig(void);
    // beer profile
    BeerTempSchedule* beerTempSchedule(void){ return &_data.tempSchedule;}
    BrewStatus* brewStatus(void){ return &_data.brewStatus;}
    uint8_t profileTarget(void){ uint8_t v=_data.tempSchedule._padding[0]; return v>1?0:v; }
    void setProfileTarget(uint8_t v){ _data.tempSchedule._padding[0] = v ? 1 : 0; }
    uint8_t heaterRamp(void){ return _data.tempSchedule._padding[1] ? 1 : 0; }
    void setHeaterRamp(uint8_t v){ _data.tempSchedule._padding[1] = v ? 1 : 0; }
    uint8_t startPolicy(void){ return _data.tempSchedule._padding[2] ? 1 : 0; }
    void setStartPolicy(uint8_t v){ _data.tempSchedule._padding[2] = v ? 1 : 0; }
    uint8_t rampLatched(void){ return _data.tempSchedule._padding[3] ? 1 : 0; }
    void setRampLatched(uint8_t v){ _data.tempSchedule._padding[3] = v ? 1 : 0; }
    void setStandbyBeer(int16_t t);
    void setStandbyFridge(int16_t t);
    bool standbyBeer(int16_t* out);
    bool standbyFridge(int16_t* out);
    bool dejsonBeerProfile(String json);
    String jsonBeerProfile(void);

    // local log
    FileIndexes* logFileIndexes(void){ return &_data.logFileIndexes; }

    // Remote logging
    RemoteLoggingInformation *remoteLogInfo(void){return &_data.remoteLogginInfo;}
    bool dejsonRemoteLogging(String json);
    String jsonRemoteLogging(void);

    // autocap
    AutoCapSettings *autoCapSettings(void){ return &_data.autoCapSettings;}
    //ParasiteTempControlSettings
    ParasiteTempControlSettings *parasiteTempControlSettings(void){ return &_data.parasiteTempControlSettings;}
    bool dejsonParasiteTempControlSettings(String json);
    String jsonParasiteTempControlSettings(bool enabled);

    void preFormat(void);
    void postFormat(void);
    
#if SupportPressureTransducer
    //pressure monitor
    PressureMonitorSettings *pressureMonitorSettings(){return &_data.pressureMonitorSettings;}
    bool dejsonPressureMonitorSettings(String json);
    String jsonPressureMonitorSettings(void);
#endif

#if SupportMqttRemoteControl
    MqttRemoteControlSettings *mqttRemoteControlSettings(void){ return & _data.mqttRemoteControlSettings;}
    bool dejsonMqttRemoteControlSettings(String json);
    String jsonMqttRemoteControlSettings(void);
#endif

#ifdef SaveWiFiConfiguration
    WiFiConfiguration *getWifiConfiguration(void){ return &_data.wifiConfiguration;}
    void setWiFiConfiguration(const char* ssid,const char* pass){
        if(ssid) strcpy(_data.wifiConfiguration.ssid,ssid);
        else _data.wifiConfiguration.ssid[0]='\0';
        if(pass) strcpy(_data.wifiConfiguration.pass,pass);
        else _data.wifiConfiguration.pass[0]='\0';
    }
#endif

#if SupportTiltHydrometer
    TiltConfiguration* tiltConfiguration(void){ return & _data.bleHydrometerConfiguration.tilt;}
#endif
#if SupportPillHydrometer
    PillConfiguration* pillConfiguration(void){ return & _data.bleHydrometerConfiguration.pill;}
#endif


#if EnableHumidityControlSupport
    HumidityControlSettings* humidityControlSettings(void){ return & _data.humidityControl;}
#endif

    // Soft-AP key. Independent of SystemConfiguration::password (the web login);
    // DEFAULT_AP_PASSWORD is used until the user changes it.
    const char* apPassword(void){ return _data.apPassword; }
    bool setApPassword(const char* value);
    // GravityMon: 0 auto (from the hydrometer name), 1 on, 2 off.
    uint8_t gravityMon(void){ return _data.gravityMon; }
    void setGravityMon(uint8_t value){ _data.gravityMon = value; }

protected:
    Settings _data;

    void    setDefault(void);

    void defaultSystemConfiguration(void);
    void defaultTimeInformation(void);
    void defaultGravityConfig(void);
    void defaultBeerProfile(void);
    void defaultLogFileIndexes(void);
    void defaultRemoteLogging(void);
    void defaultAutoCapSettings(void);
#if EanbleParasiteTempControl   
    void defaultParasiteTempControlSettings(void);
#endif
#if EnableHumidityControlSupport
    void defaultHumidityControlSettings(void);
#endif
    void defaultMqttSetting(void);

    bool systemConfigurationSanity(void);
    bool timeInformationSanity(void);
    bool gravityConfigSantiy(void);
    bool beerProfileSanity(void);
    bool logFileIndexesSanity(void);
    bool remoteLoggingSanity(void);
    bool autoCapSettingsSanity(void);
#if EanbleParasiteTempControl   
    bool parasiteTempControlSettingsSanity(void);
#endif
#if EnableHumidityControlSupport
    bool humidityControlSettingsSanity(void);
#endif

    bool mqttSettingSanity(void);

};

extern Y2TSettings theSettings;
#endif //Y2TSettings_H
