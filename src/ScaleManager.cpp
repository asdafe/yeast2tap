#include <ArduinoJson.h>
#include <math.h>
#include <string.h>
#include "Y2TSettings.h"
#include "BrewPiProxy.h"
#include "ScaleManager.h"
#include "TemperatureFormats.h"
#include "TimeKeeper.h"
#if UseLittleFS
#include <LittleFS.h>
#else
#include <SPIFFS.h>
#endif

ScaleManager scaleManager;

namespace {
const char *DailyPath = "/scale_daily.log";
const char *DailyTempPath = "/scale_daily.tmp";
const char *DailyBackupPath = "/scale_daily.bak";
const char *const LegacyHistoryPaths[] = {"/scale.log", "/scale.tmp", "/scale.bak"};
const uint8_t ScaleReadCountCalibration = 30;
const uint32_t CalibrationTimeoutMs = 10000;
const uint32_t NoSignalMs = 2000;
const uint8_t MeasureAttempts = 3;
const uint32_t MeasureRetryMs = 5UL * 60UL * 1000UL;
const float KegChangeGrams = 2000.0f;
const int32_t RawSaturatedHigh = 0x7FFFFF;
const int32_t RawSaturatedLow = -0x800000;
enum ScaleState : uint8_t { Disabled = 0, NoKeg = 1, Settling = 2, Stable = 3, Measuring = 4, NoSignal = 5 };
#if defined(ESP32)
portMUX_TYPE readMux = portMUX_INITIALIZER_UNLOCKED;
// One recursive mutex for every /scale_daily.log rewrite and append: the web
// task clears/migrates while loop() samples and prunes. ESP8266 runs those from
// one cooperative loop, so nothing is needed there.
SemaphoreHandle_t dailyMutex = NULL;
#define DAILY_LOCK() do { if (dailyMutex) xSemaphoreTakeRecursive(dailyMutex, portMAX_DELAY); } while (0)
#define DAILY_UNLOCK() do { if (dailyMutex) xSemaphoreGiveRecursive(dailyMutex); } while (0)
#else
#define DAILY_LOCK() ((void)0)
#define DAILY_UNLOCK() ((void)0)
#endif
enum DailyFlag : uint8_t { FlagProvisional = 1, FlagKegChange = 2, FlagUnstable = 4, FlagNoKeg = 8, FlagSample = 32 };
const uint8_t DailyRecordVersion = 1;
const int32_t DailyRawUnknown = INT32_MIN;
const int16_t DailyTemperatureUnknown = INT16_MIN;
struct __attribute__((packed)) DailyRecord {
	uint32_t day;        // local calendar day number (local seconds / 86400)
	uint32_t time;       // UTC epoch of the measurement
	int32_t levelGrams;
	int32_t consumedGrams;
	uint8_t scaleId;
	uint8_t flags;
	uint8_t version;     // DailyRecordVersion; 0 means the 20-byte format below
	uint8_t reserved;
	int32_t rawCounts;          // raw HX711 counts of the measurement, DailyRawUnknown if not recorded
	int16_t temperatureDeciC;   // fridge temperature at the measurement, DailyTemperatureUnknown if invalid
};
// The format written before versioning. Its reserved field is always zero, which
// is how a file is recognised as legacy (version byte at the same offset).
struct __attribute__((packed)) LegacyDailyRecord {
	uint32_t day;
	uint32_t time;
	int32_t levelGrams;
	int32_t consumedGrams;
	uint8_t scaleId;
	uint8_t flags;
	uint16_t reserved;
};
static_assert(sizeof(DailyRecord) == 26, "daily record layout");
static_assert(sizeof(LegacyDailyRecord) == 20, "legacy daily record layout");

float clampValue(float value, float low, float high) {
	return value < low ? low : (value > high ? high : value);
}

float removedBelowGrams(const ScaleDeviceSettings &device) {
	return fmaxf(250.0f, device.emptyKegGrams * 0.5f);
}

bool hasFactor(const ScaleDeviceSettings &device) {
	return device.calibrated && fabsf(device.calibrationFactor) > 0.000001f;
}

// Fridge temperature in °C for records and the load-cell correction, whatever
// unit the UI displays. NAN when no valid reading exists.
float fridgeCelsius() {
	float t = (float)brewPi.getFridgeTemp();
	if (!IS_FLOAT_TEMP_VALID(t)) return NAN;
	return brewPi.getUnit() == 'F' ? (t - 32.0f) / 1.8f : t;
}

// Stored polynomial c0..c3 in raw counts over °C; all zero means no correction.
float correctionCounts(uint8_t id, float tempC) {
	if (isnan(tempC)) return 0.0f;
	const float *c = theSettings.scaleSettings()->tempCorrection[id];
	if (c[0] == 0.0f && c[1] == 0.0f && c[2] == 0.0f && c[3] == 0.0f) return 0.0f;
	float poly = c[0] + tempC * (c[1] + tempC * (c[2] + tempC * c[3]));
	// The correction is raw counts and cannot leave the HX711 24-bit range; a
	// non-finite or oversized value is bad coefficients (e.g. from an unchecked
	// config file) and would overflow lroundf()/int32 at the call sites.
	if (!isfinite(poly)) return 0.0f;
	return clampValue(poly, -8388608.0f, 8388607.0f);
}

bool localClock(uint32_t &day, uint16_t &minute) {
	if (!TimeKeeper.isSynchronized()) return false;
	uint32_t local = (uint32_t)TimeKeeper.getLocalTimeSeconds();
	day = local / 86400UL;
	minute = (uint16_t)((local % 86400UL) / 60UL);
	return true;
}

void sortCounts(int32_t *values, uint8_t count) {
	for (uint8_t i = 1; i < count; ++i) {
		int32_t value = values[i];
		int8_t j = i - 1;
		while (j >= 0 && values[j] > value) {
			values[j + 1] = values[j];
			--j;
		}
		values[j + 1] = value;
	}
}
}

void ScaleManager::begin() {
	memset(runtime_, 0, sizeof(runtime_));
	lastPruneDay_ = 0;
	for (const char *path : LegacyHistoryPaths)
		if (FileSystem.exists(path)) FileSystem.remove(path);
#if defined(ESP32)
	if (!dailyMutex) dailyMutex = xSemaphoreCreateRecursiveMutex();
#endif
	recoverDaily();
	configurationChanged();
}

void ScaleManager::configurationChanged() {
	ScaleSettings *settings = theSettings.scaleSettings();
	if (!settings->useScale) stopSampling();
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		Runtime &runtime = runtime_[id];
		const ScaleDeviceSettings &device = scaleSlot(*settings, id);
		bool active = settings->useScale && device.configured;
		// Keg, calibration and other label settings do not interrupt readings or a running measurement.
		if (active == runtime.active && (!active || (runtime.dataPin == device.doutPin && runtime.clockPin == device.clockPin))) continue;
		if (runtime.active) {
			digitalWrite(runtime.clockPin, LOW);
			pinMode(runtime.clockPin, INPUT);
			pinMode(runtime.dataPin, INPUT);
		}
		runtime.active = active;
		runtime.count = 0;
		runtime.next = 0;
		runtime.present = false;
		runtime.stable = false;
		runtime.calJob = CalIdle;
		runtime.calError = CalIdle;
		runtime.calErrorReason = CalReasonNone;
		runtime.calResult = CalIdle;
		runtime.calCount = 0;
		runtime.calSum = 0;
		runtime.calWeight = 0;
		runtime.measureJob = MeasureIdle;
		runtime.measureResult = MeasureNone;
		runtime.measureRecorded = 0;
		runtime.retryPending = false;
		runtime.blockCount = 0;
		runtime.blockIndex = 0;
		runtime.lastSampleMs = millis();
		runtime.state = runtime.active ? Settling : Disabled;
		if (!runtime.active) continue;
		runtime.dataPin = device.doutPin;
		runtime.clockPin = device.clockPin;
		pinMode(device.doutPin, INPUT);
		pinMode(device.clockPin, OUTPUT);
		digitalWrite(device.clockPin, LOW);
	}
}

bool ScaleManager::readRaw(uint8_t dataPin, uint8_t clockPin, int32_t& value) {
	if (digitalRead(dataPin) != LOW) return false;
	uint32_t raw = 0;
	// An interrupt that keeps SCK high for more than 60 us powers the HX711 down mid-read.
#if defined(ESP32)
	portENTER_CRITICAL(&readMux);
#else
	noInterrupts();
#endif
	for (uint8_t bit = 0; bit < 24; ++bit) {
		digitalWrite(clockPin, HIGH);
		delayMicroseconds(1);
		raw = (raw << 1) | (digitalRead(dataPin) ? 1U : 0U);
		digitalWrite(clockPin, LOW);
		delayMicroseconds(1);
	}
	// Select channel A, gain 128 for the next conversion.
	digitalWrite(clockPin, HIGH);
	delayMicroseconds(1);
	digitalWrite(clockPin, LOW);
#if defined(ESP32)
	portEXIT_CRITICAL(&readMux);
#else
	interrupts();
#endif
	if (raw & 0x800000UL) raw |= 0xFF000000UL;
	value = (int32_t)raw;
	return value != RawSaturatedHigh && value != RawSaturatedLow;
}

void ScaleManager::service(uint8_t id) {
	ScaleSettings *settings = theSettings.scaleSettings();
	ScaleDeviceSettings &device = scaleSlot(*settings, id);
	Runtime &runtime = runtime_[id];
	if (!settings->useScale || !runtime.active) return;

	uint32_t now = millis();
	if (runtime.calJob != CalIdle && (uint32_t)(now - runtime.calStartedMs) > CalibrationTimeoutMs) {
		failCalibration(id, CalReasonTimeout);
	}
	int32_t raw;
	if (!readRaw((uint8_t)device.doutPin, (uint8_t)device.clockPin, raw)) {
		if ((uint32_t)(now - runtime.lastSampleMs) > NoSignalMs) {
			runtime.stable = false;
			runtime.state = NoSignal;
			if (runtime.measureJob != MeasureIdle) finishMeasurement(id, MeasureNoSignal, false);
		}
		return;
	}
	runtime.lastSampleMs = now;
	runtime.latestRaw = raw;
	runtime.samples[runtime.next] = raw;
	runtime.next = (runtime.next + 1) % 8;
	if (runtime.count < 8) runtime.count++;
	if (runtime.calJob != CalIdle) {
		if (runtime.calCount == 0) {
			runtime.calMin = raw;
			runtime.calMax = raw;
			runtime.calFirst = raw;
		} else {
			runtime.calMin = min(runtime.calMin, raw);
			runtime.calMax = max(runtime.calMax, raw);
		}
		runtime.calSum += raw;
		int64_t deviation = (int64_t)raw - runtime.calFirst;
		runtime.calDevSum += deviation;
		runtime.calDevSq += deviation * deviation;
		if (runtime.calCount < 255) runtime.calCount++;
		if (runtime.calCount == ScaleReadCountCalibration / 2) runtime.calHalfSum = runtime.calSum;
		if (runtime.calCount >= ScaleReadCountCalibration) completeCalibration(id);
		runtime.stable = false;
		runtime.state = Settling;
		return;
	}
	if (runtime.measureJob != MeasureIdle) addMeasurementSample(id, raw);
	if (runtime.count < 8) {
		runtime.stable = false;
		runtime.state = runtime.measureJob != MeasureIdle ? Measuring : Settling;
		return;
	}

	// The live value is display-only; daily records come from the long measurement.
	int64_t total = 0;
	for (uint8_t i = 0; i < 8; ++i) total += runtime.samples[i];
	float netCounts = (float)(total / 8) + correctionCounts(id, fridgeCelsius()) - device.zeroOffset;
	float gross = hasFactor(device) ? netCounts / device.calibrationFactor : netCounts;
	runtime.grossGrams = clampValue(gross, -500.0f, 100000.0f);
	runtime.stable = true;
	runtime.present = !hasFactor(device) || runtime.grossGrams >= removedBelowGrams(device);
	if (runtime.measureJob != MeasureIdle) runtime.state = Measuring;
	else runtime.state = runtime.present ? Stable : NoKeg;
}

void ScaleManager::loop() {
	if (!theSettings.scaleSettings()->useScale) return;
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) service(id);
	schedule();
	sampleSchedule();
}

void ScaleManager::schedule() {
	ScaleSettings *settings = theSettings.scaleSettings();
	uint32_t today;
	uint16_t minute;
	if (!localClock(today, minute) || minute < settings->dailyMinute) return;
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		Runtime &runtime = runtime_[id];
		if (!runtime.active || !hasFactor(scaleSlot(*settings, id))) continue;
		if (runtime.lastFinalDay >= today || runtime.measureJob != MeasureIdle || runtime.calJob != CalIdle) continue;
		if (runtime.retryPending) {
			if ((int32_t)(millis() - runtime.retryAtMs) < 0) continue;
		} else {
			runtime.measureAttempt = 0;
		}
		if (startMeasurement(id, MeasureScheduled)) runtime.measureAttempt++;
	}
}

// One MeasureSample job per interval on every scale that can take it. The next
// epoch is advanced before any job is started, so a pass where no scale is free
// cannot fire again in a tight loop.
void ScaleManager::sampleSchedule() {
	if (!sampleActive_ || !TimeKeeper.isSynchronized()) return;
	uint32_t now = (uint32_t)TimeKeeper.getTimeSeconds();
	if (now >= sampleEndEpoch_) { sampleActive_ = false; return; }
	if (now < sampleNextEpoch_) return;
	sampleNextEpoch_ = now + (uint32_t)theSettings.scaleSettings()->sampleMinutes * 60UL;
	// startMeasurement refuses inactive, uncalibrated and busy slots; a scale in
	// the middle of another job simply misses this interval.
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) startMeasurement(id, MeasureSample);
}

bool ScaleManager::startMeasurement(uint8_t id, uint8_t job) {
	if (id >= SCALE_COUNT) return false;
	Runtime &runtime = runtime_[id];
	if (!runtime.active || runtime.measureJob != MeasureIdle || runtime.calJob != CalIdle) return false;
	if (!hasFactor(scaleSlot(*theSettings.scaleSettings(), id))) return false;
	runtime.measureJob = job;
	runtime.measureResult = MeasureNone;
	runtime.measureRecorded = 0;
	runtime.blockCount = 0;
	runtime.blockIndex = 0;
	runtime.state = Measuring;
	return true;
}

bool ScaleManager::measureNow(uint8_t id) {
	return startMeasurement(id, MeasureManual);
}

// startMeasurement already skips inactive, uncalibrated and busy slots.
uint8_t ScaleManager::measureAllNow() {
	uint8_t started = 0;
	for (uint8_t id = 0; id < SCALE_COUNT; ++id)
		if (startMeasurement(id, MeasureManual)) ++started;
	return started;
}

void ScaleManager::addMeasurementSample(uint8_t id, int32_t raw) {
	Runtime &runtime = runtime_[id];
	runtime.blockSamples[runtime.blockCount++] = raw;
	if (runtime.blockCount < MeasureBlockSamples) return;
	// Each block contributes its median, so single spikes do not move the result.
	sortCounts(runtime.blockSamples, MeasureBlockSamples);
	const uint8_t middle = MeasureBlockSamples / 2;
	runtime.blockValues[runtime.blockIndex++] = (int32_t)(((int64_t)runtime.blockSamples[middle - 1] + runtime.blockSamples[middle]) / 2);
	runtime.blockCount = 0;
	if (runtime.blockIndex >= MeasureBlocks) completeMeasurement(id);
}

void ScaleManager::completeMeasurement(uint8_t id) {
	Runtime &runtime = runtime_[id];
	ScaleSettings *settings = theSettings.scaleSettings();
	const ScaleDeviceSettings &device = scaleSlot(*settings, id);
	const uint8_t half = MeasureBlocks / 2;
	int64_t firstHalf = 0;
	int64_t secondHalf = 0;
	for (uint8_t i = 0; i < MeasureBlocks; ++i) {
		if (i < half) firstHalf += runtime.blockValues[i];
		else secondHalf += runtime.blockValues[i];
	}
	runtime.measureHalfDiff = (float)fabs((double)secondHalf / (MeasureBlocks - half) - (double)firstHalf / half);
	// Interquartile mean of the block medians.
	int32_t sorted[MeasureBlocks];
	memcpy(sorted, runtime.blockValues, sizeof(sorted));
	sortCounts(sorted, MeasureBlocks);
	const uint8_t quarter = MeasureBlocks / 4;
	int64_t middleTotal = 0;
	for (uint8_t i = quarter; i < MeasureBlocks - quarter; ++i) middleTotal += sorted[i];
	double counts = (double)middleTotal / (MeasureBlocks - 2 * quarter);
	runtime.measureRaw = (int32_t)lround(counts);
	// Raw counts stay uncorrected so a later re-fit stays valid; only grams are corrected.
	float corrected = (float)counts + correctionCounts(id, fridgeCelsius());
	runtime.measureGrams = (corrected - device.zeroOffset) / device.calibrationFactor;
	bool stable = runtime.measureHalfDiff <= scaleCalLimit(*settings, id);
	finishMeasurement(id, stable ? MeasureOk : MeasureUnstable, true);
}

void ScaleManager::finishMeasurement(uint8_t id, uint8_t result, bool hasValue) {
	Runtime &runtime = runtime_[id];
	uint8_t job = runtime.measureJob;
	runtime.measureJob = MeasureIdle;
	runtime.blockCount = 0;
	runtime.blockIndex = 0;
	runtime.measureResult = result;
	runtime.measureRecorded = 0;
	if (hasValue) runtime.measureTime = TimeKeeper.isSynchronized() ? (uint32_t)TimeKeeper.getTimeSeconds() : 0;
	uint32_t today;
	uint16_t minute;
	bool clock = localClock(today, minute);
	if (job == MeasureSample) {
		// A failed sample is dropped without retry; the next interval produces another.
		if (hasValue && clock)
			writeDailyRecord(id, today, runtime.measureGrams, FlagSample | (result == MeasureOk ? 0 : FlagUnstable), false, true);
		return;
	}
	if (job == MeasureScheduled) {
		if (result != MeasureOk && runtime.measureAttempt < MeasureAttempts) {
			runtime.retryPending = true;
			runtime.retryAtMs = millis() + MeasureRetryMs;
			return;
		}
		runtime.retryPending = false;
		if (!clock) return;
		if (hasValue) writeDailyRecord(id, today, runtime.measureGrams, result == MeasureOk ? 0 : FlagUnstable, true);
		else runtime.lastFinalDay = today; // no readings in any attempt: skip the day
		return;
	}
	if (!hasValue || !clock) return;
	// A manual reading belongs to the period that the next scheduled measurement closes.
	uint32_t day = runtime.lastFinalDay >= today ? today + 1 : today;
	writeDailyRecord(id, day, runtime.measureGrams, FlagProvisional | (result == MeasureOk ? 0 : FlagUnstable), false);
}

void ScaleManager::writeDailyRecord(uint8_t id, uint32_t day, float grams, uint8_t flags, bool final, bool append) {
	Runtime &runtime = runtime_[id];
	const ScaleDeviceSettings &device = scaleSlot(*theSettings.scaleSettings(), id);
	bool noKeg = grams < removedBelowGrams(device);
	bool kegChange = runtime.pendingKegChange || (runtime.hasLastFinal && !noKeg && grams - runtime.lastFinalGrams > KegChangeGrams);
	if (noKeg) flags |= FlagNoKeg;
	if (kegChange) flags |= FlagKegChange;
	DailyRecord record = {};
	record.day = day;
	record.time = (uint32_t)TimeKeeper.getTimeSeconds();
	record.levelGrams = (int32_t)lroundf(grams);
	// A sample row never carries consumption; the LogViewer derives nothing from it.
	record.consumedGrams = !append && runtime.hasLastFinal && !noKeg && !kegChange ? (int32_t)lroundf(runtime.lastFinalGrams - grams) : 0;
	record.scaleId = id;
	record.flags = flags;
	record.version = DailyRecordVersion;
	record.rawCounts = runtime.measureRaw;
	float fridgeC = fridgeCelsius();
	record.temperatureDeciC = isnan(fridgeC) ? DailyTemperatureUnknown : (int16_t)lroundf(fridgeC * 10.0f);

	DAILY_LOCK();
	File file = FileSystem.open(DailyPath, FileSystem.exists(DailyPath) ? "r+" : "w");
	if (!file) { DAILY_UNLOCK(); return; }
	if (append) {
		// A sample always appends; it never replaces the day's record and never
		// touches lastFinal*, pendingKegChange or the prune clock.
		file.seek(file.size());
		file.write((const uint8_t*)&record, sizeof(record));
		file.close();
		DAILY_UNLOCK();
		runtime.measureRecorded = 0;
		return;
	}
	DailyRecord existing;
	size_t position = 0;
	while (file.read((uint8_t*)&existing, sizeof(existing)) == sizeof(existing)) {
		// A legacy file that failed to migrate cannot be indexed with this record size.
		if (existing.version != DailyRecordVersion) { file.close(); DAILY_UNLOCK(); return; }
		// A sample is never the day's record: the final measurement must replace the
		// provisional one, not a sample.
		if (existing.scaleId == id && existing.day == day && !(existing.flags & FlagSample)) break;
		position += sizeof(existing);
	}
	// Same scale and day: the final measurement replaces a provisional one in place.
	file.seek(position);
	file.write((const uint8_t*)&record, sizeof(record));
	file.close();
	DAILY_UNLOCK();
	runtime.measureRecorded = final ? 2 : 1;
	if (!final) return;
	runtime.lastFinalDay = day;
	runtime.lastFinalGrams = grams;
	runtime.hasLastFinal = true;
	runtime.pendingKegChange = false;
	if (lastPruneDay_ != day) {
		lastPruneDay_ = day;
		pruneDaily(day);
	}
}

// A file written before the version byte existed holds 20-byte records. Rewrite it
// through a temporary file so an interrupted boot leaves the original in place.
bool ScaleManager::migrateDaily() {
	DAILY_LOCK();
	File source = FileSystem.open(DailyPath, "r");
	if (!source) { DAILY_UNLOCK(); return true; }
	uint8_t version = DailyRecordVersion;
	bool legacy = source.size() >= sizeof(LegacyDailyRecord);
	if (legacy) {
		source.seek(offsetof(LegacyDailyRecord, reserved));
		legacy = source.read(&version, 1) == 1 && version != DailyRecordVersion;
	}
	if (!legacy || source.size() % sizeof(LegacyDailyRecord) != 0) { source.close(); DAILY_UNLOCK(); return true; }
	source.seek(0);
	File target = FileSystem.open(DailyTempPath, "w");
	if (!target) { source.close(); DAILY_UNLOCK(); return false; }
	LegacyDailyRecord old;
	bool ok = true;
	while (source.read((uint8_t*)&old, sizeof(old)) == sizeof(old)) {
		DailyRecord record = {};
		record.day = old.day;
		record.time = old.time;
		record.levelGrams = old.levelGrams;
		record.consumedGrams = old.consumedGrams;
		record.scaleId = old.scaleId;
		record.flags = old.flags;
		record.version = DailyRecordVersion;
		record.rawCounts = DailyRawUnknown;
		record.temperatureDeciC = DailyTemperatureUnknown;
		if (target.write((const uint8_t*)&record, sizeof(record)) != sizeof(record)) { ok = false; break; }
	}
	source.close();
	target.close();
	if (!ok) { FileSystem.remove(DailyTempPath); DAILY_UNLOCK(); return false; }
	if (FileSystem.exists(DailyBackupPath)) FileSystem.remove(DailyBackupPath);
	if (!FileSystem.rename(DailyPath, DailyBackupPath)) { FileSystem.remove(DailyTempPath); DAILY_UNLOCK(); return false; }
	if (!FileSystem.rename(DailyTempPath, DailyPath)) {
		FileSystem.rename(DailyBackupPath, DailyPath);
		DAILY_UNLOCK();
		return false;
	}
	FileSystem.remove(DailyBackupPath);
	DAILY_UNLOCK();
	return true;
}

void ScaleManager::recoverDaily() {
	if (!FileSystem.exists(DailyPath) && FileSystem.exists(DailyBackupPath))
		FileSystem.rename(DailyBackupPath, DailyPath);
	if (FileSystem.exists(DailyTempPath)) FileSystem.remove(DailyTempPath);
	if (FileSystem.exists(DailyBackupPath) && FileSystem.exists(DailyPath))
		FileSystem.remove(DailyBackupPath);
	migrateDaily();
	File file = FileSystem.open(DailyPath, "r");
	if (!file) return;
	DailyRecord record;
	while (file.read((uint8_t*)&record, sizeof(record)) == sizeof(record)) {
		if (record.version != DailyRecordVersion) continue;
		if (record.scaleId >= SCALE_COUNT || (record.flags & FlagProvisional) || (record.flags & FlagSample)) continue;
		Runtime &runtime = runtime_[record.scaleId];
		if (runtime.hasLastFinal && record.day < runtime.lastFinalDay) continue;
		runtime.lastFinalDay = record.day;
		runtime.lastFinalGrams = record.levelGrams;
		runtime.hasLastFinal = true;
	}
	file.close();
}

bool ScaleManager::pruneDaily(uint32_t today) {
	DAILY_LOCK();
	File source = FileSystem.open(DailyPath, "r");
	if (!source) { DAILY_UNLOCK(); return true; }
	File target = FileSystem.open(DailyTempPath, "w");
	if (!target) { source.close(); DAILY_UNLOCK(); return false; }
	uint32_t retention = theSettings.scaleSettings()->retentionDays;
	DailyRecord record;
	bool ok = true;
	while (source.read((uint8_t*)&record, sizeof(record)) == sizeof(record)) {
		// A short write would drop every retained record after it once the temp
		// file is renamed over the real one; same abort as migrateDaily().
		if (record.version == DailyRecordVersion && record.day + retention >= today &&
			target.write((const uint8_t*)&record, sizeof(record)) != sizeof(record)) { ok = false; break; }
	}
	source.close();
	target.close();
	if (!ok) { FileSystem.remove(DailyTempPath); DAILY_UNLOCK(); return false; }
	if (FileSystem.exists(DailyBackupPath)) FileSystem.remove(DailyBackupPath);
	if (FileSystem.exists(DailyPath) && !FileSystem.rename(DailyPath, DailyBackupPath)) {
		FileSystem.remove(DailyTempPath);
		DAILY_UNLOCK();
		return false;
	}
	if (!FileSystem.rename(DailyTempPath, DailyPath)) {
		if (FileSystem.exists(DailyBackupPath)) FileSystem.rename(DailyBackupPath, DailyPath);
		DAILY_UNLOCK();
		return false;
	}
	if (FileSystem.exists(DailyBackupPath)) FileSystem.remove(DailyBackupPath);
	DAILY_UNLOCK();
	return true;
}

// A new session discards the previous one's samples, so the file always holds
// exactly one experiment. Same temp/backup sequence as pruneDaily.
bool ScaleManager::clearSamples() {
	DAILY_LOCK();
	if (!FileSystem.exists(DailyPath)) { DAILY_UNLOCK(); return true; }
	File source = FileSystem.open(DailyPath, "r");
	if (!source) { DAILY_UNLOCK(); return false; }
	File target = FileSystem.open(DailyTempPath, "w");
	if (!target) { source.close(); DAILY_UNLOCK(); return false; }
	DailyRecord record;
	while (source.read((uint8_t*)&record, sizeof(record)) == sizeof(record)) {
		// A legacy file that failed to migrate cannot be parsed with this record
		// size; abandon the rewrite so the history survives and startSampling fails.
		if (record.version != DailyRecordVersion) {
			source.close();
			target.close();
			FileSystem.remove(DailyTempPath);
			DAILY_UNLOCK();
			return false;
		}
		if (!(record.flags & FlagSample)) {
			// A short write would drop every record after it once the temp file is
			// renamed over the real one; same abort as above.
			if (target.write((const uint8_t*)&record, sizeof(record)) != sizeof(record)) {
				source.close();
				target.close();
				FileSystem.remove(DailyTempPath);
				DAILY_UNLOCK();
				return false;
			}
		}
	}
	source.close();
	target.close();
	if (FileSystem.exists(DailyBackupPath)) FileSystem.remove(DailyBackupPath);
	if (FileSystem.exists(DailyPath) && !FileSystem.rename(DailyPath, DailyBackupPath)) {
		FileSystem.remove(DailyTempPath);
		DAILY_UNLOCK();
		return false;
	}
	if (!FileSystem.rename(DailyTempPath, DailyPath)) {
		if (FileSystem.exists(DailyBackupPath)) FileSystem.rename(DailyBackupPath, DailyPath);
		DAILY_UNLOCK();
		return false;
	}
	if (FileSystem.exists(DailyBackupPath)) FileSystem.remove(DailyBackupPath);
	DAILY_UNLOCK();
	return true;
}

String ScaleManager::statusJson(bool full) const {
	// full=false is the live block sent with every status report; full=true is the
	// one-shot settings request. Worst case for the live block is eight configured,
	// calibrated, measuring kegs at ~43 fields each, which needs about 6 kB; the
	// ESP8266 cannot drive that many HX711 pairs, and its status document is alive
	// while this one builds, so 6144 is the compromise.
#if defined(ESP8266)
	DynamicJsonDocument doc(full ? 16384 : 6144);
#else
	DynamicJsonDocument doc(16384);
#endif
	ScaleSettings *settings = theSettings.scaleSettings();
	bool enabled = settings->useScale != 0;
	doc["use"] = enabled;
	doc["retentionDays"] = settings->retentionDays;
	doc["eventThresholdGrams"] = settings->eventThresholdGrams;
	doc["maxPourMl"] = settings->maxPourMl;
	doc["dailyMinute"] = settings->dailyMinute;
	doc["sampleMinutes"] = settings->sampleMinutes;
	doc["sampleHours"] = settings->sampleHours;
	doc["sampleActive"] = samplingActive();
	doc["sampleRemainingSec"] = samplingRemainingSec();
	doc["timeSynced"] = TimeKeeper.isSynchronized();
	JsonArray scales = doc.createNestedArray("scales");
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		const ScaleDeviceSettings &device = scaleSlot(*settings, id);
		const Runtime &runtime = runtime_[id];
		bool busy = runtime.calJob != CalIdle || runtime.measureJob != MeasureIdle
			|| runtime.calResult != CalIdle || runtime.calError != CalIdle;
		// Live updates omit unused slots. The settings request (full) still lists every slot.
		if (!full && !device.configured) continue;
		JsonObject item = scales.createNestedObject();
		item["id"] = id;
		item["configured"] = device.configured != 0;
		item["name"] = device.name;
		item["kegName"] = device.kegName;
		if (!full) {
			item["connected"] = true;
			item["calibrated"] = device.calibrated != 0;
			if (!device.calibrated && !busy) continue;
		}
		item["doutPin"] = device.doutPin;
		item["clockPin"] = device.clockPin;
		item["calibrated"] = device.calibrated != 0;
		item["calibrationLimitCounts"] = scaleCalLimit(*settings, id);
		if (full) {
			item["zeroOffset"] = device.zeroOffset;
			item["calibrationFactor"] = device.calibrationFactor;
			item["emptyKegGrams"] = device.emptyKegGrams;
			item["capacityMl"] = device.capacityMl;
			item["beerDensityKgPerL"] = device.beerDensityKgPerL;
			JsonArray correction = item.createNestedArray("tempCorrection");
			for (uint8_t j = 0; j < 4; ++j) correction.add(settings->tempCorrection[id][j]);
		}
		if (!enabled) {
			item["state"] = Disabled;
			item["present"] = false;
			item["stable"] = false;
			item["rawCounts"] = nullptr;
			item["grossGrams"] = nullptr;
			item["remainingLiters"] = nullptr;
			item["capacityLiters"] = device.capacityMl / 1000.0f;
			item["percent"] = 0;
			item["temperatureC"] = nullptr;
			continue;
		}
		int64_t rawTotal = 0;
		uint8_t rawN = runtime.count;
		for (uint8_t i = 0; i < rawN; ++i) rawTotal += runtime.samples[i];
		if (runtime.calJob != CalIdle && runtime.calCount)
			item["rawCounts"] = (int32_t)(runtime.calSum / (int64_t)runtime.calCount);
		else
			item["rawCounts"] = rawN ? (int32_t)(rawTotal / rawN) : runtime.latestRaw;
		item["state"] = runtime.state;
		item["present"] = runtime.present;
		item["stable"] = runtime.stable;
		item["calibrating"] = runtime.calJob != CalIdle;
		item["calCount"] = runtime.calCount;
		item["calTarget"] = ScaleReadCountCalibration;
		if (runtime.calJob == CalTare) item["calAction"] = "tare";
		else if (runtime.calJob == CalFactor) item["calAction"] = "factor";
		else item["calAction"] = nullptr;
		if (runtime.calError == CalTare) item["calError"] = "tare";
		else if (runtime.calError == CalFactor) item["calError"] = "factor";
		else item["calError"] = nullptr;
		static const char *const reasons[] = {nullptr, "unstable", "noLoad", "notZeroed", "timeout"};
		item["calErrorReason"] = runtime.calErrorReason < 5 ? reasons[runtime.calErrorReason] : nullptr;
		if (runtime.calResult == CalTare) item["calResult"] = "tare";
		else if (runtime.calResult == CalFactor) item["calResult"] = "factor";
		else item["calResult"] = nullptr;
		bool hasStats = runtime.calResult != CalIdle || runtime.calErrorReason == CalReasonUnstable || runtime.calErrorReason == CalReasonNoLoad;
		if (hasStats) {
			item["calMean"] = runtime.calResultMean;
			item["calStdDev"] = runtime.calResultStdDev;
			item["calSpread"] = runtime.calResultSpread;
			item["calHalfDiff"] = runtime.calResultHalfDiff;
			item["calLimit"] = runtime.calResultLimit;
			item["calFactor"] = device.calibrationFactor;
		}
		item["measuring"] = runtime.measureJob != MeasureIdle;
		item["measureCount"] = runtime.blockIndex * MeasureBlockSamples + runtime.blockCount;
		item["measureTarget"] = MeasureBlocks * MeasureBlockSamples;
		if (runtime.measureJob == MeasureScheduled) item["measureAction"] = "scheduled";
		else if (runtime.measureJob == MeasureManual) item["measureAction"] = "manual";
		else if (runtime.measureJob == MeasureSample) item["measureAction"] = "sample";
		else item["measureAction"] = nullptr;
		static const char *const results[] = {nullptr, "ok", "unstable", "noSignal"};
		item["measureResult"] = runtime.measureResult < 4 ? results[runtime.measureResult] : nullptr;
		if (runtime.measureResult == MeasureOk || runtime.measureResult == MeasureUnstable) {
			item["measureGrams"] = runtime.measureGrams;
			item["measureHalfDiff"] = runtime.measureHalfDiff;
			item["measureLimit"] = scaleCalLimit(*settings, id);
			item["measureTime"] = runtime.measureTime;
		}
		if (runtime.measureRecorded == 2) item["measureRecorded"] = "final";
		else if (runtime.measureRecorded == 1) item["measureRecorded"] = "provisional";
		else item["measureRecorded"] = nullptr;
		item["retryPending"] = runtime.retryPending;
		item["kegChangePending"] = runtime.pendingKegChange;
		if (device.calibrated) item["grossGrams"] = runtime.grossGrams;
		else item["grossGrams"] = nullptr;
		float fridgeC = fridgeCelsius();
		if (isnan(fridgeC)) item["temperatureC"] = nullptr;
		else item["temperatureC"] = fridgeC;
		float liters = fmaxf(0.0f, runtime.grossGrams - device.emptyKegGrams) / 1000.0f / fmaxf(0.8f, device.beerDensityKgPerL);
		float capacity = device.capacityMl / 1000.0f;
		if (device.calibrated && runtime.present) item["remainingLiters"] = liters;
		else item["remainingLiters"] = nullptr;
		item["capacityLiters"] = capacity;
		item["percent"] = capacity > 0 && device.calibrated && runtime.present ? clampValue(liters * 100.0f / capacity, 0, 100) : 0;
	}
	String output;
	serializeJson(doc, output);
	return output;
}

// /getstatus keeps the scale block small on purpose: three fields per configured
// keg is all the dashboard needs, and the full status is still on /scale.
String ScaleManager::statusJsonLean() const {
	String out = "[";
	ScaleSettings *settings = theSettings.scaleSettings();
	bool first = true;
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		const ScaleDeviceSettings &device = scaleSlot(*settings, id);
		if (!device.configured) continue;
		const Runtime &runtime = runtime_[id];
		const char *measured = (runtime.measureResult == MeasureOk || runtime.measureResult == MeasureUnstable) ? "true" : "false";
		out += first ? "{" : ",{";
		first = false;
		out += String("\"id\":") + String(id);
		out += String(",\"measureGrams\":");
		if (measured[0] == 't') out += String(runtime.measureGrams); else out += "null";
		out += String(",\"remainingLiters\":");
		if (device.calibrated && runtime.present) out += String(fmaxf(0.0f, runtime.grossGrams - device.emptyKegGrams) / 1000.0f / fmaxf(0.8f, device.beerDensityKgPerL));
		else out += "null";
		out += "}";
	}
	out += "]";
	return out;
}

// One entry per configured keg, for the log's session summary. Same arithmetic
// as statusJson, but as plain numbers so the logger can serialise it without a
// second JSON document.
uint8_t ScaleManager::sessionKegLevels(SessionKegLevel *out, uint8_t max) const {
	ScaleSettings *settings = theSettings.scaleSettings();
	uint8_t n = 0;
	for (uint8_t id = 0; id < SCALE_COUNT && n < max; ++id) {
		const ScaleDeviceSettings &device = scaleSlot(*settings, id);
		if (!device.configured) continue;
		const Runtime &runtime = runtime_[id];
		SessionKegLevel &level = out[n++];
		level.id = id;
		level.label = device.kegName[0] ? device.kegName : device.name;
		level.percent = -1;
		level.litersX10 = -1;
		if (!device.calibrated || !runtime.present) continue;
		float liters = fmaxf(0.0f, runtime.grossGrams - device.emptyKegGrams) / 1000.0f / fmaxf(0.8f, device.beerDensityKgPerL);
		level.litersX10 = (int16_t)(liters * 10.0f + 0.5f);
		float capacity = device.capacityMl / 1000.0f;
		if (capacity > 0.0f) level.percent = (int16_t)(clampValue(liters * 100.0f / capacity, 0, 100) + 0.5f);
	}
	return n;
}

void ScaleManager::writeDailyJson(uint8_t scaleId, Print& out) const {	// scaleId >= SCALE_COUNT returns every keg. Record: [day, time, level g, consumed g, flags, scale, raw counts, temperature C].
	bool every = scaleId >= SCALE_COUNT;
	out.print("{\"records\":[");
	File file = FileSystem.open(DailyPath, "r");
	if (file) {
		DailyRecord record;
		bool first = true;
		while (file.read((uint8_t*)&record, sizeof(record)) == sizeof(record)) {
			if (record.version != DailyRecordVersion) continue;
			if (!every && record.scaleId != scaleId) continue;
			out.printf("%s[%lu,%lu,%ld,%ld,%u,%u,", first ? "" : ",", (unsigned long)record.day, (unsigned long)record.time,
				(long)record.levelGrams, (long)record.consumedGrams, (unsigned)record.flags, (unsigned)record.scaleId);
			if (record.rawCounts == DailyRawUnknown) out.print("null");
			else out.print(record.rawCounts);
			out.print(",");
			if (record.temperatureDeciC == DailyTemperatureUnknown) out.print("null");
			else out.print(record.temperatureDeciC / 10.0f, 1);
			out.print("]");
			first = false;
		}
		file.close();
	}
	out.print("]}");
}

bool ScaleManager::calibrationBusy() const {
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		if (runtime_[id].calJob != CalIdle) return true;
	}
	return false;
}

bool ScaleManager::startCalibration(uint8_t id, uint8_t job, float knownWeightGrams) {
	if (id >= SCALE_COUNT || !runtime_[id].active || calibrationBusy() || runtime_[id].measureJob != MeasureIdle) return false;
	Runtime &runtime = runtime_[id];
	runtime.calJob = job;
	runtime.calError = CalIdle;
	runtime.calErrorReason = CalReasonNone;
	runtime.calResult = CalIdle;
	runtime.calCount = 0;
	runtime.calSum = 0;
	runtime.calHalfSum = 0;
	runtime.calDevSum = 0;
	runtime.calDevSq = 0;
	runtime.calWeight = knownWeightGrams;
	runtime.calStartedMs = millis();
	runtime.stable = false;
	runtime.state = Settling;
	return true;
}

void ScaleManager::failCalibration(uint8_t id, uint8_t reason) {
	Runtime &runtime = runtime_[id];
	runtime.calError = runtime.calJob;
	runtime.calErrorReason = reason;
	runtime.calResult = CalIdle;
	runtime.calJob = CalIdle;
	runtime.calCount = 0;
	runtime.calSum = 0;
	runtime.calWeight = 0;
}

void ScaleManager::completeCalibration(uint8_t id) {
	Runtime &runtime = runtime_[id];
	ScaleDeviceSettings &device = scaleSlot(*theSettings.scaleSettings(), id);
	int32_t mean = runtime.calCount ? (int32_t)(runtime.calSum / (int64_t)runtime.calCount) : 0;
	// One temperature read per call: tare and factor both produce constants as if
	// taken at the reference temperature.
	int32_t corrected = mean + (int32_t)lroundf(correctionCounts(id, fridgeCelsius()));
	if (runtime.calCount) {
		double n = runtime.calCount;
		double devMean = (double)runtime.calDevSum / n;
		double variance = (double)runtime.calDevSq / n - devMean * devMean;
		runtime.calResultStdDev = variance > 0 ? (float)sqrt(variance) : 0.0f;
	} else {
		runtime.calResultStdDev = 0.0f;
	}
	runtime.calResultMean = mean;
	runtime.calResultSpread = runtime.calMax - runtime.calMin;
	const uint8_t half = ScaleReadCountCalibration / 2;
	double firstHalf = (double)runtime.calHalfSum / half;
	double secondHalf = (double)(runtime.calSum - runtime.calHalfSum) / (runtime.calCount - half);
	runtime.calResultHalfDiff = (float)fabs(secondHalf - firstHalf);
	runtime.calResultLimit = scaleCalLimit(*theSettings.scaleSettings(), id);
	if (runtime.calResultHalfDiff > runtime.calResultLimit) {
		failCalibration(id, CalReasonUnstable);
		return;
	}
	if (runtime.calJob == CalFactor) {
		float minimumLoad = fmaxf(100.0f, 5.0f * runtime.calResultStdDev);
		if (fabsf((float)corrected - (float)device.zeroOffset) < minimumLoad) {
			failCalibration(id, CalReasonNoLoad);
			return;
		}
	}
	runtime.calResult = runtime.calJob;
	if (runtime.calResult == CalTare) {
		device.zeroOffset = corrected;
		theSettings.save();
	} else if (runtime.calResult == CalFactor) {
		float units = (float)corrected - (float)device.zeroOffset;
		float factor = runtime.calWeight > 0 ? units / runtime.calWeight : 0;
		if (isnan(factor) || isinf(factor)) factor = 0;
		device.calibrationFactor = factor;
		if (fabsf(factor) > 0.000001f) device.calibrated = 1;
		theSettings.save();
	}
	runtime.calJob = CalIdle;
	runtime.calCount = 0;
	runtime.calSum = 0;
	runtime.calWeight = 0;
}

bool ScaleManager::tare(uint8_t id) {
	return startCalibration(id, CalTare, 0);
}

bool ScaleManager::calibrate(uint8_t id, float knownWeightGrams) {
	if (knownWeightGrams < 10) return false;
	if (!startCalibration(id, CalFactor, knownWeightGrams)) return false;
	if (scaleSlot(*theSettings.scaleSettings(), id).zeroOffset == 0) failCalibration(id, CalReasonNotZeroed);
	return true;
}

bool ScaleManager::confirmKegChange(uint8_t id) {
	if (id >= SCALE_COUNT || !runtime_[id].active) return false;
	runtime_[id].pendingKegChange = true;
	return true;
}

// Reset removes every daily record and starts a fresh baseline for every keg, so the
// chart and the next consumption value both begin from the current level.
bool ScaleManager::resetHistory() {
	uint32_t today;
	uint16_t minute;
	bool clock = localClock(today, minute);
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		Runtime &runtime = runtime_[id];
		runtime.measureJob = MeasureIdle;
		runtime.blockCount = 0;
		runtime.blockIndex = 0;
		runtime.measureResult = MeasureNone;
		runtime.measureRecorded = 0;
		runtime.retryPending = false;
		runtime.hasLastFinal = false;
		runtime.lastFinalGrams = 0;
		runtime.pendingKegChange = false;
		// Keep today's scheduled measurement from recreating a record right away.
		if (clock) runtime.lastFinalDay = today;
	}
	lastPruneDay_ = 0;
	DAILY_LOCK();
	FileSystem.remove(DailyTempPath);
	FileSystem.remove(DailyBackupPath);
	bool removed = FileSystem.remove(DailyPath) || !FileSystem.exists(DailyPath);
	DAILY_UNLOCK();
	return removed;
}

bool ScaleManager::startSampling() {
	ScaleSettings *settings = theSettings.scaleSettings();
	if (!settings->useScale || !TimeKeeper.isSynchronized()) return false;
	bool any = false;
	for (uint8_t id = 0; id < SCALE_COUNT; ++id) {
		if (runtime_[id].active && hasFactor(scaleSlot(*settings, id))) { any = true; break; }
	}
	if (!any || !clearSamples()) return false;
	uint32_t now = (uint32_t)TimeKeeper.getTimeSeconds();
	sampleActive_ = true;
	sampleStartEpoch_ = now;
	sampleEndEpoch_ = now + (uint32_t)settings->sampleHours * 3600UL;
	sampleNextEpoch_ = now;
	return true;
}

void ScaleManager::stopSampling() {
	sampleActive_ = false;
}

uint32_t ScaleManager::samplingRemainingSec() const {
	if (!sampleActive_) return 0;
	uint32_t now = (uint32_t)TimeKeeper.getTimeSeconds();
	return sampleEndEpoch_ > now ? sampleEndEpoch_ - now : 0;
}

void ScaleManager::onFormatFS() {
	// Daily records are intentionally removed by the existing filesystem format flow.
}
