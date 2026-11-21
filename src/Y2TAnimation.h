#pragma once

#include "Brewpi.h"
#include "SharedLcd.h"

// Only the 20x4 HD44780 I2C path has the animation (see Config.h).
#if Y2T_ANIMATION_LCD
#include "IicLcd.h"

// One blocking run of the boot animation. clearAtEnd = true leaves a blank
// screen for the normal page; false keeps the last frame so the loop can pick
// it up without a visible break.
void y2tAnimBoot(IIClcd &lcd, bool clearAtEnd);

// The "Y2T Animation" LCD page (ShareModeY2TAnimation). While it is the visible
// page it owns the panel; the BrewPi page still buffers text but writes nothing.
class Y2TAnimationDisplay : public SharedLcdDisplay {
public:
	Y2TAnimationDisplay();

	// Continue the boot animation's last frame instead of starting over.
	void handOffFromBoot();

	void onShow();
	void onHide();
	void redraw();
	void loop();
	// EMIWorkaround re-inits the panel (screen + CGRAM gone): repaint from zero.
	void onRefresh();
	// loopAnimationBegin() clears by itself, so the manager must not clear again.
	bool clearOnShow() { return false; }
	// Only shown when selected as the display mode, never in the rotate cycle.
	bool skipInRotate() { return true; }

private:
	bool _fromBoot;
};

extern Y2TAnimationDisplay y2tAnimationDisplay;
#endif // Y2T_ANIMATION_LCD
