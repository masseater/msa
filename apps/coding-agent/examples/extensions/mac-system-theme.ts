import { NodeServices } from "@effect/platform-node";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, type Fiber, ManagedRuntime, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const runtime = ManagedRuntime.make(NodeServices.layer);

const readDarkMode = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("osascript", [
          "-e",
          'tell application "System Events" to tell appearance preferences to return dark mode',
        ]),
      );
      const output = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString);
      yield* handle.exitCode;
      return output.trim() === "true";
    }),
  );
});

const isDarkMode = (): Promise<boolean> =>
  runtime.runPromise(readDarkMode.pipe(Effect.orElseSucceed(() => false)));

export default function (msa: codingAgentTypes.ExtensionAPI) {
  let fiber: Fiber.Fiber<void> | undefined;

  msa.on("session_start", (_event, ctx) => {
    const watchTheme = (currentTheme: string): Effect.Effect<void> =>
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep(2000);
          const newTheme = (yield* Effect.promise(isDarkMode)) ? "dark" : "light";
          if (newTheme !== currentTheme) {
            ctx.ui.setTheme(newTheme);
          }
        }),
      );

    const start = (): void => {
      fiber = Effect.runFork(
        Effect.gen(function* () {
          const currentTheme = (yield* Effect.promise(isDarkMode)) ? "dark" : "light";
          ctx.ui.setTheme(currentTheme);
          return yield* watchTheme(currentTheme);
        }),
      );
    };
    start();
  });

  msa.on("session_shutdown", () => {
    fiber?.interruptUnsafe();
    fiber = undefined;
  });
}
