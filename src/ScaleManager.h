#pragma once

#include <Arduino.h>
#include "Y2TSettings.h"

// One keg of the session summary: what the fermenter held when the log stopped.
// percent and litersX10 are -1 when the scale has no usable reading.
struct SessionKegLevel {
	uint8_t id;
	const char *label;
	int16_t percent;
	int16_t litersX10;
};

class ScaleManager {
public:
	void begin();
	void loop();
	void configurationChanged();
	String statusJson(bool full = false) const;
	// /getstatus: only id, measureGrams and remainingLiters per scale.
	String statusJsonLean() const;
	// Fills out[] with one entry per configured keg and returns how many were
	// written. Used by the log's session summary; no allocation.
	uint8_t sessionKegLevels(SessionKegLevel *out, uint8_t max) const;
	void writeDailyJson(uint8_t scaleId, Print& out) const;
	bool tare(uint8_t scaleId);
	bool calibrate(uint8_t scaleId, float knownWeightGrams);
	bool measureNow(uint8_t scaleId);
	// Starts a manual measurement on every slot that can take one; returns the count.
	uint8_t measureAllNow();
	bool confirmKegChange(uint8_t scaleId);
	bool resetHistory();
	bool startSampling();
	void stopSampling();
	bool samplingActive() const { return sampleActive_; }
	uint32_t samplingRemainingSec() const;
	void onFormatFS();

private:
	static const uint8_t MeasureBlockSamples = 5;
	static const uint8_t MeasureBlocks = 10;
	enum CalJob : uint8_t { CalIdle = 0, CalTare = 1, CalFactor = 2 };
	enum CalReason : uint8_t { CalReasonNone = 0, CalReasonUnstable = 1, CalReasonNoLoad = 2, CalReasonNotZeroed = 3, CalReasonTimeout = 4 };
	enum MeasureJob : uint8_t { MeasureIdle = 0, MeasureScheduled = 1, MeasureManual = 2, MeasureSample = 3 };
	enum MeasureResult : uint8_t { MeasureNone = 0, MeasureOk = 1, MeasureUnstable = 2, MeasureNoSignal = 3 };
	struct Runtime {
		bool active;
		bool present;
		bool stable;
		bool retryPending;
		bool pendingKegChange;
		bool hasLastFinal;
		uint8_t count;
		uint8_t next;
		uint8_t state;
		uint8_t calJob;
		uint8_t calError;
		uint8_t calErrorReason;
		uint8_t calResult;
		uint8_t calCount;
		uint8_t measureJob;
		uint8_t measureResult;
		uint8_t measureAttempt;
		uint8_t measureRecorded;
		uint8_t blockCount;
		uint8_t blockIndex;
		int8_t dataPin;
		int8_t clockPin;
		int32_t samples[8];
		int32_t latestRaw;
		int32_t calMin;
		int32_t calMax;
		int32_t calFirst;
		int64_t calSum;
		int64_t calHalfSum;
		int64_t calDevSum;
		int64_t calDevSq;
		int32_t calResultMean;
		int32_t calResultSpread;
		int32_t calResultLimit;
		float calResultStdDev;
		float calResultHalfDiff;
		float calWeight;
		float grossGrams;
		int32_t blockSamples[MeasureBlockSamples];
		int32_t blockValues[MeasureBlocks];
		float measureGrams;
		float measureHalfDiff;
		int32_t measureRaw;
		uint32_t measureTime;
		uint32_t retryAtMs;
		uint32_t lastFinalDay;
		float lastFinalGrams;
		uint32_t lastSampleMs;
		uint32_t calStartedMs;
	} runtime_[SCALE_COUNT];
	uint32_t lastPruneDay_;
	// Sampling session state: RAM only, never persisted. The memset in begin()
	// covers runtime_ only, so these carry their own defaults; a reboot ends a
	// session and keeps the collected samples in the daily file.
	bool sampleActive_ = false;
	uint32_t sampleStartEpoch_ = 0;
	uint32_t sampleEndEpoch_ = 0;
	uint32_t sampleNextEpoch_ = 0;

	bool readRaw(uint8_t dataPin, uint8_t clockPin, int32_t& value);
	void service(uint8_t id);
	void schedule();
	void sampleSchedule();
	bool calibrationBusy() const;
	bool startCalibration(uint8_t id, uint8_t job, float knownWeightGrams);
	void completeCalibration(uint8_t id);
	void failCalibration(uint8_t id, uint8_t reason);
	bool startMeasurement(uint8_t id, uint8_t job);
	void addMeasurementSample(uint8_t id, int32_t raw);
	void completeMeasurement(uint8_t id);
	void finishMeasurement(uint8_t id, uint8_t result, bool hasValue);
	void writeDailyRecord(uint8_t id, uint32_t day, float grams, uint8_t flags, bool final, bool append = false);
	bool pruneDaily(uint32_t today);
	bool clearSamples();
	bool migrateDaily();
	void recoverDaily();
};

extern ScaleManager scaleManager;
