#pragma once

// Strict decimal parsing for values that arrive from outside: HTTP query strings,
// form fields, the line protocol and the profile JSON.
//
// The firmware never calls setlocale(), so newlib stays in the "C" locale and
// atof()/String::toFloat() already expect a dot. The problem with them is not the
// separator, it is the silence: atof("2,75") returns 2 and atof("abc") returns 0,
// so a typo becomes a real setpoint. These helpers refuse instead, letting the
// caller answer with an error code and change nothing.

#include <Arduino.h>

class NumberParse {
public:
	// Reads the whole string as a decimal number. Rejects a comma, trailing
	// garbage, an empty string and a non-finite result. Returns false on rejection.
	static bool decimal(const char* s, float& out) {
		while (*s == ' ' || *s == '\t') ++s;
		if (*s == '\0') return false;

		bool negative = false;
		if (*s == '+' || *s == '-') {
			negative = (*s == '-');
			++s;
		}

		bool digits = false, point = false;
		int decimals = 0;
		double value = 0.0;
		double scale = 1.0;
		for (; *s; ++s) {
			if (*s == '.') {
				if (point) return false;   // a second dot is never valid
				point = true;
				continue;
			}
			if (*s < '0' || *s > '9') return false;   // covers the comma too
			digits = true;
			if (!point) {
				value = value * 10.0 + (*s - '0');
				if (value > 1.0e9) return false;
			} else {
				if (++decimals > 9) return false;
				scale /= 10.0;
				value += (*s - '0') * scale;
			}
		}
		if (!digits) return false;
		out = (float)(negative ? -value : value);
		return true;
	}

	static bool decimal(const String& text, float& out) {
		return decimal(text.c_str(), out);
	}

	// Same, but the value must fall inside [low, high].
	static bool decimalInRange(const char* s, float& out, float low, float high) {
		if (!decimal(s, out)) return false;
		return out >= low && out <= high;
	}

	static bool decimalInRange(const String& text, float& out, float low, float high) {
		return decimalInRange(text.c_str(), out, low, high);
	}

	// Gravity sent by a device whose software we cannot change. A comma is the
	// decimal separator, and text after the number (a unit, a percent) is ignored.
	// "1,050" and "1,050 SG" both become 1.050. Returns false only when no number
	// is present.
	static bool gravity(const char* s, float& out) {
		if (!s) return false;
		while (*s == ' ' || *s == '\t') ++s;

		char buf[24];
		size_t n = 0;
		bool dot = false, digit = false;
		if (*s == '+' || *s == '-') {
			buf[n++] = *s++;
		}
		for (; *s && n + 1 < sizeof(buf); ++s) {
			char c = *s;
			if (c == ',') c = '.';
			if (c == '.') {
				if (dot) break;
				dot = true;
				buf[n++] = c;
				continue;
			}
			if (c < '0' || c > '9') break;
			digit = true;
			buf[n++] = c;
		}
		if (!digit) return false;
		buf[n] = 0;
		return decimal(buf, out);
	}

	static bool gravity(const String& text, float& out) {
		return gravity(text.c_str(), out);
	}
};
