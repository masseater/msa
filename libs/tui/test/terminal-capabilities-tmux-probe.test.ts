import assert from "node:assert";
import { describe, it } from "node:test";

import terminalCapabilities from "../src/terminal-capabilities.ts";
import TuiAltScreen from "../src/tui-alt-screen.ts";
import terminalImageHelpers from "./terminal-image-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const { getCapabilities, resetCapabilitiesCache, setCapabilities, setTmuxHyperlinkProbe } =
  terminalCapabilities;
const { withEnv } = terminalImageHelpers;

const TMUX_ENV = {
  MSA_HYPERLINKS: undefined,
  TERM: "tmux-256color",
  TMUX: "/tmp/tmux/default,1,0",
};

describe("tmux hyperlink probe result", () => {
  it("re-detects capabilities that came from the environment", () => {
    withEnv(TMUX_ENV, () => {
      resetCapabilitiesCache();
      assert.strictEqual(getCapabilities().hyperlinks, false);

      setTmuxHyperlinkProbe(true);

      assert.strictEqual(getCapabilities().hyperlinks, true);
      resetCapabilitiesCache();
    });
  });

  it("keeps capabilities set explicitly", () => {
    withEnv(TMUX_ENV, () => {
      setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });

      setTmuxHyperlinkProbe(false);

      assert.deepStrictEqual(getCapabilities(), {
        hyperlinks: true,
        images: "kitty",
        trueColor: true,
      });
      resetCapabilitiesCache();
    });
  });

  it("keeps a result that arrives after the alt screen suspended inline images", () => {
    withEnv({ ...TMUX_ENV, MSA_IMAGE_PROTOCOL: "iterm2" }, () => {
      setTmuxHyperlinkProbe(false);
      resetCapabilitiesCache();
      const tui = new TuiAltScreen(new RecordingTerminal(20, 3));
      tui.start();
      assert.strictEqual(getCapabilities().images, null);

      setTmuxHyperlinkProbe(true);

      assert.strictEqual(getCapabilities().hyperlinks, true);
      assert.strictEqual(getCapabilities().images, null);
      tui.stop();
      assert.strictEqual(getCapabilities().hyperlinks, true);
      assert.strictEqual(getCapabilities().images, "iterm2");
      resetCapabilitiesCache();
    });
  });
});
