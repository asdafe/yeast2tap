// Central number rules for yeast2tap.
//
// One decimal separator everywhere: the dot. A comma is never accepted and is
// never silently converted, because a silent conversion hides a typo and can turn
// "2,75" into 2.75 or, worse, into 2. Regional settings, the browser language and
// the operating system locale must not change any of this, so nothing here uses
// toLocaleString, Intl.NumberFormat or the input type=number locale behaviour.
//
// Every page loads this file; page scripts call Num.field() / Num.parse() instead
// of parseFloat() on user input, and Num.fmt() instead of hand rolled formatting.

var Num = (function () {
    // num.js is embedded verbatim, so it cannot hold a <%= %> placeholder. Every
    // page sets window.__numDotMsg from partials/theme-init.html instead.
    var MSG = window.__numDotMsg || "Use a dot for decimals (2.75), not a comma (2,75).";
    // [-+]digits[.digits] or [-+].digits, optional exponent. No comma, no spaces.
    var DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

    // True when the text contains a comma anywhere, which is the one typo we can
    // name precisely.
    function hasComma(text) {
        return String(text == null ? "" : text).indexOf(",") >= 0;
    }

    // Strict parse. Returns a finite number, or null when the text is not a number
    // in the dot convention. Empty text is null: callers decide whether that means
    // "leave unchanged" or "invalid".
    function parse(text) {
        var s = String(text == null ? "" : text).trim();
        if (!s || hasComma(s) || !DECIMAL.test(s)) return null;
        var v = Number(s);
        return isFinite(v) ? v : null;
    }

    // Read a form field. A rejected value marks the field and returns null, so the
    // caller keeps the previous value instead of storing a truncated number.
    function field(el, label) {
        if (!el) return null;
        var v = parse(el.value);
        if (v === null) {
            mark(el, true);
            alert((label || el.id || "Value") + ": " + MSG);
            if (el.focus) el.focus();
            return null;
        }
        mark(el, false);
        return v;
    }

    function mark(el, bad) {
        if (!el || !el.classList) return;
        if (bad) el.classList.add("num-bad");
        else el.classList.remove("num-bad");
    }

    // Fixed decimals with a dot, or a placeholder for missing/invalid values.
    function fmt(value, decimals) {
        var v = Number(value);
        if (value === null || value === undefined || value === "" || !isFinite(v)) return "--";
        return v.toFixed(decimals === undefined ? 2 : decimals);
    }

    // Number rounded to the given decimals, for sending over the wire. Returns null
    // for anything that is not a finite number so a bad value never reaches the
    // controller as 0.
    function round(value, decimals) {
        var v = Number(value);
        if (value === null || value === undefined || value === "" || !isFinite(v)) return null;
        var p = Math.pow(10, decimals === undefined ? 2 : decimals);
        return Math.round(v * p) / p;
    }

    // Live guard: flag a comma or any non-number as soon as it is typed in a
    // field marked class="num". Runs once per document.
    function guard() {
        if (typeof document === "undefined" || guard.done) return;
        guard.done = true;

        var css = document.createElement("style");
        css.textContent = ".num-bad{border-color:#b42318 !important;box-shadow:0 0 0 3px rgba(180,35,24,.16) !important}";
        document.head.appendChild(css);

        function check(el) {
            if (!el || !el.classList) return;
            mark(el, hasComma(el.value) || (el.value !== "" && parse(el.value) === null));
        }

        document.addEventListener("input", function (e) {
            if (e.target && e.target.matches && e.target.matches("input.num")) {
                check(e.target);
            }
        }, true);

        document.addEventListener("change", function (e) {
            if (e.target && e.target.matches && e.target.matches("input.num")) {
                check(e.target);
            }
        }, true);
    }

    return {
        parse: parse,
        field: field,
        fmt: fmt,
        round: round,
        hasComma: hasComma,
        mark: mark,
        guard: guard,
        message: MSG
    };
})();

Num.guard();
