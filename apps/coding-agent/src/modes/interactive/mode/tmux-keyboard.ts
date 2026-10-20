import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime, Option, Stream } from "effect";
import { ChildProcess } from "effect/process";

import awaitingModule from "../../../core/awaiting.ts";
import processEnv from "../../../core/process-env.ts";

const { awaited, awaiting } = awaitingModule;
const { readEnv } = processEnv;
const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

function checkTmuxKeyboardSetup(): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      if (readEnv("TMUX") === undefined || readEnv("TMUX") === "") return undefined;

      const runTmuxShow = (option: string): Promise<string | undefined> =>
        nodeRuntime.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* ChildProcess.make("tmux", ["show", "-gv", option], {
                stderr: "ignore",
                stdin: "ignore",
              });
              const [stdout, code] = yield* Effect.all(
                [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
                { concurrency: 2 },
              );
              return code === 0 ? stdout.trim() : undefined;
            }),
          ).pipe(
            Effect.timeoutOption(2000),
            Effect.map((timed) => Option.getOrElse(timed, () => undefined)),
            Effect.orElseSucceed((): string | undefined => undefined),
          ),
        );

      const [extendedKeys, extendedKeysFormat] = yield* awaited(
        Promise.all([runTmuxShow("extended-keys"), runTmuxShow("extended-keys-format")]),
      );

      if (extendedKeys === undefined) return undefined;

      if (extendedKeys !== "on" && extendedKeys !== "always") {
        return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
      }

      if (extendedKeysFormat === "xterm") {
        return "tmux extended-keys-format is xterm. msa works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
      }

      return undefined;
    }),
  );
}

const tmuxKeyboard = { checkTmuxKeyboardSetup };

export default tmuxKeyboard;
