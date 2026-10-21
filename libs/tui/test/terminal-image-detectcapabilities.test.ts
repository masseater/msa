import assert from "node:assert";
import { describe, it } from "node:test";

import terminalCapabilities from "../src/terminal-capabilities.ts";
import terminalImage from "../src/terminal-image.ts";
import terminalImageHelpers from "./terminal-image-helpers.ts";

const { detectCapabilities } = terminalCapabilities;
const { encodeITerm2 } = terminalImage;

const { withEnv } = terminalImageHelpers;

describe("detectCapabilities", () => {
  it("enables hyperlinks under tmux when the client forwards them", () => {
    withEnv({ TERM_PROGRAM: "ghostty", TMUX: "/tmp/tmux-1000/default,1234,0" }, () => {
      const caps = detectCapabilities(() => true);
      assert.strictEqual(caps.hyperlinks, true);
      assert.strictEqual(caps.images, null);
    });
  });

  it("disables hyperlinks under tmux when the client does not forward them", () => {
    withEnv({ TERM_PROGRAM: "ghostty", TMUX: "/tmp/tmux-1000/default,1234,0" }, () => {
      const caps = detectCapabilities(() => false);
      assert.strictEqual(caps.hyperlinks, false);
      assert.strictEqual(caps.images, null);
    });
  });

  it("checks tmux capability when TERM starts with 'tmux'", () => {
    withEnv({ TERM: "tmux-256color", TERM_PROGRAM: "iterm.app" }, () => {
      const caps = detectCapabilities(() => true);
      assert.strictEqual(caps.hyperlinks, true);
      assert.strictEqual(caps.images, null);

      const caps2 = detectCapabilities(() => false);
      assert.strictEqual(caps2.hyperlinks, false);
    });
  });

  it("forces hyperlinks: false when TERM starts with 'screen'", () => {
    withEnv({ TERM: "screen-256color" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.hyperlinks, false);
      assert.strictEqual(caps.images, null);
    });
  });
});

describe("detectCapabilities", () => {
  it("enables hyperlinks and Kitty images for Herdr", () => {
    withEnv(
      {
        COLORTERM: "truecolor",
        KITTY_WINDOW_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: "herdr",
      },
      () => {
        const caps = detectCapabilities();
        assert.strictEqual(caps.hyperlinks, true);
        assert.strictEqual(caps.images, "kitty");
        assert.strictEqual(caps.trueColor, true);
      },
    );
    withEnv({ MSA_HYPERLINKS: "0", TERM_PROGRAM: "herdr" }, () => {
      assert.strictEqual(detectCapabilities().hyperlinks, false);
    });
  });

  it("enables hyperlinks for Ghostty", () => {
    withEnv({ TERM_PROGRAM: "ghostty" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("does not disable Ghostty images solely because cmux is present", () => {
    withEnv({ CMUX_WORKSPACE_ID: "workspace", TERM_PROGRAM: "ghostty" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.images, "kitty");
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("enables hyperlinks for Kitty", () => {
    withEnv({ KITTY_WINDOW_ID: "1" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.hyperlinks, true);
    });
  });
});

describe("detectCapabilities", () => {
  it("enables hyperlinks for WezTerm", () => {
    withEnv({ WEZTERM_PANE: "0" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("enables images and hyperlinks for Warp via TERM_PROGRAM", () => {
    withEnv({ TERM_PROGRAM: "WarpTerminal" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.images, "kitty");
      assert.strictEqual(caps.trueColor, true);
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("enables images and hyperlinks for Warp via WARP_SESSION_ID", () => {
    withEnv({ WARP_SESSION_ID: "some-session-id" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.images, "kitty");
      assert.strictEqual(caps.trueColor, true);
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("enables images and hyperlinks for Warp via WARP_TERMINAL_SESSION_UUID", () => {
    withEnv({ WARP_TERMINAL_SESSION_UUID: "d0e1a2e5-7ca7-44cd-9037-ac7222011161" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.images, "kitty");
      assert.strictEqual(caps.trueColor, true);
      assert.strictEqual(caps.hyperlinks, true);
    });
  });
});

describe("detectCapabilities", () => {
  it("disables images for Warp inside tmux", () => {
    withEnv(
      {
        TERM: "tmux-256color",
        TERM_PROGRAM: "WarpTerminal",
        TMUX: "/tmp/tmux-1000/default,1234,0",
      },
      () => {
        const caps = detectCapabilities(() => true);
        assert.strictEqual(caps.images, null);
        assert.strictEqual(caps.hyperlinks, true);
      },
    );
  });

  it("enables hyperlinks for iTerm2", () => {
    withEnv({ TERM_PROGRAM: "iterm.app" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("enables hyperlinks for VSCode", () => {
    withEnv({ TERM_PROGRAM: "vscode" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.hyperlinks, true);
    });
  });

  it("enables Alacritty capabilities for Zed", () => {
    withEnv({ TERM_PROGRAM: "zed" }, () => {
      assert.deepStrictEqual(detectCapabilities(), {
        hyperlinks: true,
        images: null,
        trueColor: true,
      });
    });
  });
});

describe("detectCapabilities", () => {
  it("enables truecolor and hyperlinks for Windows Terminal outside multiplexers", () => {
    withEnv({ TERM: "xterm-256color", WT_SESSION: "session" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.trueColor, true);
      assert.strictEqual(caps.hyperlinks, true);
      assert.strictEqual(caps.images, null);
    });
  });

  it("enables truecolor without hyperlinks for JetBrains terminal", () => {
    withEnv({ TERM: "xterm-256color", TERMINAL_EMULATOR: "JetBrains-JediTerm" }, () => {
      const caps = detectCapabilities();
      assert.strictEqual(caps.trueColor, true);
      assert.strictEqual(caps.hyperlinks, false);
      assert.strictEqual(caps.images, null);
    });
  });

  it("does not inherit Windows Terminal truecolor through tmux", () => {
    withEnv(
      { TERM: "tmux-256color", TMUX: "/tmp/tmux-1000/default,1234,0", WT_SESSION: "session" },
      () => {
        const caps = detectCapabilities(() => false);
        assert.strictEqual(caps.trueColor, false);
        assert.strictEqual(caps.hyperlinks, false);
        assert.strictEqual(caps.images, null);
      },
    );
  });

  it("trusts explicit truecolor hints through tmux", () => {
    withEnv(
      { COLORTERM: "truecolor", TERM: "tmux-256color", TMUX: "/tmp/tmux-1000/default,1234,0" },
      () => {
        const caps = detectCapabilities(() => false);
        assert.strictEqual(caps.trueColor, true);
        assert.strictEqual(caps.hyperlinks, false);
        assert.strictEqual(caps.images, null);
      },
    );
  });
});

describe("detectCapabilities", () => {
  it("detects truecolor from direct-color TERM values", () => {
    withEnv({ TERM: "xterm-direct" }, () => {
      assert.strictEqual(detectCapabilities(() => false).trueColor, true);
    });
  });
});

describe("iTerm2 image encoding", () => {
  it("includes the decoded payload size in OSC 1337 metadata", () => {
    const sequence = encodeITerm2("AAAA", { height: "auto", width: 2 });
    assert.strictEqual(sequence, "\x1b]1337;File=inline=1;size=3;width=2;height=auto:AAAA\x07");
  });
});
