import assert from "node:assert";
import { describe, it } from "node:test";

import { Key, matchesKey, parseKey, setKittyProtocolActive } from "../src/keys.ts";

describe("matchesKey", () => {
  describe("Kitty protocol with alternate keys (non-Latin layouts)", () => {
    it("should match Ctrl+c when pressing Ctrl+С (Cyrillic) with base layout key", () => {
      setKittyProtocolActive(true);
      const cyrillicCtrlC = "\x1b[1089::99;5u";
      assert.strictEqual(matchesKey(cyrillicCtrlC, "ctrl+c"), true);
      setKittyProtocolActive(false);
    });

    it("should match Ctrl+d when pressing Ctrl+В (Cyrillic) with base layout key", () => {
      setKittyProtocolActive(true);
      const cyrillicCtrlD = "\x1b[1074::100;5u";
      assert.strictEqual(matchesKey(cyrillicCtrlD, "ctrl+d"), true);
      setKittyProtocolActive(false);
    });

    it("should match Ctrl+z when pressing Ctrl+Я (Cyrillic) with base layout key", () => {
      setKittyProtocolActive(true);
      const cyrillicCtrlZ = "\x1b[1103::122;5u";
      assert.strictEqual(matchesKey(cyrillicCtrlZ, "ctrl+z"), true);
      setKittyProtocolActive(false);
    });

    it("should match Ctrl+Shift+p with base layout key", () => {
      setKittyProtocolActive(true);
      const cyrillicCtrlShiftP = "\x1b[1079::112;6u";
      assert.strictEqual(matchesKey(cyrillicCtrlShiftP, "ctrl+shift+p"), true);
      setKittyProtocolActive(false);
    });
  });
});

describe("matchesKey", () => {
  describe("Kitty protocol with alternate keys (non-Latin layouts)", () => {
    it("should still match direct codepoint when no base layout key", () => {
      setKittyProtocolActive(true);
      const latinCtrlC = "\x1b[99;5u";
      assert.strictEqual(matchesKey(latinCtrlC, "ctrl+c"), true);
      setKittyProtocolActive(false);
    });

    it("should match super-modified Kitty bindings, including combined modifiers", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(matchesKey("\x1b[107;9u", "super+k"), true);
      assert.strictEqual(matchesKey("\x1b[13;9u", "super+enter"), true);
      assert.strictEqual(matchesKey("\x1b[107;13u", Key.ctrlSuper("k")), true);
      assert.strictEqual(matchesKey("\x1b[107;13u", "ctrl+super+k"), true);
      assert.strictEqual(matchesKey("\x1b[107;14u", "ctrl+shift+super+k"), true);
      assert.strictEqual(matchesKey("\x1b[107;13u", "super+k"), false);
      assert.strictEqual(parseKey("\x1b[107;9u"), "super+k");
      assert.strictEqual(parseKey("\x1b[13;9u"), "super+enter");
      assert.strictEqual(parseKey("\x1b[107;13u"), "ctrl+super+k");
      assert.strictEqual(parseKey("\x1b[107;14u"), "shift+ctrl+super+k");
      setKittyProtocolActive(false);
    });

    it("should match digit bindings via Kitty CSI-u", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(matchesKey("\x1b[49u", "1"), true);
      assert.strictEqual(matchesKey("\x1b[49;5u", "ctrl+1"), true);
      assert.strictEqual(matchesKey("\x1b[49;5u", "ctrl+2"), false);
      assert.strictEqual(parseKey("\x1b[49u"), "1");
      assert.strictEqual(parseKey("\x1b[49;5u"), "ctrl+1");
      setKittyProtocolActive(false);
    });
  });
});

describe("matchesKey", () => {
  describe("Kitty protocol with alternate keys (non-Latin layouts)", () => {
    it("should normalize Kitty keypad functional keys to logical digits, symbols, and navigation", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(matchesKey("\x1b[57400u", "1"), true);
      assert.strictEqual(matchesKey("\x1b[57410u", "/"), true);
      assert.strictEqual(matchesKey("\x1b[57417u", "left"), true);
      assert.strictEqual(matchesKey("\x1b[57426u", "delete"), true);
      assert.strictEqual(parseKey("\x1b[57399u"), "0");
      assert.strictEqual(parseKey("\x1b[57409u"), ".");
      assert.strictEqual(parseKey("\x1b[57413u"), "+");
      assert.strictEqual(parseKey("\x1b[57416u"), ",");
      assert.strictEqual(parseKey("\x1b[57417u"), "left");
      assert.strictEqual(parseKey("\x1b[57418u"), "right");
      assert.strictEqual(parseKey("\x1b[57419u"), "up");
      assert.strictEqual(parseKey("\x1b[57420u"), "down");
      assert.strictEqual(parseKey("\x1b[57421u"), "pageUp");
      assert.strictEqual(parseKey("\x1b[57422u"), "pageDown");
      assert.strictEqual(parseKey("\x1b[57423u"), "home");
      assert.strictEqual(parseKey("\x1b[57424u"), "end");
      assert.strictEqual(parseKey("\x1b[57425u"), "insert");
      assert.strictEqual(parseKey("\x1b[57426u"), "delete");
      setKittyProtocolActive(false);
    });

    it("should match shifted symbols by their produced character", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(matchesKey("\x1b[61:43;2u", "+"), true);
      assert.strictEqual(matchesKey("\x1b[61:43;2u", "shift+="), true);
      assert.strictEqual(parseKey("\x1b[61:43;2u"), "+");
      assert.strictEqual(matchesKey("\x1b[61:43;6u", "ctrl++"), true);
      assert.strictEqual(parseKey("\x1b[61:43;6u"), "ctrl++");
      setKittyProtocolActive(false);
    });
  });
});

describe("matchesKey", () => {
  describe("Kitty protocol with alternate keys (non-Latin layouts)", () => {
    it("should handle shifted key in format", () => {
      setKittyProtocolActive(true);
      const shiftedKey = "\x1b[99:67:99;2u";
      assert.strictEqual(matchesKey(shiftedKey, "shift+c"), true);
      setKittyProtocolActive(false);
    });

    it("should handle event type in format", () => {
      setKittyProtocolActive(true);
      const releaseEvent = "\x1b[1089::99;5:3u";
      assert.strictEqual(matchesKey(releaseEvent, "ctrl+c"), true);
      setKittyProtocolActive(false);
    });

    it("should handle full format with shifted key, base key, and event type", () => {
      setKittyProtocolActive(true);
      const fullFormat = "\x1b[1089:1057:99;6:2u";
      assert.strictEqual(matchesKey(fullFormat, "ctrl+shift+c"), true);
      setKittyProtocolActive(false);
    });

    it("should prefer codepoint for Latin letters even when base layout differs", () => {
      setKittyProtocolActive(true);
      const dvorakCtrlK = "\x1b[107::118;5u";
      assert.strictEqual(matchesKey(dvorakCtrlK, "ctrl+k"), true);
      assert.strictEqual(matchesKey(dvorakCtrlK, "ctrl+v"), false);
      setKittyProtocolActive(false);
    });
  });
});

describe("matchesKey", () => {
  describe("Kitty protocol with alternate keys (non-Latin layouts)", () => {
    it("should prefer codepoint for symbol keys even when base layout differs", () => {
      setKittyProtocolActive(true);
      const dvorakCtrlSlash = "\x1b[47::91;5u";
      assert.strictEqual(matchesKey(dvorakCtrlSlash, "ctrl+/"), true);
      assert.strictEqual(matchesKey(dvorakCtrlSlash, "ctrl+["), false);
      setKittyProtocolActive(false);
    });

    it("should not match wrong key even with base layout", () => {
      setKittyProtocolActive(true);
      const cyrillicCtrlC = "\x1b[1089::99;5u";
      assert.strictEqual(matchesKey(cyrillicCtrlC, "ctrl+d"), false);
      setKittyProtocolActive(false);
    });

    it("should not match wrong modifiers even with base layout", () => {
      setKittyProtocolActive(true);
      const cyrillicCtrlC = "\x1b[1089::99;5u";
      assert.strictEqual(matchesKey(cyrillicCtrlC, "ctrl+shift+c"), false);
      setKittyProtocolActive(false);
    });
  });
});

describe("matchesKey", () => {
  describe("modifyOtherKeys matching", () => {
    it("should match xterm modifyOtherKeys Ctrl+c", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;5;99~", "ctrl+c"), true);
      assert.strictEqual(parseKey("\x1b[27;5;99~"), "ctrl+c");
    });

    it("should match xterm modifyOtherKeys Ctrl+d", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;5;100~", "ctrl+d"), true);
      assert.strictEqual(parseKey("\x1b[27;5;100~"), "ctrl+d");
    });

    it("should match xterm modifyOtherKeys Ctrl+z", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;5;122~", "ctrl+z"), true);
      assert.strictEqual(parseKey("\x1b[27;5;122~"), "ctrl+z");
    });

    it("should match xterm modifyOtherKeys Enter variants", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;5;13~", "ctrl+enter"), true);
      assert.strictEqual(matchesKey("\x1b[27;2;13~", "shift+enter"), true);
      assert.strictEqual(matchesKey("\x1b[27;3;13~", "alt+enter"), true);
      assert.strictEqual(parseKey("\x1b[27;5;13~"), "ctrl+enter");
      assert.strictEqual(parseKey("\x1b[27;2;13~"), "shift+enter");
      assert.strictEqual(parseKey("\x1b[27;3;13~"), "alt+enter");
    });

    it("should match xterm modifyOtherKeys Tab variants", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;2;9~", "shift+tab"), true);
      assert.strictEqual(matchesKey("\x1b[27;5;9~", "ctrl+tab"), true);
      assert.strictEqual(matchesKey("\x1b[27;3;9~", "alt+tab"), true);
      assert.strictEqual(parseKey("\x1b[27;2;9~"), "shift+tab");
      assert.strictEqual(parseKey("\x1b[27;5;9~"), "ctrl+tab");
      assert.strictEqual(parseKey("\x1b[27;3;9~"), "alt+tab");
    });
  });
});
