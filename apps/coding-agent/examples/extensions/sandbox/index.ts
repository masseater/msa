import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { NodeServices } from "@effect/platform-node";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, FileSystem, ManagedRuntime, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import configModule from "./config.ts";
import type configTypes from "./config.types.ts";

const { createBashTool } = codingAgent;
const { loadConfig } = configModule;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fsService = runtime.runSync(FileSystem.FileSystem);

class SandboxError extends Schema.TaggedError<SandboxError, { readonly brand: unique symbol }>()(
  "SandboxError",
  { message: Schema.String },
) {}

const abortEffect = (signal: AbortSignal): Effect.Effect<never, SandboxError> =>
  Effect.callback<never, SandboxError>((resume) => {
    if (signal.aborted) {
      resume(Effect.fail(SandboxError.make({ message: "aborted" })));
      return;
    }
    const listener = () => resume(Effect.fail(SandboxError.make({ message: "aborted" })));
    signal.addEventListener("abort", listener, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", listener));
  });

interface SandboxExecRequest {
  readonly command: string;
  readonly cwd: string;
  readonly onData: (data: Buffer) => void;
  readonly signal: AbortSignal | undefined;
  readonly timeout: number | undefined;
}

const killGroup = (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }).pipe(Effect.ignore);

const runSandboxed = (request: SandboxExecRequest) =>
  Effect.gen(function* () {
    const wrappedCommand = yield* Effect.promise(() =>
      SandboxManager.wrapWithSandbox(request.command),
    );
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make("bash", ["-c", wrappedCommand], {
            cwd: request.cwd,
            detached: true,
            killSignal: "SIGKILL",
            stdin: "ignore",
          }),
        );
        const pid = Number(handle.pid);

        yield* Effect.forkScoped(
          Stream.runForEach(handle.stdout, (chunk) =>
            Effect.sync(() => request.onData(Buffer.from(chunk))),
          ),
        );
        yield* Effect.forkScoped(
          Stream.runForEach(handle.stderr, (chunk) =>
            Effect.sync(() => request.onData(Buffer.from(chunk))),
          ),
        );

        const exitCode =
          request.timeout === undefined
            ? Option.some(yield* handle.exitCode)
            : yield* handle.exitCode.pipe(Effect.timeoutOption(request.timeout * 1000));

        if (Option.isNone(exitCode)) {
          yield* killGroup(pid);
          return yield* SandboxError.make({ message: `timeout:${request.timeout}` });
        }
        return { exitCode: Number(exitCode.value) };
      }),
    );
  });

const createSandboxedBashOps = (): codingAgentTypes.BashOperations => ({
  exec: (command, cwd, { onData, signal, timeout }) => {
    const sandboxed = runSandboxed({ command, cwd, onData, signal, timeout });
    const effect = Effect.gen(function* () {
      if (!(yield* fsService.exists(cwd).pipe(Effect.orElseSucceed(() => false)))) {
        return yield* SandboxError.make({ message: `Working directory does not exist: ${cwd}` });
      }
      return yield* sandboxed;
    });
    return runtime.runPromise(
      signal === undefined ? effect : Effect.raceFirst(effect, abortEffect(signal)),
    );
  },
});

const registerBashTool = (
  msa: codingAgentTypes.ExtensionAPI,
  localCwd: string,
  getSandboxed: () => boolean,
): void => {
  const localBash = createBashTool(localCwd);

  msa.registerTool({
    ...localBash,
    execute: (id, params, signal, onUpdate) => {
      if (!getSandboxed()) return localBash.execute(id, params, signal, onUpdate);
      const sandboxedBash = createBashTool(localCwd, { operations: createSandboxedBashOps() });
      return sandboxedBash.execute(id, params, signal, onUpdate);
    },
    label: "bash (sandboxed)",
  });
};

const disabledReason = (
  msa: codingAgentTypes.ExtensionAPI,
  config: { enabled?: boolean | undefined },
): string | undefined => {
  if (msa.getFlag("no-sandbox") === true) return "Sandbox disabled via --no-sandbox";
  if (config.enabled !== true) return "Sandbox disabled via config";

  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    return `Sandbox not supported on ${platform}`;
  }
  return undefined;
};

const announceSandbox = (
  ctx: codingAgentTypes.ExtensionContext,
  config: configTypes.SandboxConfig,
): void => {
  const networkCount = config.network?.allowedDomains?.length ?? 0;
  const writeCount = config.filesystem?.allowWrite?.length ?? 0;
  ctx.ui.setStatus(
    "sandbox",
    ctx.ui.theme.fg("accent", `🔒 Sandbox: ${networkCount} domains, ${writeCount} write paths`),
  );
  ctx.ui.notify("Sandbox initialized", "info");
};

const initializeSandbox = (
  msa: codingAgentTypes.ExtensionAPI,
  ctx: codingAgentTypes.ExtensionContext,
  setEnabled: (enabled: boolean, initialized: boolean) => void,
) =>
  Effect.gen(function* () {
    const config = yield* loadConfig(ctx.cwd);
    const reason = disabledReason(msa, config);
    if (reason !== undefined) {
      setEnabled(false, false);
      ctx.ui.notify(reason, "warning");
      return;
    }

    const extended = config as unknown as {
      ignoreViolations?: Record<string, string[]>;
      enableWeakerNestedSandbox?: boolean;
    };

    yield* Effect.tryPromise({
      catch: (error) =>
        SandboxError.make({ message: error instanceof Error ? error.message : String(error) }),
      try: () =>
        SandboxManager.initialize({
          enableWeakerNestedSandbox: extended.enableWeakerNestedSandbox,
          filesystem: config.filesystem,
          ignoreViolations: extended.ignoreViolations,
          network: config.network,
        }),
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          setEnabled(false, false);
          ctx.ui.notify(`Sandbox initialization failed: ${error.message}`, "error");
        },
        onSuccess: () => {
          setEnabled(true, true);
          announceSandbox(ctx, config);
        },
      }),
    );
  });

const registerSandboxCommand = (
  msa: codingAgentTypes.ExtensionAPI,
  getEnabled: () => boolean,
): void => {
  msa.registerCommand("sandbox", {
    description: "Show sandbox configuration",
    handler: (_args, ctx) =>
      runtime.runPromise(
        Effect.gen(function* () {
          if (!getEnabled()) {
            ctx.ui.notify("Sandbox is disabled", "info");
            return;
          }

          const config = yield* loadConfig(ctx.cwd);
          const lines = [
            "Sandbox Configuration:",
            "",
            "Network:",
            `  Allowed: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
            `  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
            "",
            "Filesystem:",
            `  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
            `  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
            `  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
        }),
      ),
  });
};

export default function (msa: codingAgentTypes.ExtensionAPI) {
  const localCwd = process.cwd();
  let sandboxEnabled = false;
  let sandboxInitialized = false;

  msa.registerFlag("no-sandbox", {
    default: false,
    description: "Disable OS-level sandboxing for bash commands",
    type: "boolean",
  });

  registerBashTool(msa, localCwd, () => sandboxEnabled && sandboxInitialized);

  msa.on("user_bash", () => {
    if (!sandboxEnabled || !sandboxInitialized) return undefined;
    return { operations: createSandboxedBashOps() };
  });

  msa.on("session_start", (_event, ctx) => {
    void runtime.runPromise(
      initializeSandbox(msa, ctx, (enabled, initialized) => {
        sandboxEnabled = enabled;
        sandboxInitialized = initialized;
      }),
    );
  });

  msa.on("session_shutdown", () => {
    if (!sandboxInitialized) return;
    void SandboxManager.reset().catch(() => undefined);
  });

  registerSandboxCommand(msa, () => sandboxEnabled);
}
