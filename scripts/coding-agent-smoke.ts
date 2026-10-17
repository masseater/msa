import { Config, Console, Data, Effect, Option, Schema } from "effect";

import { Host } from "./host.ts";
import type { HostShape } from "./host.ts";

const codingAgentName = "@msa/coding-agent";

const SMOKE_TIMEOUT_MS = 30_000;

const ManifestSchema = Schema.fromJsonString(
  Schema.Struct({
    bin: Schema.Struct({ msa: Schema.String }),
    version: Schema.String,
  }),
);

class SmokeError extends Data.TaggedError("SmokeError")<{ readonly message: string }> {}

const PASSTHROUGH_ENV = ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"];

const optionalEnv = (name: string) =>
  Effect.map(Config.option(Config.String(name)), Option.getOrUndefined);

const smokeEnv = (home: string) =>
  Effect.gen(function* () {
    const env: Record<string, string | undefined> = {
      PATH: yield* optionalEnv("PATH"),
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      XDG_CONFIG_HOME: home,
      XDG_CACHE_HOME: home,
      MSA_CODING_AGENT_DIR: `${home}/.msa/agent`,
      MSA_OFFLINE: "1",
      MSA_TELEMETRY: "0",
    };
    yield* Effect.forEach(PASSTHROUGH_ENV, (name) =>
      Effect.gen(function* () {
        const value = yield* optionalEnv(name);
        if (value !== undefined && value !== "") env[name] = value;
      }),
    );
    return env;
  });

const runSmoke = (options: {
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly host: HostShape;
  readonly runtime: string;
}) =>
  Effect.gen(function* () {
    const result = yield* options.host
      .run({
        args: options.args,
        command: options.runtime,
        cwd: options.cwd,
        env: options.env,
        extendEnv: false,
        stderr: "pipe",
        stdin: "inherit",
        stdout: "pipe",
      })
      .pipe(
        Effect.timeoutOrElse({
          duration: SMOKE_TIMEOUT_MS,
          orElse: () =>
            new SmokeError({
              message: `${options.runtime} ${options.args.join(" ")} timed out after ${SMOKE_TIMEOUT_MS} ms`,
            }),
        }),
      );
    if (result.exitCode !== 0) {
      return yield* new SmokeError({
        message: `${options.runtime} ${options.args.join(" ")} exited with ${result.exitCode}:\n${result.stderr}`,
      });
    }
    return result.stdout;
  });

const smokeTestCodingAgent = (options: { readonly directory: string; readonly runtime?: string }) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const runtime = options.runtime ?? process.execPath;
    const { directory } = options;
    const packageDir = host.join(directory, "node_modules", codingAgentName);
    const manifest = yield* Schema.decodeEffect(ManifestSchema)(
      yield* host.readText(host.join(packageDir, "package.json")),
    );
    const home = yield* host.makeTempDirectory("msa-coding-agent-smoke-home-");
    const entry = host.join(directory, "coding-agent-smoke.mjs");
    const env = yield* smokeEnv(home);
    yield* Effect.ensuring(
      Effect.gen(function* () {
        yield* host.writeText(
          entry,
          `import assert from "node:assert/strict";
import { createAgentSession, SessionManager, ModelRuntime } from "${codingAgentName}";
assert.equal(typeof createAgentSession, "function");
assert.equal(typeof SessionManager.inMemory, "function");
assert.equal(typeof ModelRuntime.create, "function");
`,
        );
        yield* runSmoke({ args: [entry], cwd: directory, env, host, runtime });
        const clis = [...new Set([manifest.bin.msa, "dist/cli.js"])];
        yield* Effect.forEach(clis, (cli) =>
          Effect.gen(function* () {
            const output = yield* runSmoke({
              args: [host.join(packageDir, cli), "--version"],
              cwd: directory,
              env,
              host,
              runtime,
            });
            if (output.trim() !== manifest.version) {
              return yield* new SmokeError({
                message: `Unexpected version from ${cli}: ${output}`,
              });
            }
          }),
        );
      }),
      Effect.all([host.remove(entry), host.remove(home)]),
    );
    yield* Console.log(`Coding-agent policy smoke tests passed (${runtime}).`);
  });

export { codingAgentName, smokeTestCodingAgent };
