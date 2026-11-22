#include "Brewpi.h"
#include "Y2TAnimation.h"

#if Y2T_ANIMATION_LCD

#include "Display.h"
#include "DisplayLcd.h"
#include "SharedLcd.h"

#define ANIM_COLS 20
#define ANIM_ROWS 4

// ---- animation constants (no dynamic memory anywhere) ----
static const int8_t WAVE[16] = {0,1,2,3,3,3,2,1,0,-1,-2,-3,-3,-3,-2,-1};
static const char TITLE[] = "Yeast 2 Tap";
#define TITLE_N     ((int)sizeof(TITLE) - 1)
#define TITLE_COL   ((ANIM_COLS - TITLE_N) / 2)
#define SETTLE      10      // resting beer level (pixels)
#define PEAK1       36      // main wave crest
#define PEAK2       28      // small trailing wave crest
#define DELAY2      9       // trailing wave lags the main one by this many columns
#define GAP         0       // gap between title and wave
#define REVEAL      (DELAY2 + 12 + GAP)
#define LOOP_P      64      // loop length, multiple of 16
#define FRAME_MS    20      // frame period of the looping animation
#define BOOT_LAST   47      // last boot frame
#define BOOT_DELAY  5       // ms between boot frames

// one text row of shadow copy, so unchanged cells are not re-sent over I2C
static uint8_t shadow[ANIM_ROWS][ANIM_COLS];
static uint8_t curR = 255, curC = 255;
static int lvBuf[ANIM_COLS];
static bool txtBuf[ANIM_COLS];

static uint8_t loopT;
static uint8_t loopRow = ANIM_ROWS;   // ANIM_ROWS = frame done, waiting for the next
static uint32_t loopLast;

#if SerialDebug
// Build with -DSerialDebug=1 to get the worst-case single-row draw time on the
// panel (release builds compile this out).
static uint32_t rowMaxUs = 0;
#endif

// Writes an already-built glyph into the next cell.
static void put(IIClcd &lcd, uint8_t r, uint8_t c, uint8_t ch)
{
	if (shadow[r][c] == ch) return;
	if (curR != r || curC != c) lcd.setCursor(c, r);
	lcd.write(ch);
	shadow[r][c] = ch;
	curR = r;
	curC = (c == ANIM_COLS - 1) ? 255 : c + 1;
}

// 1..7 pixel tall bars in CGRAM slots 0..6
static void makeBars(IIClcd &lcd)
{
	for (uint8_t h = 1; h <= 7; h++) {
		uint8_t c[8];
		for (uint8_t k = 0; k < 8; k++) c[k] = (k >= 8 - h) ? 0x1F : 0;
		lcd.createChar(h - 1, c);
	}
}

// Loads the glyphs, clears the panel and resets the drawing cache. Also used
// after the panel was re-initialised behind our back (EMIWorkaround).
static void animReset(IIClcd &lcd)
{
	makeBars(lcd);
	lcd.clear();
	memset(shadow, ' ', sizeof(shadow));
	curR = curC = 255;
}

// v = 1..9 rising, 10..13 falling back to the resting level
static int crest(int v, int base, int peak)
{
	if (v <= 9)  return base + (peak - base) * (v > 0 ? v : 0) / 9;
	if (v <= 13) return peak - (v - 9) * (peak - SETTLE) / 4;
	return SETTLE;
}

// u: frames since the main wave reached this column (negative = not yet)
static int level(int u, bool boot)
{
	int l1 = crest(u, boot ? 0 : SETTLE, PEAK1);
	int v  = u - DELAY2;
	int l2 = (v > 0 && v <= 13) ? crest(v, SETTLE, PEAK2) : 0;
	return l1 > l2 ? l1 : l2;
}

static void computeFrame(int t, bool boot)
{
	for (uint8_t c = 0; c < ANIM_COLS; c++) {
		int u  = t - c;
		int lv = level(u, boot);
		if (lv > 0) lv += WAVE[(c * 2 + t) & 15];   // ripples only where there is beer
		lvBuf[c]  = lv;
		txtBuf[c] = (u >= REVEAL) || (!boot && u <= 9);
	}
}

static void drawRow(IIClcd &lcd, uint8_t r)
{
	for (uint8_t c = 0; c < ANIM_COLS; c++) {
		int f = lvBuf[c] - (3 - r) * 8;
		uint8_t ch = f <= 0 ? (uint8_t)' ' : f >= 8 ? (uint8_t)0xFF : (uint8_t)(f - 1);
		if (r == 1 && f <= 0 && txtBuf[c]) {
			int idx = c - TITLE_COL;
			if (idx >= 0 && idx < TITLE_N) ch = (uint8_t)TITLE[idx];
		}
		put(lcd, r, c, ch);
	}
}

// ======================= boot animation (once, blocking) =======================

void y2tAnimBoot(IIClcd &lcd, bool clearAtEnd)
{
	animReset(lcd);
	for (int t = 0; t <= BOOT_LAST; t++) {
		computeFrame(t, true);
		for (uint8_t r = 0; r < ANIM_ROWS; r++) drawRow(lcd, r);
		if (t <= BOOT_LAST - 6) delay(BOOT_DELAY);
	}
	delay(500);
	if (clearAtEnd) lcd.clear();
}

// ======================= looping animation (non-blocking) =======================

static void loopBegin(IIClcd &lcd, bool fromBoot)
{
	if (fromBoot) {
		loopT = (BOOT_LAST + 1) % LOOP_P;   // next frame after the boot's last
	} else {
		animReset(lcd);
		loopT = 0;
	}
	loopRow = ANIM_ROWS;
	loopLast = millis();
}

// At most one row (20 cells) per call, so the main loop is never blocked long.
static void loopStep(IIClcd &lcd)
{
	if (loopRow >= ANIM_ROWS) {
		if (millis() - loopLast < FRAME_MS) return;
		loopLast = millis();
		computeFrame(loopT, false);
		loopRow = 0;
	}
#if SerialDebug
	uint32_t rowStartUs = micros();
#endif
	drawRow(lcd, loopRow++);
#if SerialDebug
	{
		// Worst-case cost of one row of 20 cells over I2C, printed on change.
		uint32_t spentUs = micros() - rowStartUs;
		if (spentUs > rowMaxUs) {
			rowMaxUs = spentUs;
			DBG_PRINTF("Y2T row worst %lu us\n", (unsigned long)rowMaxUs);
		}
	}
#endif
	if (loopRow >= ANIM_ROWS) loopT = (loopT + 1) % LOOP_P;
}

// ======================= the LCD page =======================

Y2TAnimationDisplay y2tAnimationDisplay;

Y2TAnimationDisplay::Y2TAnimationDisplay()
{
	_fromBoot = false;
}

void Y2TAnimationDisplay::handOffFromBoot()
{
	_fromBoot = true;
}

void Y2TAnimationDisplay::onShow()
{
	loopBegin(*getLcd(), _fromBoot);
	_fromBoot = false;
}

void Y2TAnimationDisplay::onHide()
{
	// give the panel back: blank it, put the firmware's own glyphs back, and
	// refill the BrewPi page's buffer so it can be redrawn in one go.
	getLcd()->clear();
	_manager->restoreCustomChars();
	display.forceRedraw();
}

void Y2TAnimationDisplay::redraw()
{
	// The next loop() call repaints the frame row by row; nothing to block on.
}

void Y2TAnimationDisplay::loop()
{
	loopStep(*getLcd());
}

void Y2TAnimationDisplay::onRefresh()
{
	animReset(*getLcd());
}

#endif // Y2T_ANIMATION_LCD
