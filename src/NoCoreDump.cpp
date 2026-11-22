/*
 * Core dump is disabled on purpose.
 *
 * The partition table has no "coredump" partition, so a crash could never store
 * a dump anyway: the prebuilt ESP-IDF panic handler called into libespcoredump
 * only to fail and log. Those two entry points are the only references that pull
 * the whole coredump archive (about 11.8 KB of flash) into the image, so defining
 * them here makes the linker resolve them from this object and leave the archive
 * out entirely.
 *
 * Panic behaviour is untouched: esp_panic_handler still prints the reason, the
 * register dump and the backtrace to the serial port and still reboots
 * (CONFIG_ESP_SYSTEM_PANIC_PRINT_REBOOT).
 */

#include <Arduino.h>

#if defined(ESP32)

#include <esp_err.h>

extern "C" {

// Called from startup.c once at boot.
esp_err_t esp_core_dump_init(void) {
	return ESP_ERR_NOT_SUPPORTED;
}

// Called from panic.c before the reboot.
void esp_core_dump_to_flash(void *frame) {
	(void)frame;
}

}

#endif
