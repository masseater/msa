import { Effect, Function as Fn } from "effect";

import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import awaitingModule from "../core/awaiting.ts";
import outputGuard from "../core/output-guard.ts";
import platformModule from "../core/platform.ts";
import errors from "../utils/errors.ts";
import shell from "../utils/shell.ts";
import printModeOutput from "./print-mode-output.ts";
import type printModeTypes from "./print-mode.types.ts";
import PrintSessionBinding from "./print-session-binding.ts";

const { awaited, awaiting, performed } = awaitingModule;

type Runtime = agentSessionRuntimeTypes.AgentSessionRuntime;
type Options = printModeTypes.PrintModeOptions;

function registerSignalHandlers(binding: PrintSessionBinding): () => void {
  const signals: NodeJS.Signals[] =
    process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
  const cleanups = signals.map((signal) => {
    const handler = () => {
      shell.killTrackedDetachedChildren();
      void binding.dispose().finally(() => {
        process.exit(signal === "SIGHUP" ? 129 : 143);
      });
    };
    process.on(signal, handler);
    return () => process.off(signal, handler);
  });
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function promptAll(binding: PrintSessionBinding, options: Options): Effect.Effect<number> {
  return awaiting(function* () {
    if (options.mode === "json") printModeOutput.writeSessionHeader(binding.session);
    yield* awaited(binding.rebind());
    const { initialMessage, initialImages, messages = [] } = options;
    if (initialMessage !== undefined && initialMessage !== "") {
      yield* awaited(
        binding.session.run.prompting.prompt(initialMessage, { images: initialImages }),
      );
    }
    for (const message of messages) {
      yield* awaited(binding.session.run.prompting.prompt(message));
    }
    if (options.mode === "text" && !printModeOutput.writeFinalAnswer(binding.session)) return 1;
    return 0;
  });
}

const runPrintMode: {
  (options: Options): (runtimeHost: Runtime) => Promise<number>;
  (runtimeHost: Runtime, options: Options): Promise<number>;
} = Fn.dual(2, (runtimeHost: Runtime, options: Options): Promise<number> =>
  Effect.runPromise(
    awaiting(function* () {
      const binding = new PrintSessionBinding(runtimeHost, options.mode);
      const removeSignalHandlers = registerSignalHandlers(binding);
      runtimeHost.setRebindSession(() => binding.rebind());
      try {
        return yield* performed(promptAll(binding, options));
      } catch (error: unknown) {
        platformModule.writeError(errors.toErrorMessage(error));
        return 1;
      } finally {
        removeSignalHandlers();
        yield* awaited(binding.dispose());
        yield* awaited(outputGuard.flushRawStdout());
      }
    }),
  ),
);

const printMode = {
  runPrintMode,
};

export default printMode;
