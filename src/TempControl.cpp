/*
 * Copyright 2012-2013 BrewPi/Elco Jacobs.
 *
 * This file is part of BrewPi.
 *
 * BrewPi is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * BrewPi is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with BrewPi.  If not, see <http://www.gnu.org/licenses/>.
 */

#include "Brewpi.h"

#include "Pins.h"
#include <limits.h>

#include "TemperatureFormats.h"
#include "TempControl.h"
#include "Y2TSettings.h"

static bool profileDrivenFlag = false;
void TempControl::setProfileDriven(bool on){ profileDrivenFlag = on; }
#include "PiLink.h"
#include "TempSensor.h"
#include "Ticks.h"
#include "TempSensorMock.h"
#include "EepromManager.h"
#include "TempSensorDisconnected.h"
#include "RotaryEncoder.h"
#include "Config.h"
#include <string.h>
#include <stdlib.h>

TempControl tempControl;

#if TEMP_CONTROL_STATIC

extern ValueSensor<bool> defaultSensor;
extern ValueActuator defaultActuator;
extern DisconnectedTempSensor defaultTempSensor;

// These sensors are switched out to implement multi-chamber.
TempSensor* TempControl::beerSensor;
TempSensor* TempControl::fridgeSensor;
BasicTempSensor* TempControl::ambientSensor = &defaultTempSensor;


Actuator* TempControl::heater = &defaultActuator;
Actuator* TempControl::cooler = &defaultActuator;
Actuator* TempControl::light = &defaultActuator;
Actuator* TempControl::fan = &defaultActuator;

ValueActuator cameraLightState;
AutoOffActuator TempControl::cameraLight(600, &cameraLightState);	// timeout 10 min
Sensor<bool>* TempControl::door = &defaultSensor;

// Control parameters
ControlConstants TempControl::cc;
ControlSettings TempControl::cs;
ControlVariables TempControl::cv;

	// State variables
uint8_t TempControl::state;
bool TempControl::doPosPeakDetect;
bool TempControl::doNegPeakDetect;
bool TempControl::doorOpen;

	// keep track of beer setting stored in EEPROM
temperature TempControl::storedBeerSetting;

	// Timers
uint16_t TempControl::lastIdleTime;
uint16_t TempControl::lastHeatTime;
uint16_t TempControl::lastCoolTime;
uint16_t TempControl::waitTime;

	// MODE_INDEPENDENT only
bool TempControl::independentHeaterOn;
bool TempControl::independentCoolerOn;
uint16_t TempControl::lastIndependentHeatOnTime;
uint16_t TempControl::lastIndependentCoolOnTime;
uint32_t TempControl::sensorSeenMs[3];
uint16_t TempControl::lastBothOnTime;

uint8_t TempControl::piPhase;
int32_t TempControl::piIntegral;
uint8_t TempControl::piDuty;
uint16_t TempControl::piOnTime;
uint16_t TempControl::piOffTime;
temperature TempControl::piAmp;
temperature TempControl::piCoast;
temperature TempControl::piPeak;
temperature TempControl::piCutTemp;
temperature TempControl::piCycleMin;
uint8_t TempControl::piBelowPeakCount;
uint16_t TempControl::piWaitStart;
uint16_t TempControl::piLastOff;
uint16_t TempControl::piLastSec;
bool TempControl::piHaveCycle;
#endif

// Independent pulse-PI constants (RAM state machine, heater only)
static const uint8_t PI_PEAK_BELOW_N = 3;          // slow-filter samples below peak
static const uint8_t PI_DUTY_MAX = 50;             // % ceiling: pulse <= idle gap
static const uint16_t PI_ONSEC_MAX = 300;          // hard pulse cap, seconds
static const uint16_t PI_ONSEC_DEFAULT = 120;      // first pulse, seconds
static const uint16_t PI_OFFSEC_MIN = 60;          // idle floor, seconds
static const uint16_t PI_OFFSEC_MAX = 21600;       // 6 h sanity cap, seconds
static const uint16_t PI_PEAK_WAIT_MAX = 2400;     // give up peak hunting, seconds
static const temperature PI_GUARD_FLOOR = 48;      // 1.5 * 1/16 C = 0.094 C
static const temperature PI_GUARD_MAX = 256;       // 0.5 C
static const temperature PI_SAFETY_ABOVE = 128;    // +0.25 C hard safety cut
static const int32_t PI_INTEGRAL_MAX = 25L*512L*60L; // 25 degC*min, in (1/512 C)*s
static const uint8_t PI_AMP_GAIN_NUM = 2;          // onTime adaption: 40 % of the error
static const uint8_t PI_AMP_GAIN_DEN = 5;

void TempControl::init(void){
	state=IDLE;
	cs.mode = MODE_OFF;

	cameraLight.setActive(false);

	// this is for cases where the device manager hasn't configured beer/fridge sensor.
	if (beerSensor==NULL) {
		beerSensor = new TempSensor(TEMP_SENSOR_TYPE_BEER, &defaultTempSensor);
		beerSensor->init();
	}

	if (fridgeSensor==NULL) {
		fridgeSensor = new TempSensor(TEMP_SENSOR_TYPE_FRIDGE, &defaultTempSensor);
		fridgeSensor->init();
	}

	updateTemperatures();
	reset();

	// Do not allow heating/cooling directly after reset.
	// A failing script + CRON + Arduino uno (which resets on serial connect) could damage the compressor
	// For test purposes, set these to -3600 to eliminate waiting after reset
	lastHeatTime = 0;
	lastCoolTime = 0;
}

void TempControl::reset(void){
	doPosPeakDetect=false;
	doNegPeakDetect=false;
	independentHeaterOn=false;
	independentCoolerOn=false;
	resetIndependentPulsePi();
}

void TempControl::resetIndependentPulsePi(void){
	piPhase = PI_PHASE_IDLE;
	piIntegral = 0;
	piDuty = 0;
	// Start with a short pulse: even a 2 K gap is closed by many small pulses,
	// never by one long one.
	piOnTime = PI_ONSEC_DEFAULT;
	if (piOnTime < cc.minHeatTime) piOnTime = cc.minHeatTime;
	if (piOnTime > PI_ONSEC_MAX) piOnTime = PI_ONSEC_MAX;
	piOffTime = 0;
	piAmp = 0;
	piCoast = 0;
	piPeak = INVALID_TEMP;
	piCutTemp = INVALID_TEMP;
	piCycleMin = INVALID_TEMP;
	piBelowPeakCount = 0;
	piWaitStart = 0;
	piLastOff = 0;
	piLastSec = 0;
	piHaveCycle = false;
	cv.estimatedPeak = INVALID_TEMP;
}

void updateSensor(TempSensor* sensor) {	sensor->update();
	sensor->retryInitIfNeeded();
	if(!sensor->isConnected()) {
		sensor->init();
	}
}

void TempControl::updateTemperatures(void){

	updateSensor(beerSensor);
	updateSensor(fridgeSensor);

	// Read ambient sensor to keep the value up to date. If no sensor is connected, this does nothing.
	// This prevents a delay in serial response because the value is not up to date.
	temperature ambientTemp = ambientSensor->read();
	if(ambientTemp == TEMP_SENSOR_DISCONNECTED){
		ambientSensor->init(); // try to reconnect a disconnected, but installed sensor
	}
	DeviceManager::startOneWireConversions();

	// /getstatus: track when each sensor last produced a valid reading. A failed
	// read must not refresh the timestamp, so this only runs on success.
	uint32_t nowMs = millis();
	if (beerSensor->isConnected()) sensorSeenMs[0] = nowMs;
	if (fridgeSensor->isConnected()) sensorSeenMs[1] = nowMs;
	if (ambientTemp != TEMP_SENSOR_DISCONNECTED) sensorSeenMs[2] = nowMs;

#if SerialDebug
	char beerTemp[12];
	char fridgeTemp[12];
	char ambientTempString[12];
	tempToString(beerTemp, beerSensor->readRaw(), 2, sizeof(beerTemp));
	tempToString(fridgeTemp, fridgeSensor->readRaw(), 2, sizeof(fridgeTemp));
	tempToString(ambientTempString, ambientTemp, 2, sizeof(ambientTempString));
	DBG_PRINTF("TEMP Beer:%s(%d) Fridge:%s(%d) Ambient:%s(%d)\n",
		beerTemp, beerSensor->isConnected(true), fridgeTemp, fridgeSensor->isConnected(true),
		ambientTempString, ambientSensor->isConnected());
#endif
}

void TempControl::updatePID(void){
	static unsigned char integralUpdateCounter = 0;

	if(cs.mode == MODE_INDEPENDENT){
		// Independent does not use beer→fridge cascade PID (heater predictive
		// time+slope learner lives in updateIndependentState when hysteresisMode is on).
		return;
	}
	if(tempControl.modeIsBeer()){
		if(cs.beerSetting == INVALID_TEMP){
			// beer setting is not updated yet
			cs.fridgeSetting = INVALID_TEMP;
			return;
		}

		// fridge setting is calculated with PID algorithm. Beer temperature error is input to PID
		temperature beerSlow = beerSensor->readSlowFiltered();
		if(beerSlow == INVALID_TEMP){
			// The beer sensor has no usable sample yet (filters not seeded, see
			// TempSensor::init). Keep the previous fridge setpoint instead of
			// computing an error against INVALID_TEMP.
			return;
		}
		cv.beerDiff =  cs.beerSetting - beerSlow;
		cv.beerSlope = beerSensor->readSlope();
		temperature fridgeFastFiltered = fridgeSensor->readFastFiltered();

		if(integralUpdateCounter++ == 60){
			integralUpdateCounter = 0;

			temperature integratorUpdate = cv.beerDiff;

			// Only update integrator in IDLE, so it does not increase when fridge is already at maximum/minimum
			if(state != IDLE){
				integratorUpdate = 0;
			}
			else if(abs(integratorUpdate) < cc.iMaxError){
				// difference is smaller than iMaxError
				// check additional conditions to see if integrator should be active to prevent windup
				bool updateSign = (integratorUpdate > 0); // 1 = positive, 0 = negative
				bool integratorSign = (cv.diffIntegral > 0);

				if(updateSign == integratorSign){
					// beerDiff and integrator have same sign. Integrator would be increased.

					// If actuator is already at max increasing actuator will only cause integrator windup.
					integratorUpdate = (cs.fridgeSetting >= cc.tempSettingMax) ? 0 : integratorUpdate;
					integratorUpdate = (cs.fridgeSetting <= cc.tempSettingMin) ? 0 : integratorUpdate;
					integratorUpdate = ((cs.fridgeSetting - cs.beerSetting) >= cc.pidMax) ? 0 : integratorUpdate;
					integratorUpdate = ((cs.beerSetting - cs.fridgeSetting) >= cc.pidMax) ? 0 : integratorUpdate;

					// cooling and fridge temp is more than 2 degrees from setting, actuator is saturated.
					integratorUpdate = (!updateSign && (fridgeFastFiltered > (cs.fridgeSetting +1024))) ? 0 : integratorUpdate;

					// heating and fridge temp is more than 2 degrees from setting, actuator is saturated.
					integratorUpdate = (updateSign && (fridgeFastFiltered < (cs.fridgeSetting -1024))) ? 0 : integratorUpdate;
				}
				else{
					// integrator action is decreased. Decrease faster than increase.
					integratorUpdate = integratorUpdate*2;
				}
			}
			else{
				// decrease integral by 1/8 when far from the end value to reset the integrator
				integratorUpdate = -(cv.diffIntegral >> 3);
			}
			cv.diffIntegral = cv.diffIntegral + integratorUpdate;
		}

		// calculate PID parts. Use long_temperature to prevent overflow
		cv.p = multiplyFactorTemperatureDiff(cc.Kp, cv.beerDiff);
		cv.i = multiplyFactorTemperatureDiffLong(cc.Ki, cv.diffIntegral);
		cv.d = multiplyFactorTemperatureDiff(cc.Kd, cv.beerSlope);
		long_temperature newFridgeSetting = cs.beerSetting;
		newFridgeSetting += cv.p;
		newFridgeSetting += cv.i;
		newFridgeSetting += cv.d;

		// constrain to tempSettingMin or beerSetting - pidMAx, whichever is lower.
		temperature lowerBound = (cs.beerSetting <= cc.tempSettingMin + cc.pidMax) ? cc.tempSettingMin : cs.beerSetting - cc.pidMax;
		// constrain to tempSettingMax or beerSetting + pidMAx, whichever is higher.
		temperature upperBound = (cs.beerSetting >= cc.tempSettingMax - cc.pidMax) ? cc.tempSettingMax : cs.beerSetting + cc.pidMax;

		cs.fridgeSetting = constrain(constrainTemp16(newFridgeSetting), lowerBound, upperBound);
	}
	else if(cs.mode == MODE_FRIDGE_CONSTANT){
		// FridgeTemperature is set manually, use INVALID_TEMP to indicate beer temp is not active
		cs.beerSetting = INVALID_TEMP;
	}
}

void TempControl::updateState(void){
	//update state
	bool stayIdle = false;
	bool newDoorOpen = door->sense();

	if(newDoorOpen!=doorOpen) {
		doorOpen = newDoorOpen;
#ifdef ESP8266  // ESP8266 Doesn't support %S
		String annotation = "";
		annotation += "Fridge door ";
		annotation += doorOpen ? "opened" : "closed";
		piLink.printTemperaturesJSON(0, annotation.c_str());
#else
		piLink.printFridgeAnnotation(PSTR("Fridge door %S"), doorOpen ? PSTR("opened") : PSTR("closed"));
#endif
	}

	if(cs.mode == MODE_INDEPENDENT){
		updateIndependentState();
		return;
	}

	if(cs.mode == MODE_OFF){
		state = STATE_OFF;
		stayIdle = true;
	}
	// stay idle when one of the required sensors is disconnected, or the fridge setting is INVALID_TEMP
	if( cs.fridgeSetting == INVALID_TEMP ||
		!fridgeSensor->isConnected() ||
		(!beerSensor->isConnected() && tempControl.modeIsBeer())){
		state = IDLE;
		stayIdle = true;
	}

	uint16_t sinceIdle = timeSinceIdle();
	uint16_t sinceCooling = timeSinceCooling();
	uint16_t sinceHeating = timeSinceHeating();
	temperature fridgeFast = fridgeSensor->readFastFiltered();
	temperature beerFast = beerSensor->readFastFiltered();
	ticks_seconds_t secs = ticks.seconds();
	switch(state)
	{
		case IDLE:
		case STATE_OFF:
		case WAITING_TO_COOL:
		case WAITING_TO_HEAT:
		case WAITING_FOR_PEAK_DETECT:
		{
			lastIdleTime=secs;
			// set waitTime to zero. It will be set to the maximum required waitTime below when wait is in effect.
			if(stayIdle){
				break;
			}
			resetWaitTime();
			// Classic modes (fridge/beer/profile): original vitotai start hysteresis
			// always uses idleRange*. Independent ignores this path entirely.
			bool coolNeeded = fridgeFast > (cs.fridgeSetting+cc.idleRangeHigh);
			bool heatNeeded = fridgeFast < (cs.fridgeSetting+cc.idleRangeLow);
			if(coolNeeded){  // fridge temperature is too high for the cooler's own band
				#if 1 //SettableMinimumCoolTime
				tempControl.updateWaitTime(cc.mutexDeadTime, sinceHeating);
				#else
				tempControl.updateWaitTime(MIN_SWITCH_TIME, sinceHeating);
				#endif
				if(cs.mode==MODE_FRIDGE_CONSTANT){
					tempControl.updateWaitTime(MIN_COOL_OFF_TIME_FRIDGE_CONSTANT, sinceCooling);
				}
				else{
					if(beerFast < (cs.beerSetting + 16) ){ // If beer is already under target, stay/go to idle. 1/2 sensor bit idle zone
						state = IDLE; // beer is already colder than setting, stay in or go to idle
						break;
					}
					#if 1 // SettableMinimumCoolTime
					tempControl.updateWaitTime(cc.minCoolIdleTime, sinceCooling);
					#else
					tempControl.updateWaitTime(MIN_COOL_OFF_TIME, sinceCooling);
					#endif
				}
				if(tempControl.cooler != &defaultActuator){
					if(getWaitTime() > 0){
						state = WAITING_TO_COOL;
					}
					else{
						state = COOLING;
					}
				}
			}
			if(heatNeeded){  // fridge temperature is too low for the heater's own band
				#if 1 // SettableMinimumCoolTime
				tempControl.updateWaitTime(cc.mutexDeadTime, sinceCooling);
				tempControl.updateWaitTime(cc.minHeatIdleTime, sinceHeating);
				#else
				tempControl.updateWaitTime(MIN_SWITCH_TIME, sinceCooling);
				tempControl.updateWaitTime(MIN_HEAT_OFF_TIME, sinceHeating);
				#endif
				if(cs.mode!=MODE_FRIDGE_CONSTANT){
					if(beerFast > (cs.beerSetting - 16)){ // If beer is already over target, stay/go to idle. 1/2 sensor bit idle zone
						state = IDLE;  // beer is already warmer than setting, stay in or go to idle
						break;
					}
				}
				if(tempControl.heater != &defaultActuator || (cc.lightAsHeater && (tempControl.light != &defaultActuator))){
					if(getWaitTime() > 0){
						state = WAITING_TO_HEAT;
					}
					else{
						state = HEATING;
					}
				}
			}
			if(!coolNeeded && !heatNeeded){
				state = IDLE; // within both actuators' bands, always go to IDLE
				break;
			}
			if(state == HEATING || state == COOLING){
				if(doNegPeakDetect == true || doPosPeakDetect == true){
					// If peak detect is not finished, but the fridge wants to switch to heat/cool
					// Wait for peak detection and display 'Await peak detect' on display
					state = WAITING_FOR_PEAK_DETECT;
					break;
				}
			}
		}
		break;
		case COOLING:
		case COOLING_MIN_TIME:
		{
			doNegPeakDetect=true;
			lastCoolTime = secs;
			updateEstimatedPeak(cc.maxCoolTimeForEstimate, cs.coolEstimator, sinceIdle,
				fridgeSensor->readFastFiltered(), true);
			state = COOLING; // set to cooling here, so the display of COOLING/COOLING_MIN_TIME is correct

			// stop cooling when estimated fridge temp peak reaches the cooler's own lower
			// bound (coolingTargetLower) or if beer is already too cold (1/2 sensor bit idle zone)
			if(cv.estimatedPeak <= (cs.fridgeSetting + cc.coolingTargetLower) || (cs.mode != MODE_FRIDGE_CONSTANT && beerFast < (cs.beerSetting - 16))){
				#if 1 //SettableMinimumCoolTime
				if(sinceIdle > cc.minCoolTime){
				#else
				if(sinceIdle > MIN_COOL_ON_TIME){
				#endif
					cv.negPeakEstimate = cv.estimatedPeak; // remember estimated peak when I switch to IDLE, to adjust estimator later
					state=IDLE;
					break;
				}
				else{
					state = COOLING_MIN_TIME;
					break;
				}
			}
		}
		break;
		case HEATING:
		case HEATING_MIN_TIME:
		{
			doPosPeakDetect=true;
			lastHeatTime=secs;
			updateEstimatedPeak(cc.maxHeatTimeForEstimate, cs.heatEstimator, sinceIdle,
				fridgeSensor->readFastFiltered(), false);
			state = HEATING; // reset to heating here, so the display of HEATING/HEATING_MIN_TIME is correct

			// stop heating when estimated fridge temp peak reaches the heater's own upper
			// bound (heatingTargetUpper), beer already too warm, or maxHeatTime expired (0=off)
			bool maxHeatExpired = (cc.maxHeatTime != 0 && sinceIdle >= cc.maxHeatTime);
			if(cv.estimatedPeak >= (cs.fridgeSetting + cc.heatingTargetUpper)
				|| (cs.mode != MODE_FRIDGE_CONSTANT && beerFast > (cs.beerSetting + 16))
				|| maxHeatExpired){
				#if 1 //SettableMinimumCoolTime
				if(sinceIdle > cc.minHeatTime){
				#else
				if(sinceIdle > MIN_HEAT_ON_TIME){
				#endif
					cv.posPeakEstimate=cv.estimatedPeak; // remember estimated peak when I switch to IDLE, to adjust estimator later
					state=IDLE;
					break;
				}
				else{
					state = HEATING_MIN_TIME;
					break;
				}
			}
		}
		break;
	}
}

// MODE_INDEPENDENT: heater and cooler may be active at the same time.
//   Cooler target = cs.fridgeSetting (Cooling Target on the Independent tab).
//   Heater target = cs.beerSetting (Heating Target; also profile ramp target).
// On/off bands always use heatingTarget*/coolingTarget* (Advanced Settings).
// hysteresisMode On: time+slope learner on beer (cycle1 thermostat measure,
// cycle2 learned on-time, cycle3+ learned ± correction; same-cycle extra if under).
void TempControl::updateIndependentState(void){
	temperature fridgeFast = fridgeSensor->readFastFiltered();
	temperature beerFast = beerSensor->readFastFiltered();
	temperature beerSlow = beerSensor->readSlowFiltered();
	ticks_seconds_t secs = ticks.seconds();
	const bool heaterPredictive = (cc.hysteresisMode == HYSTERESIS_MODE_PID_ON);

	bool coolerAllowed = (cs.fridgeSetting != INVALID_TEMP) && fridgeSensor->isConnected()
		&& (tempControl.cooler != &defaultActuator);
	bool heaterAllowed = (cs.beerSetting != INVALID_TEMP) && beerSensor->isConnected()
		&& (tempControl.heater != &defaultActuator || (cc.lightAsHeater && tempControl.light != &defaultActuator));

	if(!coolerAllowed){
		independentCoolerOn = false;
	}
	else if(independentCoolerOn){
		// already on: only stop once we reach the lower bound AND minCoolTime has elapsed
		if(fridgeFast <= (cs.fridgeSetting + cc.coolingTargetLower)
			&& ticks.timeSince(lastIndependentCoolOnTime) > cc.minCoolTime){
			independentCoolerOn = false;
		}
	}
	else if(fridgeFast > (cs.fridgeSetting + cc.coolingTargetUpper)
		&& ticks.timeSince(lastCoolTime) > cc.minCoolIdleTime){
		// off: only start once we cross the upper bound AND minCoolIdleTime has elapsed
		independentCoolerOn = true;
		lastIndependentCoolOnTime = secs;
	}
	if(independentCoolerOn) lastCoolTime = secs;

	if(!heaterAllowed){
		independentHeaterOn = false;
		if(heaterPredictive){
			resetIndependentPulsePi();
		}
	}
	else if(heaterPredictive){
		updateIndependentPulsePi(beerFast, beerSlow, secs);
	}
	else{
		// Simple thermostat on beer (predictive Off)
		resetIndependentPulsePi();
		if(independentHeaterOn){
			uint16_t heatOnFor = ticks.timeSince(lastIndependentHeatOnTime);
			bool atTarget = (beerFast >= (cs.beerSetting + cc.heatingTargetUpper));
			bool maxHeatExpired = (cc.maxHeatTime != 0 && heatOnFor >= cc.maxHeatTime);
			if((atTarget || maxHeatExpired) && heatOnFor > cc.minHeatTime){
				independentHeaterOn = false;
			}
		}
		else if(beerFast < (cs.beerSetting + cc.heatingTargetLower)
			&& ticks.timeSince(lastHeatTime) > cc.minHeatIdleTime){
			independentHeaterOn = true;
			lastIndependentHeatOnTime = secs;
		}
	}
	if(independentHeaterOn) lastHeatTime = secs;

	if(independentCoolerOn && independentHeaterOn){
		if(state != HEATING_AND_COOLING){
			lastBothOnTime = secs;
		}
		state = HEATING_AND_COOLING;
	}
	else if(independentCoolerOn){
		state = COOLING;
	}
	else if(heaterPredictive && piPhase == PI_PHASE_WAIT_PEAK){
		lastIdleTime = secs;
		state = WAITING_FOR_PEAK_DETECT;
	}
	else if(!independentHeaterOn){
		lastIdleTime = secs;
		state = IDLE;
	}
	else{
		state = HEATING;
	}
}

// Independent pulse PI (hysteresisMode On): heater only, no cascade, no model.
//
// Layer 1 (1 Hz): a PI on the SLOW beer filter produces a duty in percent.
//   The duty is capped at PI_DUTY_MAX, so every pulse is followed by at least
//   as much idle time and the heat has time to spread through the beer.
// Layer 2 (per cycle): the duty is realised as one pulse of a learned width
//   (never above PI_ONSEC_MAX = 300 s, even when the error is several degrees).
//
// Learning: after each cut the heater stays off and the slow filter is watched.
//   peak - tempAtCut = coast (energy still stored in the band / heater)
//   peak - cycleMin = amp   (ripple the pulse actually produced)
//   The next pulse width is rescaled so amp lands on cc.indPiPulseLsb sensor
//   steps. Band mass, wall resistance, probe lag and filter delay are therefore
//   all inside the measurement; nothing has to be identified.
temperature TempControl::piGuard(void){
	temperature g = piCoast + (piCoast >> 2);	// 1.25 * measured coast
	if(g < PI_GUARD_FLOOR){
		g = PI_GUARD_FLOOR;		// 1.5 sensor steps, so a cold start still stops early
	}
	if(g > PI_GUARD_MAX){
		g = PI_GUARD_MAX;
	}
	return g;
}

void TempControl::updateIndependentPulsePi(temperature beerFast, temperature beerSlow, uint16_t secs){
	// ---- Layer 1: 1 Hz PI -> duty ----
	uint16_t dt = ticks.timeSince(piLastSec);
	if(dt == 0){
		dt = 1;
	}
	if(dt > 60){			// a stall must not dump a minute of integral at once
		dt = 60;
	}
	piLastSec = secs;

	temperature err = cs.beerSetting - beerSlow;
	int32_t pTerm = ((int32_t)cc.indPiKp * (int32_t)err) >> 18;	// 7.9 * 7.9 -> %

	// integral term, units (1/512 C) * seconds -> %
	int32_t iTerm = 0;
	if(cc.indPiKi > 0){
		iTerm = ((int32_t)(piIntegral / 60) * (int32_t)cc.indPiKi) >> 18;
	}
	int32_t unsat = pTerm + iTerm;

	bool satHi = unsat > PI_DUTY_MAX;
	bool satLo = unsat < 0;
	// conditional integration (anti-windup against the EFFECTIVE duty ceiling)
	if(!((err > 0 && satHi) || (err < 0 && satLo))){
		piIntegral += (int32_t)err * (int32_t)dt;
		if(piIntegral > PI_INTEGRAL_MAX){
			piIntegral = PI_INTEGRAL_MAX;
		}
		else if(piIntegral < -PI_INTEGRAL_MAX){
			piIntegral = -PI_INTEGRAL_MAX;
		}
		if(cc.indPiKi > 0){
			iTerm = ((int32_t)(piIntegral / 60) * (int32_t)cc.indPiKi) >> 18;
			unsat = pTerm + iTerm;
		}
	}
	if(unsat < 0){
		unsat = 0;
	}
	if(unsat > PI_DUTY_MAX){
		unsat = PI_DUTY_MAX;
	}
	piDuty = (uint8_t)unsat;

	// ---- Layer 2: pulse width and idle gap ----
	uint16_t on = piOnTime;
	if(on < cc.minHeatTime){
		on = cc.minHeatTime;		// user floor (pulse must be visible at all)
	}
	if(cc.maxHeatTime != 0 && on > cc.maxHeatTime){
		on = cc.maxHeatTime;		// the user may shorten a pulse, never lengthen it
	}
	if(on > PI_ONSEC_MAX){
		on = PI_ONSEC_MAX;		// hard 300 s cap: a 2 K gap becomes many pulses
	}
	if(on < 1){
		on = 1;
	}
	piOnTime = on;

	uint8_t duty = piDuty;
	if(duty < 1){
		duty = 1;			// keep the gap finite at zero duty
	}
	uint32_t off = ((uint32_t)on * (uint32_t)(100 - duty)) / (uint32_t)duty;
	if(off < cc.minHeatIdleTime){
		off = cc.minHeatIdleTime;	// user floor: the heat must spread first
	}
	if(off < PI_OFFSEC_MIN){
		off = PI_OFFSEC_MIN;
	}
	if(off > PI_OFFSEC_MAX){
		off = PI_OFFSEC_MAX;
	}
	piOffTime = (uint16_t)off;

	// ---- decision thresholds ----
	temperature guard = piGuard();
	temperature halfAmp = (piAmp > 0) ? (temperature)(piAmp >> 1) : 16;	// min half a sensor step
	bool approaching = (err > (temperature)(guard << 1));	// far below: ramp, stop early
	temperature upper = approaching ? (temperature)(cs.beerSetting - guard)
					: (temperature)(cs.beerSetting + halfAmp);
	temperature lower = approaching ? (temperature)(cs.beerSetting - guard)
					: (temperature)(cs.beerSetting - halfAmp);

	// cycle minimum (trough), tracked from the pulse start through the peak wait
	if(piCycleMin == INVALID_TEMP || beerSlow < piCycleMin){
		piCycleMin = beerSlow;
	}

	// ---- HEAT: pulse is running ----
	if(piPhase == PI_PHASE_HEAT){
		independentHeaterOn = true;
		uint16_t onFor = ticks.timeSince(lastIndependentHeatOnTime);
		bool safety = (beerFast >= (temperature)(cs.beerSetting + PI_SAFETY_ABOVE));
		bool atUpper = (beerSlow >= upper);
		bool expired = (onFor >= piOnTime);
		if(safety || atUpper || expired){
			independentHeaterOn = false;
			piLastOff = secs;
			piPhase = PI_PHASE_WAIT_PEAK;
			piPeak = beerSlow;
			piCutTemp = beerSlow;
			piBelowPeakCount = 0;
			piWaitStart = secs;
			cv.estimatedPeak = beerSlow;
		}
		return;
	}

	// ---- WAIT_PEAK: heater off, learn the coast and the ripple ----
	if(piPhase == PI_PHASE_WAIT_PEAK){
		independentHeaterOn = false;
		cv.estimatedPeak = piPeak;

		if(piPeak == INVALID_TEMP || beerSlow > piPeak){
			piPeak = beerSlow;
			piBelowPeakCount = 0;
		}
		else if(beerSlow < piPeak){
			if(piBelowPeakCount < 255){
				piBelowPeakCount++;
			}
		}
		else{
			piBelowPeakCount = 0;	// still on the plateau
		}

		if(piBelowPeakCount >= PI_PEAK_BELOW_N || ticks.timeSince(piWaitStart) > PI_PEAK_WAIT_MAX){
			if(piPeak != INVALID_TEMP && piCutTemp != INVALID_TEMP && piPeak > piCutTemp){
				temperature coast = piPeak - piCutTemp;
				piCoast = piHaveCycle ? (temperature)((piCoast * 3 + coast) / 4) : coast;
			}
			if(piPeak != INVALID_TEMP && piCycleMin != INVALID_TEMP && piPeak > piCycleMin){
				temperature amp = piPeak - piCycleMin;
				piAmp = piHaveCycle ? (temperature)((piAmp * 3 + amp) / 4) : amp;
				// rescale the pulse so the ripple lands on indPiPulseLsb sensor steps
				temperature want = (cc.indPiPulseLsb > 0) ? cc.indPiPulseLsb : 32;
				if(amp > 16){		// below ~0.03 C the ratio is quantisation noise
					int32_t ratio = ((int32_t)want << 9) / (int32_t)amp;	// want/amp, 9 fractional bits
					int32_t next = (int32_t)piOnTime
						+ (((int32_t)piOnTime * (ratio - 512) * (int32_t)PI_AMP_GAIN_NUM)
							/ (512L * (int32_t)PI_AMP_GAIN_DEN));
					if(next < (int32_t)cc.minHeatTime){
						next = cc.minHeatTime;
					}
					if(next > (int32_t)PI_ONSEC_MAX){
						next = PI_ONSEC_MAX;
					}
					if(next < 1){
						next = 1;
					}
					piOnTime = (uint16_t)next;
				}
			}
			piHaveCycle = true;
			piPhase = PI_PHASE_IDLE;
			piPeak = INVALID_TEMP;
			piCutTemp = INVALID_TEMP;
			piCycleMin = beerSlow;
			cv.estimatedPeak = INVALID_TEMP;
		}
		return;
	}

	// ---- IDLE: wait for the gap, then start a new pulse ----
	independentHeaterOn = false;
	cv.estimatedPeak = INVALID_TEMP;
	bool gapElapsed = (piLastOff == 0) || (ticks.timeSince(piLastOff) >= piOffTime);
	bool nearTarget = (beerSlow <= lower);
	if(gapElapsed && nearTarget && ticks.timeSince(lastHeatTime) > cc.minHeatIdleTime){
		piPhase = PI_PHASE_HEAT;
		independentHeaterOn = true;
		lastIndependentHeatOnTime = secs;
		piCycleMin = beerSlow;
	}
}

void TempControl::updateEstimatedPeak(uint16_t timeLimit, temperature estimator, uint16_t sinceIdle,
	temperature currentTemp, bool cooling)
{
	uint16_t activeTime = min(timeLimit, sinceIdle); // heat or cool time in seconds
	temperature estimatedOvershoot = ((long_temperature) estimator * activeTime)/3600; // overshoot estimator is in overshoot per hour
	if(cooling){
		estimatedOvershoot = -estimatedOvershoot; // when cooling subtract overshoot from temperature
	}
	cv.estimatedPeak = currentTemp + estimatedOvershoot;
}

void TempControl::updateOutputs(void) {
	if (cs.mode==MODE_TEST)
		return;

	cameraLight.update();
	// In independent mode, `state` can only show one of heat/cool (display priority),
	// so use the real independent per-actuator flags instead of stateIsHeating/Cooling.
	bool heating = (cs.mode == MODE_INDEPENDENT) ? independentHeaterOn : stateIsHeating();
	bool cooling = (cs.mode == MODE_INDEPENDENT) ? independentCoolerOn : stateIsCooling();
	cooler->setActive(cooling);
	heater->setActive(!cc.lightAsHeater && heating);
	light->setActive(isDoorOpen() || (cc.lightAsHeater && heating) || cameraLightState.isActive());
	fan->setActive(heating || cooling);
}


void TempControl::detectPeaks(void){
	// Independent pulse PI: peak wait/learn lives in updateIndependentPulsePi.
	if(cs.mode == MODE_INDEPENDENT){
		return;
	}

	//detect peaks in fridge temperature to tune overshoot estimators
	LOG_ID_TYPE detected = 0;
	temperature peak, estimate, error, oldEstimator, newEstimator;

	if(doPosPeakDetect && !stateIsHeating()){
		peak = fridgeSensor->detectPosPeak();
		estimate = cv.posPeakEstimate;
		error = peak-estimate;
		oldEstimator = cs.heatEstimator;
		if(peak != INVALID_TEMP){
			// positive peak detected
			if(error > cc.heatingTargetUpper){
				// Peak temperature was higher than the estimate.
				// Overshoot was higher than expected
				// Increase estimator to increase the estimated overshoot
				increaseEstimator(&(cs.heatEstimator), error);
			}
			if(error < cc.heatingTargetLower){
				// Peak temperature was lower than the estimate.
				// Overshoot was lower than expected
				// Decrease estimator to decrease the estimated overshoot
				decreaseEstimator(&(cs.heatEstimator), error);
			}
			detected = INFO_POSITIVE_PEAK;
		}
		else if(timeSinceHeating() > HEAT_PEAK_DETECT_TIME){
			if(fridgeSensor->readFastFiltered() < (cv.posPeakEstimate+cc.heatingTargetLower)){
				// Idle period almost reaches maximum allowed time for peak detection
				// This is the heat, then drift up too slow (but in the right direction).
				// estimator is too high
				peak=fridgeSensor->readFastFiltered();
				decreaseEstimator(&(cs.heatEstimator), error);
				detected = INFO_POSITIVE_DRIFT;
			}
			else{
				// maximum time for peak estimation reached
				doPosPeakDetect = false;
			}
		}
		if(detected){
			newEstimator = cs.heatEstimator;
			cv.posPeak = peak;
			doPosPeakDetect = false;
		}
	}
	else if(doNegPeakDetect && !stateIsCooling()){
		peak = fridgeSensor->detectNegPeak();
		estimate = cv.negPeakEstimate;
		error = peak-estimate;
		oldEstimator = cs.coolEstimator;
		if(peak != INVALID_TEMP){
			// negative peak detected
			if(error < cc.coolingTargetLower){
				// Peak temperature was lower than the estimate.
				// Overshoot was higher than expected
				// Increase estimator to increase the estimated overshoot
				increaseEstimator(&(cs.coolEstimator), error);
			}
			if(error > cc.coolingTargetUpper){
				// Peak temperature was higher than the estimate.
				// Overshoot was lower than expected
				// Decrease estimator to decrease the estimated overshoot
				decreaseEstimator(&(cs.coolEstimator), error);

			}
			detected = INFO_NEGATIVE_PEAK;
		}
		else if(timeSinceCooling() > COOL_PEAK_DETECT_TIME){
			if(fridgeSensor->readFastFiltered() > (cv.negPeakEstimate+cc.coolingTargetUpper)){
				// Idle period almost reaches maximum allowed time for peak detection
				// This is the cooling, then drift down too slow (but in the right direction).
				// estimator is too high
				peak = fridgeSensor->readFastFiltered();
				decreaseEstimator(&(cs.coolEstimator), error);
				detected = INFO_NEGATIVE_DRIFT;
			}
			else{
				// maximum time for peak estimation reached
				doNegPeakDetect=false;
			}
		}
		if(detected){
			newEstimator = cs.coolEstimator;
			cv.negPeak = peak;
			doNegPeakDetect=false;
		}
	}
	if(detected){
		// send out log message for type of peak detected
		logInfoTempTempFixedFixed(detected, peak, estimate, oldEstimator, newEstimator);
	}
}

// Increase estimator at least 20%, max 50%s
void TempControl::increaseEstimator(temperature * estimator, temperature error){
	temperature factor = 614 + constrainTemp(abs((int)error)>>5, 0, 154); // 1.2 + 3.1% of error, limit between 1.2 and 1.5
	*estimator = multiplyFactorTemperatureDiff(factor, *estimator);
	if(*estimator < 25){
		*estimator = intToTempDiff(5)/100; // make estimator at least 0.05
	}
	eepromManager.storeTempSettings();
}

// Decrease estimator at least 16.7% (1/1.2), max 33.3% (1/1.5)
void TempControl::decreaseEstimator(temperature * estimator, temperature error){
	temperature factor = 426 - constrainTemp(abs((int)error)>>5, 0, 85); // 0.833 - 3.1% of error, limit between 0.667 and 0.833
	*estimator = multiplyFactorTemperatureDiff(factor, *estimator);
	eepromManager.storeTempSettings();
}

uint16_t TempControl::timeSinceCooling(void){
	return ticks.timeSince(lastCoolTime);
}

uint16_t TempControl::timeSinceHeating(void){
	return ticks.timeSince(lastHeatTime);
}

uint16_t TempControl::timeSinceIdle(void){
	return ticks.timeSince(lastIdleTime);
}

uint16_t TempControl::timeSinceHeatingAndCooling(void){
	return ticks.timeSince(lastBothOnTime);
}

void TempControl::loadDefaultSettings(){
#if BREWPI_EMULATE
	setMode(MODE_BEER_CONSTANT);
#else
	setMode(MODE_OFF);
#endif
	cs.beerSetting = intToTemp(20);
	cs.fridgeSetting = intToTemp(20);
	cs.heatEstimator = intToTempDiff(2)/10; // 0.2
	cs.coolEstimator=intToTempDiff(5);
}

void TempControl::storeConstants(eptr_t offset){
	eepromAccess.writeControlConstants(offset,  cc, sizeof(ControlConstants));
}

void TempControl::loadConstants(eptr_t offset){
	eepromAccess.readControlConstants(cc, offset, sizeof(ControlConstants));
	bool valid = (cc.tempFormat == 'C' || cc.tempFormat == 'F')
		&& cc.tempSettingMin < cc.tempSettingMax
		&& cc.fridgeFastFilter <= 7 && cc.fridgeSlowFilter <= 7 && cc.fridgeSlopeFilter <= 7
		&& cc.beerFastFilter <= 7 && cc.beerSlowFilter <= 7 && cc.beerSlopeFilter <= 7;
	if(!valid){
		loadDefaultConstants();
		storeConstants(offset);
		return;
	}
	// hysteresisMode = Independent pulse PI only (0/1)
	if(cc.hysteresisMode > HYSTERESIS_MODE_PID_ON){
		cc.hysteresisMode = HYSTERESIS_MODE_PID_OFF;
	}
	// Sanity for the Independent heater pulse PI. A zero Kp or a pulse target
	// outside 0.25..4 sensor steps would make the learner run away, so those
	// fall back to the compiled defaults instead of being trusted.
	if(cc.indPiKp <= 0){
		cc.indPiKp = IND_PI_KP_DEFAULT;
	}
	if(cc.indPiKi < 0){
		cc.indPiKi = IND_PI_KI_DEFAULT;
	}
	if(cc.indPiPulseLsb < 8 || cc.indPiPulseLsb > 128){	// 0.25 .. 4 steps
		cc.indPiPulseLsb = IND_PI_PULSE_DEFAULT;
	}
	initFilters();
}

// write new settings to EEPROM to be able to reload them after a reset
// The update functions only write to EEPROM if the value has changed
void TempControl::storeSettings(eptr_t offset){
	eepromAccess.writeControlSettings(offset, cs, sizeof(ControlSettings));
	storedBeerSetting = cs.beerSetting;
}

void TempControl::loadSettings(eptr_t offset){
	eepromAccess.readControlSettings(cs, offset, sizeof(ControlSettings));
	logDebug("loaded settings");
	// A zeroed or truncated settings file leaves cs.mode as '\0'. The web UI maps
	// the mode character to a label, so an unknown one showed up as "undefined"
	// and the controller looked like it was in no mode at all. Fall back to OFF.
	if(cs.mode != MODE_OFF && cs.mode != MODE_BEER_CONSTANT && cs.mode != MODE_FRIDGE_CONSTANT
		&& cs.mode != MODE_BEER_PROFILE && cs.mode != MODE_INDEPENDENT && cs.mode != MODE_TEST){
		logDebug("invalid stored mode '%c', falling back to OFF", cs.mode);
		cs.mode = MODE_OFF;
	}
	storedBeerSetting = cs.beerSetting;
	setMode(cs.mode, true);		// force the mode update
}

void TempControl::loadDefaultConstants(void){
	memcpy_P((void*) &tempControl.cc, (void*) &tempControl.ccDefaults, sizeof(ControlConstants));
	initFilters();
}

void TempControl::initFilters()
{
	fridgeSensor->setFastFilterCoefficients(cc.fridgeFastFilter);
	fridgeSensor->setSlowFilterCoefficients(cc.fridgeSlowFilter);
	fridgeSensor->setSlopeFilterCoefficients(cc.fridgeSlopeFilter);
	beerSensor->setFastFilterCoefficients(cc.beerFastFilter);
	beerSensor->setSlowFilterCoefficients(cc.beerSlowFilter);
	beerSensor->setSlopeFilterCoefficients(cc.beerSlopeFilter);
}

void TempControl::setMode(char newMode, bool force){
	logDebug("TempControl::setMode from %c to %c", cs.mode, newMode);

	// Same mode without force must not idle the actuators. Independent Apply used
	// to send mode 'i' again, which dropped a waiting state back to IDLE and
	// the following setpoint write called reset(), opening both relays.
	if(newMode == cs.mode && !force) return;

	if(newMode != cs.mode || state == WAITING_TO_HEAT || state == WAITING_TO_COOL || state == WAITING_FOR_PEAK_DETECT){
		state = IDLE;
		force = true;
	}
	if (force) {
		cs.mode = newMode;
		if(newMode == MODE_OFF){
			cs.beerSetting = INVALID_TEMP;
			cs.fridgeSetting = INVALID_TEMP;
		}
		eepromManager.storeTempSettings();
	}
}

bool TempControl::isSensorConnected(uint8_t which){
	if(which == 0) return beerSensor->isConnected();
	if(which == 1) return fridgeSensor->isConnected();
	return ambientSensor->isConnected();
}

// Seconds since the last valid reading, or 0xFFFFFFFF when none was ever seen.
uint32_t TempControl::sensorAgeSeconds(uint8_t which){
	if(which > 2 || !sensorSeenMs[which]) return 0xFFFFFFFFu;
	return (millis() - sensorSeenMs[which]) / 1000u;
}

temperature TempControl::getBeerTemp(void){
	if(beerSensor->isConnected()){
		return beerSensor->readFastFiltered();
	}
	else{
		return INVALID_TEMP;
	}
}

temperature TempControl::getBeerSetting(void){
	return cs.beerSetting;
}

temperature TempControl::getFridgeTemp(void){
	if(fridgeSensor->isConnected()){
		return fridgeSensor->readFastFiltered();
	}
	else{
		return INVALID_TEMP;
	}
}

temperature TempControl::getFridgeSetting(void){
	return cs.fridgeSetting;
}

bool TempControl::isIndependentPidOn(void){
	return (cs.mode == MODE_INDEPENDENT && cc.hysteresisMode == HYSTERESIS_MODE_PID_ON);
}

uint8_t TempControl::independentHysteresisMode(void){
	return cc.hysteresisMode;
}

static const char* piPhaseName(uint8_t phase){
	switch(phase){
		case 0: return "IDLE";
		case 1: return "HEAT";
		case 2: return "WAIT_PEAK";
		default: return "?";
	}
}

void TempControl::appendIndependentHeatDebug(String& out){
	char tbuf[16];
	out += "mode:";
	out += cs.mode;
	out += " hystMode:";
	out += String((unsigned)cc.hysteresisMode);
	out += " predictive:";
	out += isIndependentPidOn() ? "1" : "0";
	out += "\n";
	out += "phase:";
	out += piPhaseName(piPhase);
	out += " (";
	out += String((unsigned)piPhase);
	out += ")\n";
	out += "heaterOn:";
	out += independentHeaterOn ? "1" : "0";
	out += " coolerOn:";
	out += independentCoolerOn ? "1" : "0";
	out += "\n";
	out += "duty_pct:";
	out += String((unsigned)piDuty);
	out += "\n";
	out += "onTimeSec:";
	out += String(piOnTime);
	out += "\n";
	out += "offTimeSec:";
	out += String(piOffTime);
	out += "\n";
	out += "amp:";
	if(piAmp == 0){
		out += "0";
	}else{
		out += tempDiffToString(tbuf, piAmp, 3, 12);
	}
	out += "\n";
	out += "coast:";
	if(piCoast == 0){
		out += "0";
	}else{
		out += tempDiffToString(tbuf, piCoast, 3, 12);
	}
	out += "\n";
	out += "guard:";
	out += tempDiffToString(tbuf, piGuard(), 3, 12);
	out += "\n";
	out += "integral_degCmin:";
	out += String((long)(piIntegral / (60L * 512L)));
	out += ".";
	out += String((unsigned long)((labs(piIntegral) / 60L) % 512L) * 10L / 512L);
	out += "\n";
	out += "Kp:";
	out += tempDiffToString(tbuf, cc.indPiKp, 2, 12);
	out += " Ki:";
	out += tempDiffToString(tbuf, cc.indPiKi, 2, 12);
	out += " pulseLsb:";
	out += tempDiffToString(tbuf, cc.indPiPulseLsb, 2, 12);
	out += "\n";
	out += "peakTemp:";
	if(piPeak == INVALID_TEMP){
		out += "na";
	}else{
		out += tempToString(tbuf, piPeak, 3, 12);
	}
	out += "\n";
	out += "beerFast:";
	out += tempToString(tbuf, beerSensor->readFastFiltered(), 3, 12);
	out += " beerSlow:";
	out += tempToString(tbuf, beerSensor->readSlowFiltered(), 3, 12);
	out += "\n";
	out += "beerSet:";
	out += tempToString(tbuf, cs.beerSetting, 3, 12);
	out += " U(beerSet+heatTargetH):";
	out += tempToString(tbuf, cs.beerSetting + cc.heatingTargetUpper, 3, 12);
	out += "\n";
	out += "heatTargetH:";
	out += tempDiffToString(tbuf, cc.heatingTargetUpper, 3, 12);
	out += " heatTargetL:";
	out += tempDiffToString(tbuf, cc.heatingTargetLower, 3, 12);
	out += "\n";
	out += "minHeatTime:";
	out += String(cc.minHeatTime);
	out += " maxHeatTime:";
	out += String(cc.maxHeatTime);
	out += " minHeatIdleTime:";
	out += String(cc.minHeatIdleTime);
	out += "\n";
}

bool TempControl::applyIndependentHeatDebug(const char* key, const char* value){
	if(!key || !value){
		return false;
	}
	if(strcmp(key, "reset") == 0){
		resetIndependentPulsePi();
		independentHeaterOn = false;
		return true;
	}
	if(strcmp(key, "onTime") == 0 || strcmp(key, "onTimeSec") == 0){
		piOnTime = (uint16_t)atoi(value);
		return true;
	}
	if(strcmp(key, "amp") == 0){
		piAmp = (temperature)atoi(value);
		return true;
	}
	if(strcmp(key, "coast") == 0){
		piCoast = (temperature)atoi(value);
		return true;
	}
	if(strcmp(key, "hystMode") == 0 || strcmp(key, "predictive") == 0){
		uint8_t v = (uint8_t)atoi(value);
		cc.hysteresisMode = (v != 0) ? HYSTERESIS_MODE_PID_ON : HYSTERESIS_MODE_PID_OFF;
		if(cc.hysteresisMode == HYSTERESIS_MODE_PID_OFF){
			resetIndependentPulsePi();
		}
		eepromManager.storeTempConstantsAndSettings();
		return true;
	}
	if(strcmp(key, "maxHeatTime") == 0){
		cc.maxHeatTime = (uint16_t)atoi(value);
		eepromManager.storeTempConstantsAndSettings();
		return true;
	}
	return false;
}

void TempControl::appendIndependentHeatDebugForm(String& html){
	html += F("<form method=GET action=/pid>");
	html += F("<label>onTimeSec <input name=onTime type=number min=1 value=");
	html += String(piOnTime);
	html += F("> s (max 300)</label>");
	html += F("<label>hystMode <input name=hystMode type=number min=0 max=1 value=");
	html += String((unsigned)cc.hysteresisMode);
	html += F("> 0/1</label>");
	html += F("<label>maxHeatTime <input name=maxHeatTime type=number min=0 value=");
	html += String(cc.maxHeatTime);
	html += F("> s (0=unlimited, capped at 300)</label>");
	html += F("<button type=submit>Apply</button>");
	html += F("<button type=submit name=reset value=1>Reset learn</button>");
	html += F("</form>");
}

void TempControl::setBeerTemp(temperature newTemp){
	temperature oldBeerSetting = cs.beerSetting;
	cs.beerSetting= newTemp;
	if(cs.mode == MODE_INDEPENDENT){
		if(!profileDrivenFlag){
			theSettings.setStandbyBeer(newTemp);
			eepromManager.storeTempSettings();
		}else if(theSettings.rampLatched()){
			theSettings.setStandbyBeer(newTemp);
			eepromManager.storeTempSettings();
		}else if(abs(storedBeerSetting - newTemp) > intToTempDiff(1)/4){
			eepromManager.storeTempSettings();
		}
		updateState();
		return;
	}
	if(!profileDrivenFlag && (cs.mode == MODE_BEER_CONSTANT || cs.mode == MODE_BEER_PROFILE)){
		theSettings.setStandbyBeer(newTemp);
	}
	if(abs(oldBeerSetting - newTemp) > intToTempDiff(1)/2){ // more than half degree C difference with old setting
		reset(); // reset controller
	}
	updatePID();
	updateState();
	if((cs.mode != MODE_BEER_PROFILE && cs.mode != MODE_INDEPENDENT) || abs(storedBeerSetting - newTemp) > intToTempDiff(1)/4){
		// more than 1/4 degree C difference with EEPROM
		// Do not store settings every time in profile mode, because EEPROM has limited number of write cycles.
		// A temperature ramp would cause a lot of writes. The same applies to independent mode,
		// since the ramp there drives cs.beerSetting (the heater target) exactly the same way.
		// If Raspberry Pi is connected, it will update the settings anyway. This is just a safety feature.
		eepromManager.storeTempSettings();
	}
}

void TempControl::setFridgeTemp(temperature newTemp){
	cs.fridgeSetting = newTemp;
	if(cs.mode == MODE_INDEPENDENT || profileDrivenFlag){
		if(!profileDrivenFlag){
			theSettings.setStandbyFridge(newTemp);
			eepromManager.storeTempSettings();
		}else if(theSettings.rampLatched()){
			theSettings.setStandbyFridge(newTemp);
			eepromManager.storeTempSettings();
		}
		updateState();
		return;
	}
	if(cs.mode == MODE_FRIDGE_CONSTANT) theSettings.setStandbyFridge(newTemp);
	reset(); // reset peak detection and PID
	updatePID();
	updateState();
	eepromManager.storeTempSettings();
}

bool TempControl::stateIsCooling(void){
	return (state==COOLING || state==COOLING_MIN_TIME);
}
bool TempControl::stateIsHeating(void){
	return (state==HEATING || state==HEATING_MIN_TIME);
}

const ControlConstants TempControl::ccDefaults PROGMEM =
{
	// Do Not change the order of these initializations!
	/* tempFormat */ 'C',
	/* tempSettingMin */ intToTemp(1),	// +1 deg Celsius
	/* tempSettingMax */ intToTemp(30),	// +30 deg Celsius

	// control defines, also in fixed point format (7 int bits, 9 frac bits), so multiplied by 2^9=512
	/* Kp	*/ intToTempDiff(5),	// +5
	/* Ki	*/ intToTempDiff(1)/4, // +0.25
	/* Kd	*/ intToTempDiff(-3)/2,	// -1.5
	/* iMaxError */ intToTempDiff(5)/10,  // 0.5 deg

	// Classic idle-range start thresholds (fridge/beer/profile)
	/* idleRangeHigh */ intToTempDiff(1),	// +1.0 deg Celsius
	/* idleRangeLow */ intToTempDiff(-1),	// -1.0 deg Celsius

	// Peak estimator (classic) / Independent on/off bands
	/* heatingTargetUpper */ intToTempDiff(3)/10,	// +0.3 deg Celsius
	/* heatingTargetLower */ intToTempDiff(-2)/10,	// -0.2 deg Celsius
	/* coolingTargetUpper */ intToTempDiff(2)/10,	// +0.2 deg Celsius
	/* coolingTargetLower */ intToTempDiff(-3)/10,	// -0.3 deg Celsius

	// maximum history to take into account, in seconds
	/* maxHeatTimeForEstimate */ 600,
	/* maxCoolTimeForEstimate */ 1200,

	// Set filter coefficients. This is the b value. See FilterFixed.h for delay times.
	// The delay time is 3.33 * 2^b * number of cascades
	/* fridgeFastFilter */ 1u,
	/* fridgeSlowFilter */ 4u,
	/* fridgeSlopeFilter */ 3u,
	/* beerFastFilter */ 3u,
	/* beerSlowFilter */ 4u,
	/* beerSlopeFilter */ 4u,

	/* lightAsHeater */ 0,
	/* rotaryHalfSteps */ 0,

	/* pidMax */ intToTempDiff(10),	// +/- 10 deg Celsius
#if 1 //SettableMinimumCoolTime
    /* minCoolTime */ 180,
    /* minCoolIdleTime */ 300,
    /* minHeatTime */  180,
    /* minHeatIdleTime */ 300,
    /* mutexDeadTime */ 600,
#endif
	/* hysteresisMode */ HYSTERESIS_MODE_PID_OFF,
	/* maxHeatTime */ 0,
	/* staleSensorSec */ 20,
	/* oneWireRetryCount */ 2,
	/* indPiKp */ IND_PI_KP_DEFAULT,
	/* indPiKi */ IND_PI_KI_DEFAULT,
	/* indPiPulseLsb */ IND_PI_PULSE_DEFAULT
};
