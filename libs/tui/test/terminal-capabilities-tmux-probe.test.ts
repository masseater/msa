import assert from "node:assert";
import { describe, it } from "node:test";

import terminalCapabilities from "../src/terminal-capabilities.ts";
import terminalImageHelpers from "./terminal-image-helpers.ts";

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
});
