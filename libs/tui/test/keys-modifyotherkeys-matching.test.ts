import assert from "node:assert";
import { describe, it } from "node:test";

import keys from "../src/keys.ts";
import keysHelpers from "./keys-helpers.ts";

const { matchesKey, parseKey, setKittyProtocolActive } = keys;

const { withEnv, withEnvVars } = keysHelpers;

describe("matchesKey", () => {
  describe("modifyOtherKeys matching", () => {
    it("should match xterm modifyOtherKeys Backspace variants", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;1;127~", "backspace"), true);
      assert.strictEqual(matchesKey("\x1b[27;5;127~", "ctrl+backspace"), true);
      assert.strictEqual(matchesKey("\x1b[27;3;127~", "alt+backspace"), true);
      assert.strictEqual(parseKey("\x1b[27;1;127~"), "backspace");
      assert.strictEqual(parseKey("\x1b[27;5;127~"), "ctrl+backspace");
      assert.strictEqual(parseKey("\x1b[27;3;127~"), "alt+backspace");
    });

    it("should match xterm modifyOtherKeys Escape", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;1;27~", "escape"), true);
      assert.strictEqual(parseKey("\x1b[27;1;27~"), "escape");
    });

    it("should match xterm modifyOtherKeys Space variants", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;1;32~", "space"), true);
      assert.strictEqual(matchesKey("\x1b[27;5;32~", "ctrl+space"), true);
      assert.strictEqual(parseKey("\x1b[27;1;32~"), "space");
      assert.strictEqual(parseKey("\x1b[27;5;32~"), "ctrl+space");
    });

    it("should match xterm modifyOtherKeys symbol combos", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;5;47~", "ctrl+/"), true);
      assert.strictEqual(parseKey("\x1b[27;5;47~"), "ctrl+/");
      assert.strictEqual(matchesKey("\x1b[27;6;43~", "ctrl++"), true);
      assert.strictEqual(parseKey("\x1b[27;6;43~"), "ctrl++");
    });

    it("should match xterm modifyOtherKeys digit combos", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;5;49~", "ctrl+1"), true);
      assert.strictEqual(matchesKey("\x1b[27;2;49~", "shift+1"), true);
      assert.strictEqual(parseKey("\x1b[27;5;49~"), "ctrl+1");
      assert.strictEqual(parseKey("\x1b[27;2;49~"), "shift+1");
    });
  });
});

describe("matchesKey", () => {
  describe("modifyOtherKeys matching", () => {
    it("should match xterm modifyOtherKeys shifted uppercase letters", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;2;69~", "shift+e"), true);
      assert.strictEqual(matchesKey("\x1b[27;6;69~", "ctrl+shift+e"), true);
      assert.strictEqual(parseKey("\x1b[27;2;69~"), "shift+e");
      assert.strictEqual(parseKey("\x1b[27;6;69~"), "shift+ctrl+e");
    });

    it("should match Ctrl+Alt+letter via CSI-u when kitty inactive", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[104;7u", "ctrl+alt+h"), true);
      assert.strictEqual(parseKey("\x1b[104;7u"), "ctrl+alt+h");
    });

    it("should match Ctrl+Alt+letter via xterm modifyOtherKeys", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b[27;7;104~", "ctrl+alt+h"), true);
      assert.strictEqual(parseKey("\x1b[27;7;104~"), "ctrl+alt+h");
    });
  });
});

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    it("should match legacy Ctrl+c", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x03", "ctrl+c"), true);
    });

    it("should match legacy Ctrl+d", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x04", "ctrl+d"), true);
    });

    it("should match escape key", () => {
      assert.strictEqual(matchesKey("\x1b", "escape"), true);
    });

    it("should match legacy linefeed as enter", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\n", "enter"), true);
      assert.strictEqual(parseKey("\n"), "enter");
    });

    it("should treat linefeed as shift+enter when kitty active", () => {
      setKittyProtocolActive(true);
      assert.strictEqual(matchesKey("\n", "shift+enter"), true);
      assert.strictEqual(matchesKey("\n", "enter"), false);
      assert.strictEqual(parseKey("\n"), "shift+enter");
      setKittyProtocolActive(false);
    });

    it("should parse ctrl+space", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x00", "ctrl+space"), true);
      assert.strictEqual(parseKey("\x00"), "ctrl+space");
    });
  });
});

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    it("should match legacy Ctrl+symbol", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1c", "ctrl+\\"), true);
      assert.strictEqual(parseKey("\x1c"), "ctrl+\\");
      assert.strictEqual(matchesKey("\x1d", "ctrl+]"), true);
      assert.strictEqual(parseKey("\x1d"), "ctrl+]");
      assert.strictEqual(matchesKey("\x1f", "ctrl+_"), true);
      assert.strictEqual(matchesKey("\x1f", "ctrl+-"), true);
      assert.strictEqual(parseKey("\x1f"), "ctrl+-");
    });

    it("should match legacy Ctrl+Alt+symbol", () => {
      setKittyProtocolActive(false);
      assert.strictEqual(matchesKey("\x1b\x1b", "ctrl+alt+["), true);
      assert.strictEqual(parseKey("\x1b\x1b"), "ctrl+alt+[");
      assert.strictEqual(matchesKey("\x1b\x1c", "ctrl+alt+\\"), true);
      assert.strictEqual(parseKey("\x1b\x1c"), "ctrl+alt+\\");
      assert.strictEqual(matchesKey("\x1b\x1d", "ctrl+alt+]"), true);
      assert.strictEqual(parseKey("\x1b\x1d"), "ctrl+alt+]");
      assert.strictEqual(matchesKey("\x1b\x1f", "ctrl+alt+_"), true);
      assert.strictEqual(matchesKey("\x1b\x1f", "ctrl+alt+-"), true);
      assert.strictEqual(parseKey("\x1b\x1f"), "ctrl+alt+-");
    });
  });
});

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    it("should treat raw 0x08 as plain backspace outside Windows Terminal", () => {
      setKittyProtocolActive(false);
      withEnv("WT_SESSION", undefined, () => {
        assert.strictEqual(matchesKey("\x7f", "backspace"), true);
        assert.strictEqual(matchesKey("\x7f", "ctrl+backspace"), false);
        assert.strictEqual(parseKey("\x7f"), "backspace");
        assert.strictEqual(matchesKey("\x08", "backspace"), true);
        assert.strictEqual(matchesKey("\x08", "ctrl+backspace"), false);
        assert.strictEqual(parseKey("\x08"), "backspace");
        assert.strictEqual(matchesKey("\x08", "ctrl+h"), true);
      });
    });

    it("should treat raw 0x08 as ctrl+backspace in local Windows Terminal", () => {
      setKittyProtocolActive(false);
      withEnvVars(
        {
          SSH_CLIENT: undefined,
          SSH_CONNECTION: undefined,
          SSH_TTY: undefined,
          WT_SESSION: "test-session",
        },
        () => {
          assert.strictEqual(matchesKey("\x08", "ctrl+backspace"), true);
          assert.strictEqual(matchesKey("\x08", "backspace"), false);
          assert.strictEqual(parseKey("\x08"), "ctrl+backspace");
          assert.strictEqual(matchesKey("\x08", "ctrl+h"), true);
        },
      );
    });
  });
});

describe("matchesKey", () => {
  describe("Legacy key matching", () => {
    it("should treat raw 0x08 as plain backspace in Windows Terminal over SSH", () => {
      setKittyProtocolActive(false);
      withEnvVars(
        {
          SSH_CLIENT: "1 2 3",
          SSH_CONNECTION: "1 2 3 4",
          SSH_TTY: "/dev/pts/1",
          WT_SESSION: "test-session",
        },
        () => {
          assert.strictEqual(matchesKey("\x08", "ctrl+backspace"), false);
          assert.strictEqual(matchesKey("\x08", "backspace"), true);
          assert.strictEqual(parseKey("\x08"), "backspace");
          assert.strictEqual(matchesKey("\x08", "ctrl+h"), true);
        },
      );
    });
  });
});
