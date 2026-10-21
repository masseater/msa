import { Duration, Effect } from "effect";

import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";
import terminalCapabilities from "./terminal-capabilities.ts";
import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";

const { Platform, platformRuntime } = platformModule;
const { getCapabilities, needsTmuxHyperlinkProbe, setTmuxHyperlinkProbe } = terminalCapabilities;

const TMUX_PROBE_TIMEOUT = Duration.millis(250);

const probeTmuxHyperlinks: Effect.Effect<boolean, never, platformTypes.Platform> = Effect.gen(
  function* () {
    const platform = yield* Platform;
    const { exitCode, stdout } = yield* platform.runCommand({
      args: ["display-message", "-p", "#{client_termfeatures}"],
      file: "tmux",
    });
    return (
      exitCode === 0 &&
      stdout
        .split(",")
        .map((feature) => feature.trim())
        .includes("hyperlinks")
    );
  },
).pipe(
  Effect.timeout(TMUX_PROBE_TIMEOUT),
  Effect.orElseSucceed(() => false),
);

const primeTerminalCapabilities: Effect.Effect<terminalCapabilitiesTypes.TerminalCapabilities> =
  Effect.suspend(() => {
    if (!needsTmuxHyperlinkProbe()) return Effect.sync(getCapabilities);
    return Effect.promise(() => platformRuntime.runPromise(probeTmuxHyperlinks)).pipe(
      Effect.map((forwardsHyperlinks) => {
        setTmuxHyperlinkProbe(forwardsHyperlinks);
        return getCapabilities();
      }),
    );
  });

const terminalCapabilitiesProbe = {
  primeTerminalCapabilities,
};

export default terminalCapabilitiesProbe;
