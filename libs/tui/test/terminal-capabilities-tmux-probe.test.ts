import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import terminalCapabilities from "../src/terminal-capabilities.ts";
import TuiAltScreen from "../src/tui-alt-screen.ts";
import terminalImageHelpers from "./terminal-image-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const {
  getCapabilities,
  resetCapabilitiesCache,
  setCapabilities,
  setInlineImagesSuspended,
  setTmuxHyperlinkProbe,
} = terminalCapabilities;
const { withEnv } = terminalImageHelpers;

const TMUX_ENV = {
  MSA_HYPERLINKS: undefined,
  TERM: "tmux-256color",
  TMUX: "/tmp/tmux/default,1,0",
};

function startFromUnforwardedProbe(): void {
  setTmuxHyperlinkProbe(false);
  resetCapabilitiesCache();
}

function clearCapabilityState(): void {
  setInlineImagesSuspended(false);
  resetCapabilitiesCache();
}

describe("tmux hyperlink probe result", () => {
  beforeEach(startFromUnforwardedProbe);
  afterEach(clearCapabilityState);

  it("re-detects capabilities that came from the environment", () => {
    withEnv(TMUX_ENV, () => {
      assert.strictEqual(getCapabilities().hyperlinks, false);

      setTmuxHyperlinkProbe(true);

      assert.strictEqual(getCapabilities().hyperlinks, true);
    });
  });

  it("keeps capabilities set explicitly", () => {
    withEnv(TMUX_ENV, () => {
      setCapabilities({ hyperlinks: false, images: "kitty", trueColor: true });

      setTmuxHyperlinkProbe(true);

      assert.deepStrictEqual(getCapabilities(), {
        hyperlinks: false,
        images: "kitty",
        trueColor: true,
      });
    });
  });

  it("keeps a result that arrives after the alt screen suspended inline images", () => {
    withEnv({ ...TMUX_ENV, MSA_IMAGE_PROTOCOL: "iterm2" }, () => {
      const tui = new TuiAltScreen(new RecordingTerminal(20, 3));
      try {
        tui.start();
        assert.strictEqual(getCapabilities().images, null);

        setTmuxHyperlinkProbe(true);

        assert.strictEqual(getCapabilities().hyperlinks, true);
        assert.strictEqual(getCapabilities().images, null);
      } finally {
        tui.stop();
      }
      assert.strictEqual(getCapabilities().hyperlinks, true);
      assert.strictEqual(getCapabilities().images, "iterm2");
    });
  });
});
