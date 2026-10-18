import { Duration, Effect } from "effect";

import { Platform, platformRuntime } from "./platform.ts";
import {
  getCapabilities,
  needsTmuxHyperlinkProbe,
  setTmuxHyperlinkProbe,
  type TerminalCapabilities,
} from "./terminal-capabilities.ts";

const TMUX_PROBE_TIMEOUT = Duration.millis(250);

const probeTmuxHyperlinks: Effect.Effect<boolean, never, Platform> = Effect.gen(function* () {
  const platform = yield* Platform;
  const { exitCode, stdout } = yield* platform.runCommand({
    file: "tmux",
    args: ["display-message", "-p", "#{client_termfeatures}"],
  });
  return (
    exitCode === 0 &&
    stdout
      .split(",")
      .map((feature) => feature.trim())
      .includes("hyperlinks")
  );
}).pipe(
  Effect.timeout(TMUX_PROBE_TIMEOUT),
  Effect.orElseSucceed(() => false),
);

export const primeTerminalCapabilities: Effect.Effect<TerminalCapabilities> = Effect.suspend(() => {
  if (!needsTmuxHyperlinkProbe()) return Effect.sync(getCapabilities);
  return Effect.promise(() => platformRuntime.runPromise(probeTmuxHyperlinks)).pipe(
    Effect.map((forwardsHyperlinks) => {
      setTmuxHyperlinkProbe(forwardsHyperlinks);
      return getCapabilities();
    }),
  );
});
