#include "BrewPiProxy.h"
#include "VirtualSerial.h"

#include "Brewpi.h"
#include <stdarg.h>

#include "stddef.h"
#include "PiLink.h"

#include "Version.h"
#include "TemperatureFormats.h"
#include "TempControl.h"
#include "Display.h"
#include "JsonKeys.h"
#include "Ticks.h"
#include "Brewpi.h"
#include "EepromManager.h"
#include "EepromFormat.h"
#include "SettingsManager.h"
#include "Buzzer.h"
#include "Display.h"

QueueBuffer brewPiRxBuffer(2048);
QueueBuffer brewPiTxBuffer(2048);

static temperature float2InternalTemp(float ftemp){
	// Internal format is 9 fraction bits (512 steps per degree), not thousandths.
	// Adding round(frac*1000) overflows those 9 bits once the fraction passes .512,
	// so a rising ramp climbs too fast and snaps back at every whole degree.
	bool negative=false;
	if(ftemp < 0){
		negative = true;
		ftemp = - ftemp;
	}

	long_temperature iparts =(long_temperature) floor(ftemp);
	float frac = ftemp - (float) iparts;
	long_temperature fraction =(long_temperature) round(frac * (float) TEMP_FIXED_POINT_SCALE);
	if(fraction >= TEMP_FIXED_POINT_SCALE){
		iparts++;
		fraction -= TEMP_FIXED_POINT_SCALE;
	}
	long_temperature absval = (iparts << TEMP_FIXED_POINT_BITS) + fraction;
	long_temperature val = negative? (- absval):absval;
	val = convertToInternalTemp(val);
	return constrainTemp16(val);
}

void BrewPiProxy::write(char ch)
{
	brewPiRxBuffer.print(ch);
}

void BrewPiProxy::putLine(const char* str)
{
	brewPiRxBuffer.print(str);
	brewPiRxBuffer.print('\n');
}

void BrewPiProxy::begin(void (*readString)(const char*))
{
	_readString=readString;
}

void BrewPiProxy::loop(void)
{
	while(brewPiTxBuffer.available()){
		char ch=brewPiTxBuffer.read();
		 if(ch == '\n'){
			_lastLineBuff[_readPtr]='\0';
			memcpy(_lastLineBuff,_buff,_readPtr);
			_readPtr=0;
			(*_readString)(_lastLineBuff);
		}
		else
		if(ch == 0xB0){
			//for safty
			if(_readPtr < (BUFF_SIZE-2)){
				_buff[_readPtr++]=0xC2;
				_buff[_readPtr++]=0xB0;
			}
		 }
		 else
			 _buff[_readPtr++]=ch;
		if( _readPtr >= BUFF_SIZE) _readPtr=0; // just drop.
	}
}


float BrewPiProxy::getBeerTemp(void){
	return temperatureFloatValue(tempControl.getBeerTemp());
}

float BrewPiProxy::getBeerSet(void){
	return temperatureFloatValue(tempControl.getBeerSetting());	
}
float BrewPiProxy::getFridgeTemp(void){
	return temperatureFloatValue(tempControl.getFridgeTemp());
}
float BrewPiProxy::getFridgeSet(void){
	float t=temperatureFloatValue(tempControl.getFridgeSetting());
	return t;
}

bool BrewPiProxy::isIndependentPidOn(void){
	return tempControl.isIndependentPidOn();
}

char BrewPiProxy::getUnit(void){
	return tempControl.cc.tempFormat;
}
float BrewPiProxy::getMinSetTemp(void){
	return temperatureFloatValue(tempControl.cc.tempSettingMin);
}

float BrewPiProxy::getMaxSetTemp(void){
	return temperatureFloatValue(tempControl.cc.tempSettingMax);
}
char  BrewPiProxy::getMode(void){
	return tempControl.cs.mode;	
}
uint8_t BrewPiProxy::getState(void){
	return (uint8_t) tempControl.getState();
}

float BrewPiProxy::getRoomTemp(void){
	return temperatureFloatValue(tempControl.getRoomTemp());
}

bool BrewPiProxy::ambientSensorConnected(void)
{
	return tempControl.ambientSensor->isConnected();
}

uint32_t BrewPiProxy::getStatusTime(void){
	uint16_t time = UINT16_MAX; // init to max
	uint8_t state = tempControl.getState();
	uint16_t sinceIdleTime = tempControl.timeSinceIdle();
	if(state==IDLE){
		time = 	min(tempControl.timeSinceCooling(), tempControl.timeSinceHeating());
	}
	else if(state==COOLING || state==HEATING){
		time = sinceIdleTime;
	}
	else if(state==HEATING_AND_COOLING){
		time = tempControl.timeSinceHeatingAndCooling();
	}
	else if(state==COOLING_MIN_TIME){
		time =(tempControl.cc.minCoolTime > sinceIdleTime)? (tempControl.cc.minCoolTime -sinceIdleTime):0;
	}
	else if(state==HEATING_MIN_TIME){
		time = (tempControl.cc.minHeatTime > sinceIdleTime)? (tempControl.cc.minHeatTime-sinceIdleTime):0;
	}
	else if(state == WAITING_TO_COOL || state == WAITING_TO_HEAT){
		time = tempControl.getWaitTime();
	}
	return (uint32_t) time;
}


void BrewPiProxy::setMode(char mode){
	tempControl.setMode(mode);
}

void BrewPiProxy::setBeerSet(float temp){
	tempControl.setBeerTemp(float2InternalTemp(temp));
}

void BrewPiProxy::setFridgetSet(float temp){
	tempControl.setFridgeTemp(float2InternalTemp(temp));
}

void BrewPiProxy::setBeerSetFromProfile(float temp){
	tempControl.setProfileDriven(true);
	tempControl.setBeerTemp(float2InternalTemp(temp));
	tempControl.setProfileDriven(false);
}

void BrewPiProxy::setFridgeSetFromProfile(float temp){
	tempControl.setProfileDriven(true);
	tempControl.setFridgeTemp(float2InternalTemp(temp));
	tempControl.setProfileDriven(false);
}

