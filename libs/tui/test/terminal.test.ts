import assert from "node:assert";
import { describe, it, mock } from "node:test";

import {
  normalizeAppleTerminalInput,
  normalizeNativeShiftEnterInput,
  resolveEscapeTimeoutMs,
} from "../src/terminal.ts";
import { setupNegotiation, withOverride, working } from "./terminal-helpers.ts";

describe("resolveEscapeTimeoutMs", () => {
  it("uses MSA_TUI_ESC_TIMEOUT when configured", () => {
    assert.equal(resolveEscapeTimeoutMs({ MSA_TUI_ESC_TIMEOUT: "80" }), 80);
    assert.equal(resolveEscapeTimeoutMs({ MSA_TUI_ESC_TIMEOUT: "80", SSH_TTY: "/dev/pts/1" }), 80);
  });

  it("ignores invalid MSA_TUI_ESC_TIMEOUT values", () => {
    assert.equal(resolveEscapeTimeoutMs({ MSA_TUI_ESC_TIMEOUT: "abc" }), 10);
    assert.equal(resolveEscapeTimeoutMs({ MSA_TUI_ESC_TIMEOUT: "0" }), 10);
    assert.equal(resolveEscapeTimeoutMs({ MSA_TUI_ESC_TIMEOUT: "-5" }), 10);
    assert.equal(resolveEscapeTimeoutMs({ MSA_TUI_ESC_TIMEOUT: "" }), 10);
  });

  it("defaults to 100ms over SSH", () => {
    assert.equal(resolveEscapeTimeoutMs({ SSH_CONNECTION: "10.0.0.1 22" }), 100);
    assert.equal(resolveEscapeTimeoutMs({ SSH_TTY: "/dev/pts/1" }), 100);
  });

  it("defaults to 10ms otherwise", () => {
    assert.equal(resolveEscapeTimeoutMs({}), 10);
  });
});

describe("normalizeNativeShiftEnterInput", () => {
  it("rewrites Return to CSI-u Shift+Enter when native Shift detection is enabled and Shift is pressed", () => {
    assert.equal(normalizeNativeShiftEnterInput("\r", true, true), "\x1b[13;2u");
  });

  it("leaves Return unchanged when native Shift detection is disabled", () => {
    assert.equal(normalizeNativeShiftEnterInput("\r", false, true), "\r");
  });

  it("leaves Return unchanged when Shift is not pressed", () => {
    assert.equal(normalizeNativeShiftEnterInput("\r", true, false), "\r");
  });

  it("leaves non-Return input unchanged", () => {
    assert.equal(normalizeNativeShiftEnterInput("\x1b[13;2u", true, true), "\x1b[13;2u");
    assert.equal(normalizeNativeShiftEnterInput("a", true, true), "a");
  });
});

describe("normalizeAppleTerminalInput", () => {
  it("rewrites Apple Terminal Return to CSI-u Shift+Enter when Shift is pressed", () => {
    assert.equal(normalizeAppleTerminalInput("\r", true, true), "\x1b[13;2u");
  });

  it("leaves Apple Terminal Return unchanged when Shift is not pressed", () => {
    assert.equal(normalizeAppleTerminalInput("\r", true, false), "\r");
  });

  it("leaves non-Apple Terminal Return unchanged when Shift is pressed", () => {
    assert.equal(normalizeAppleTerminalInput("\r", false, true), "\r");
  });

  it("leaves non-Return input unchanged", () => {
    assert.equal(normalizeAppleTerminalInput("\x1b[13;2u", true, true), "\x1b[13;2u");
    assert.equal(normalizeAppleTerminalInput("a", true, true), "a");
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  it("queries Kitty mode before enabling modifyOtherKeys fallback", () => {
    const harness = setupNegotiation();
    try {
      assert.equal(harness.writes[0], "\x1b[>7u\x1b[?u\x1b]7501;?\x1b\\\x1b[c");
      assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
      assert.equal(harness.terminal.kittyProtocolActive, false);
    } finally {
      harness.cleanup();
    }
  });

  it("activates Kitty mode for non-zero negotiated flags", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?7u");

      assert.equal(harness.getInput(), undefined);
      assert.equal(harness.terminal.kittyProtocolActive, true);
      assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
      assert.equal(harness.writes.includes("\x1b[>4;0m"), false);

      harness.cleanup();
      assert.equal(harness.writes.filter((write) => write === "\x1b[<u").length, 1);
      assert.equal(harness.writes.includes("\x1b[>4;0m"), false);
    } finally {
      harness.cleanup();
    }
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  it("falls back to modifyOtherKeys for zero Kitty flags", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?0u");

      assert.equal(harness.getInput(), undefined);
      assert.equal(harness.terminal.kittyProtocolActive, false);
      assert.equal(harness.writes.filter((write) => write === "\x1b[>4;2m").length, 1);

      harness.cleanup();
      assert.equal(harness.writes.filter((write) => write === "\x1b[>4;0m").length, 1);
    } finally {
      harness.cleanup();
    }
  });

  it("falls back to modifyOtherKeys for device attributes without Kitty flags", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?62;4;52c");

      assert.equal(harness.getInput(), undefined);
      assert.equal(harness.terminal.kittyProtocolActive, false);
      assert.equal(harness.writes.filter((write) => write === "\x1b[>4;2m").length, 1);
    } finally {
      harness.cleanup();
    }
  });

  it("forwards device attributes replies that answer other queries", () => {
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?7u");
      harness.send("\x1b[?62;4;52c");
      assert.equal(harness.getInput(), undefined);

      harness.send("\x1b[?62;4;52c");
      assert.equal(harness.getInput(), "\x1b[?62;4;52c");
    } finally {
      harness.cleanup();
    }
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  it("forwards normal input while waiting for Kitty response", () => {
    const harness = setupNegotiation();
    try {
      harness.send("a");

      assert.equal(harness.getInput(), "a");
      assert.equal(harness.terminal.kittyProtocolActive, false);
    } finally {
      harness.cleanup();
    }
  });

  it("tracks split Kitty confirmation", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const harness = setupNegotiation();
    try {
      harness.send("\x1b[?7");
      mock.timers.tick(10);

      assert.equal(harness.getInput(), undefined);

      harness.send("u");

      assert.equal(harness.terminal.kittyProtocolActive, true);
      assert.equal(harness.writes.includes("\x1b[>4;2m"), false);
    } finally {
      harness.cleanup();
      mock.timers.reset();
    }
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  describe("program status (OSC 7501)", () => {
    it("reports the latest status once the terminal answers the query before DA", () => {
      withOverride(undefined, () => {
        const harness = setupNegotiation();
        try {
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });
          assert.equal(harness.writes.includes(working), false);

          harness.send("\x1b]7501;?\x1b\\");
          assert.equal(harness.getInput(), undefined);
          assert.equal(harness.writes.filter((write) => write === working).length, 1);
          harness.send("\x1b[?62;4;52c");

          harness.terminal.setProgramStatus({ state: "done" });
          assert.equal(harness.writes.at(-1), "\x1b]7501;state=done\x1b\\");
        } finally {
          harness.cleanup();
        }
      });
    });

    it("reports nothing when DA arrives first and swallows late replies", () => {
      withOverride(undefined, () => {
        const harness = setupNegotiation();
        try {
          harness.send("\x1b[?62;4;52c");
          harness.send("\x1b]7501;?\x07");
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });

          assert.equal(harness.getInput(), undefined);
          assert.equal(
            harness.writes.some((write) => write.startsWith("\x1b]7501;state=")),
            false,
          );
        } finally {
          harness.cleanup();
        }
      });
    });
  });
});

describe("ProcessTerminal Kitty keyboard protocol negotiation", () => {
  describe("program status (OSC 7501)", () => {
    it("skips the query when MSA_PROGRAM_STATUS is set", () => {
      withOverride("1", () => {
        const harness = setupNegotiation();
        try {
          assert.equal(harness.writes[0], "\x1b[>7u\x1b[?u\x1b[c");
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });
          assert.equal(harness.writes.at(-1), working);
        } finally {
          harness.cleanup();
        }
      });
      withOverride("0", () => {
        const harness = setupNegotiation();
        try {
          assert.equal(harness.writes[0], "\x1b[>7u\x1b[?u\x1b[c");
          harness.terminal.setProgramStatus({ state: "working", app: "msa" });
          assert.equal(harness.writes.includes(working), false);
        } finally {
          harness.cleanup();
        }
      });
    });
  });
});
