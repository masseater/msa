import assert from "node:assert";
import { describe, it } from "node:test";

import {
  decodeKittyPrintable,
  decodePrintableKey,
  matchesKey,
  parseKey,
  setKittyProtocolActive,
} from "../src/keys.ts";

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    legacyKeyMatchingCases1();
  });
});

function legacyKeyMatchingCases1(): void {
  it("should parse legacy alt-prefixed sequences when kitty inactive", () => {
    setKittyProtocolActive(false);
    assert.strictEqual(matchesKey("\x1b ", "alt+space"), true);
    assert.strictEqual(parseKey("\x1b "), "alt+space");
    assert.strictEqual(matchesKey("\x1b\b", "alt+backspace"), true);
    assert.strictEqual(parseKey("\x1b\b"), "alt+backspace");
    assert.strictEqual(matchesKey("\x1b\x03", "ctrl+alt+c"), true);
    assert.strictEqual(parseKey("\x1b\x03"), "ctrl+alt+c");
    assert.strictEqual(matchesKey("\x1bB", "alt+left"), true);
    assert.strictEqual(parseKey("\x1bB"), "alt+left");
    assert.strictEqual(matchesKey("\x1bF", "alt+right"), true);
    assert.strictEqual(parseKey("\x1bF"), "alt+right");
    assert.strictEqual(matchesKey("\x1ba", "alt+a"), true);
    assert.strictEqual(parseKey("\x1ba"), "alt+a");
    assert.strictEqual(matchesKey("\x1b1", "alt+1"), true);
    assert.strictEqual(parseKey("\x1b1"), "alt+1");
    assert.strictEqual(matchesKey("\x1b,", "alt+,"), true);
    assert.strictEqual(parseKey("\x1b,"), "alt+,");
    assert.strictEqual(matchesKey("\x1b.", "alt+."), true);
    assert.strictEqual(parseKey("\x1b."), "alt+.");
    assert.strictEqual(matchesKey("\x1by", "alt+y"), true);
    assert.strictEqual(parseKey("\x1by"), "alt+y");
    assert.strictEqual(matchesKey("\x1bz", "alt+z"), true);
    assert.strictEqual(parseKey("\x1bz"), "alt+z");

    setKittyProtocolActive(true);
    assert.strictEqual(matchesKey("\x1b ", "alt+space"), false);
    assert.strictEqual(parseKey("\x1b "), undefined);
    assert.strictEqual(matchesKey("\x1b\b", "alt+backspace"), true);
    assert.strictEqual(parseKey("\x1b\b"), "alt+backspace");
    assert.strictEqual(matchesKey("\x1b\x03", "ctrl+alt+c"), false);
    assert.strictEqual(parseKey("\x1b\x03"), undefined);
    assert.strictEqual(matchesKey("\x1bB", "alt+left"), false);
    assert.strictEqual(parseKey("\x1bB"), undefined);
    assert.strictEqual(matchesKey("\x1bF", "alt+right"), false);
    assert.strictEqual(parseKey("\x1bF"), undefined);
    assert.strictEqual(matchesKey("\x1ba", "alt+a"), false);
    assert.strictEqual(parseKey("\x1ba"), undefined);
    assert.strictEqual(matchesKey("\x1b1", "alt+1"), false);
    assert.strictEqual(parseKey("\x1b1"), undefined);
    assert.strictEqual(matchesKey("\x1b,", "alt+,"), false);
    assert.strictEqual(parseKey("\x1b,"), undefined);
    assert.strictEqual(matchesKey("\x1b.", "alt+."), false);
    assert.strictEqual(parseKey("\x1b."), undefined);
    assert.strictEqual(matchesKey("\x1by", "alt+y"), false);
    assert.strictEqual(parseKey("\x1by"), undefined);
    setKittyProtocolActive(false);
  });
}

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    it("should match arrow keys", () => {
      assert.strictEqual(matchesKey("\x1b[A", "up"), true);
      assert.strictEqual(matchesKey("\x1b[B", "down"), true);
      assert.strictEqual(matchesKey("\x1b[C", "right"), true);
      assert.strictEqual(matchesKey("\x1b[D", "left"), true);
    });

    it("should match SS3 arrows and home/end", () => {
      assert.strictEqual(matchesKey("\x1bOA", "up"), true);
      assert.strictEqual(matchesKey("\x1bOB", "down"), true);
      assert.strictEqual(matchesKey("\x1bOC", "right"), true);
      assert.strictEqual(matchesKey("\x1bOD", "left"), true);
      assert.strictEqual(matchesKey("\x1bOH", "home"), true);
      assert.strictEqual(matchesKey("\x1bOF", "end"), true);
    });

    it("should match xterm Ctrl-modified viewport navigation", () => {
      assert.strictEqual(matchesKey("\x1b[1;5H", "ctrl+home"), true);
      assert.strictEqual(matchesKey("\x1b[1;5F", "ctrl+end"), true);
      assert.strictEqual(matchesKey("\x1b[5;5~", "ctrl+pageUp"), true);
      assert.strictEqual(matchesKey("\x1b[6;5~", "ctrl+pageDown"), true);
      assert.strictEqual(parseKey("\x1b[1;5H"), "ctrl+home");
      assert.strictEqual(parseKey("\x1b[1;5F"), "ctrl+end");
      assert.strictEqual(parseKey("\x1b[5;5~"), "ctrl+pageUp");
      assert.strictEqual(parseKey("\x1b[6;5~"), "ctrl+pageDown");
    });

    it("should match legacy function keys and clear", () => {
      assert.strictEqual(matchesKey("\x1bOP", "f1"), true);
      assert.strictEqual(matchesKey("\x1b[24~", "f12"), true);
      assert.strictEqual(matchesKey("\x1b[E", "clear"), true);
    });

    it("should match alt+arrows", () => {
      assert.strictEqual(matchesKey("\x1bp", "alt+up"), true);
      assert.strictEqual(matchesKey("\x1bp", "up"), false);
    });
  });
});

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    it("should match rxvt modifier sequences", () => {
      assert.strictEqual(matchesKey("\x1b[a", "shift+up"), true);
      assert.strictEqual(matchesKey("\x1bOa", "ctrl+up"), true);
      assert.strictEqual(matchesKey("\x1b[2$", "shift+insert"), true);
      assert.strictEqual(matchesKey("\x1b[2^", "ctrl+insert"), true);
      assert.strictEqual(matchesKey("\x1b[7$", "shift+home"), true);
    });
  });
});

describe("decodeKittyPrintable", () => {
  it("should decode Kitty keypad functional keys to printable characters", () => {
    assert.strictEqual(decodeKittyPrintable("\x1b[57399u"), "0");
    assert.strictEqual(decodeKittyPrintable("\x1b[57400u"), "1");
    assert.strictEqual(decodeKittyPrintable("\x1b[57409u"), ".");
    assert.strictEqual(decodeKittyPrintable("\x1b[57410u"), "/");
    assert.strictEqual(decodeKittyPrintable("\x1b[57411u"), "*");
    assert.strictEqual(decodeKittyPrintable("\x1b[57412u"), "-");
    assert.strictEqual(decodeKittyPrintable("\x1b[57413u"), "+");
    assert.strictEqual(decodeKittyPrintable("\x1b[57415u"), "=");
    assert.strictEqual(decodeKittyPrintable("\x1b[57416u"), ",");
    assert.strictEqual(decodeKittyPrintable("\x1b[57417u"), undefined);
  });
});

describe("decodePrintableKey", () => {
  it("should decode printable xterm modifyOtherKeys sequences", () => {
    assert.strictEqual(decodePrintableKey("\x1b[27;2;69~"), "E");
    assert.strictEqual(decodePrintableKey("\x1b[27;2;196~"), "Ä");
    assert.strictEqual(decodePrintableKey("\x1b[27;2;32~"), " ");
    assert.strictEqual(decodePrintableKey("\x1b[27;2;13~"), undefined);
    assert.strictEqual(decodePrintableKey("\x1b[27;6;69~"), undefined);
  });
});

describe("parseKey", () => {
  describe("Kitty protocol with alternate keys", () => {
    it("should return Latin key name when base layout key is present", () => {
      setKittyProtocolActive(true);
      // Cyrillic ctrl+с with base layout 'c'
      const cyrillicCtrlC = "\x1b[1089::99;5u";
      assert.strictEqual(parseKey(cyrillicCtrlC), "ctrl+c");
      setKittyProtocolActive(false);
    });

    it("should prefer codepoint for Latin letters when base layout differs", () => {
      setKittyProtocolActive(true);
      // Dvorak Ctrl+K reports codepoint 'k' (107) and base layout 'v' (118)
      const dvorakCtrlK = "\x1b[107::118;5u";
      assert.strictEqual(parseKey(dvorakCtrlK), "ctrl+k");
      setKittyProtocolActive(false);
    });

    it("should prefer codepoint for symbol keys when base layout differs", () => {
      setKittyProtocolActive(true);
      // Dvorak Ctrl+/ reports codepoint '/' (47) and base layout '[' (91)
      const dvorakCtrlSlash = "\x1b[47::91;5u";
      assert.strictEqual(parseKey(dvorakCtrlSlash), "ctrl+/");
      setKittyProtocolActive(false);
    });

    it("should return key name from codepoint when no base layout", () => {
      setKittyProtocolActive(true);
      const latinCtrlC = "\x1b[99;5u";
      assert.strictEqual(parseKey(latinCtrlC), "ctrl+c");
      setKittyProtocolActive(false);
    });

    it("should parse shifted uppercase CSI-u letters as shift+letter", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(matchesKey("\x1b[69;2u", "shift+e"), true);
      assert.strictEqual(parseKey("\x1b[69;2u"), "shift+e");
      setKittyProtocolActive(false);
    });
  });
});

describe("parseKey", () => {
  describe("Kitty protocol with alternate keys", () => {
    it("should ignore Kitty CSI-u with unsupported modifiers", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(parseKey("\x1b[99;17u"), undefined);
      setKittyProtocolActive(false);
    });
  });
});

describe("parseKey", () => {
  describe("Legacy key parsing", () => {
    it("should parse legacy Ctrl+letter", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(parseKey("\x03"), "ctrl+c");
      assert.strictEqual(parseKey("\x04"), "ctrl+d");
    });

    it("should parse special keys", () => {
      assert.strictEqual(parseKey("\x1b"), "escape");
      assert.strictEqual(parseKey("\t"), "tab");
      assert.strictEqual(parseKey("\r"), "enter");
      assert.strictEqual(parseKey("\n"), "enter");
      assert.strictEqual(parseKey("\x00"), "ctrl+space");
      assert.strictEqual(parseKey(" "), "space");
      assert.strictEqual(parseKey("1"), "1");
      assert.strictEqual(matchesKey("1", "1"), true);
      assert.strictEqual(parseKey("+"), "+");
      assert.strictEqual(matchesKey("+", "+"), true);
    });

    it("should parse arrow keys", () => {
      assert.strictEqual(parseKey("\x1b[A"), "up");
      assert.strictEqual(parseKey("\x1b[B"), "down");
      assert.strictEqual(parseKey("\x1b[C"), "right");
      assert.strictEqual(parseKey("\x1b[D"), "left");
    });

    it("should parse SS3 arrows and home/end", () => {
      assert.strictEqual(parseKey("\x1bOA"), "up");
      assert.strictEqual(parseKey("\x1bOB"), "down");
      assert.strictEqual(parseKey("\x1bOC"), "right");
      assert.strictEqual(parseKey("\x1bOD"), "left");
      assert.strictEqual(parseKey("\x1bOH"), "home");
      assert.strictEqual(parseKey("\x1bOF"), "end");
    });
  });
});

describe("parseKey", () => {
  describe("Legacy key parsing", () => {
    it("should parse legacy function and modifier sequences", () => {
      assert.strictEqual(parseKey("\x1bOP"), "f1");
      assert.strictEqual(parseKey("\x1b[24~"), "f12");
      assert.strictEqual(parseKey("\x1b[E"), "clear");
      assert.strictEqual(parseKey("\x1b[2^"), "ctrl+insert");
      assert.strictEqual(parseKey("\x1bp"), "alt+up");
    });

    it("should parse double bracket pageUp", () => {
      assert.strictEqual(parseKey("\x1b[[5~"), "pageUp");
    });
  });
});
