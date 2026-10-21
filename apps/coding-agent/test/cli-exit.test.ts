import testing from "@msa/testing";
import { Config, Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const {
  changeMode,
  closeServers,
  joinPath,
  listen,
  makeDirectory,
  makeTempDir,
  pathDelimiter,
  removeDirs,
  resolvePath,
  runNodeScript,
  runTest,
  writeJsonFile,
  writeTextFile,
} = testing;

const EXIT_BUDGET_MS = 2500;

const cliPath = resolvePath(import.meta.dirname, "../src/cli.ts");
const sourceResolverUrl = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const tempDirs: string[] = [];

afterEach(() =>
  runTest(
    Effect.andThen(
      closeServers,
      Effect.suspend(() => removeDirs(tempDirs.splice(0))),
    ),
  ),
);

const chunk = (delta: string, finishReason: string) =>
  `data: {"id":"chatcmpl-exit","object":"chat.completion.chunk","created":0,"model":"exit-model","choices":[{"index":0,"delta":${delta},"finish_reason":${finishReason}}]}\n\n`;

const COMPLETION_STREAM = [
  chunk('{"role":"assistant","content":""}', "null"),
  chunk('{"content":"exit check done"}', "null"),
  chunk("{}", '"stop"'),
  "data: [DONE]\n\n",
].join("");

const startModelServer = listen((request) =>
  Effect.succeed(
    request.url.endsWith("/chat/completions")
      ? new Response(COMPLETION_STREAM, { headers: { "Content-Type": "text/event-stream" } })
      : new Response(null, { status: 404 }),
  ),
);

const prepareAgent = Effect.gen(function* () {
  const origin = yield* startModelServer;
  const root = yield* makeTempDir("msa-cli-exit-");
  tempDirs.push(root);
  const agentDir = joinPath(root, "agent");
  const bin = joinPath(root, "bin");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(bin);
  yield* writeJsonFile(joinPath(agentDir, "models.json"), {
    providers: {
      "exit-check": {
        api: "openai-completions",
        apiKey: "exit-check",
        baseUrl: `${origin}/v1`,
        models: [{ contextWindow: 128_000, id: "exit-model", maxTokens: 1024 }],
      },
    },
  });
  const podman = joinPath(bin, "podman");
  yield* writeTextFile(podman, "#!/bin/sh\nexec sleep 30\n");
  yield* changeMode(podman, 0o755);
  const inheritedPath = yield* Config.String("PATH").pipe(Config.withDefault(""));
  return {
    env: {
      EXIT_CHECK_CLI: cliPath,
      EXIT_CHECK_RESOLVER: sourceResolverUrl,
      MSA_CODING_AGENT_DIR: agentDir,
      MSA_OFFLINE: "1",
      MSA_SKIP_VERSION_CHECK: "1",
      PATH: `${bin}${pathDelimiter}${inheritedPath}`,
    },
    root,
  };
});

const DRIVER = `
import { spawn } from "node:child_process";
const rpc = process.argv[1] === "rpc";
const args = ["--import", process.env.EXIT_CHECK_RESOLVER, process.env.EXIT_CHECK_CLI,
  "--no-session", "--provider", "exit-check", "--model", "exit-model"];
const child = spawn(process.execPath, rpc ? [...args, "--mode", "rpc"] : [...args, "-p", "hi"], {
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
let doneAt;
let asked = false;
const send = (command) => child.stdin.write(JSON.stringify(command) + "\\n");
child.stderr.on("data", (data) => { stderr += data; });
child.stdout.on("data", (data) => {
  stdout += data;
  if (!rpc) {
    if (doneAt === undefined && stdout.includes("exit check done")) doneAt = performance.now();
    return;
  }
  if (!asked && stdout.includes('"id":"state"')) {
    asked = true;
    send({ id: "ask", type: "prompt", message: "hi" });
  }
  if (doneAt === undefined && stdout.includes('"type":"agent_settled"')) {
    doneAt = performance.now();
    child.stdin.end();
  }
});
if (rpc) send({ id: "state", type: "get_state" });
else child.stdin.end();
child.on("exit", (code, signal) => {
  const exitMs = doneAt === undefined ? null : performance.now() - doneAt;
  console.log(JSON.stringify({ code, exitMs, signal, stderr: stderr.slice(-2000), stdout: stdout.slice(-2000) }));
});
`;

const ExitReport = Schema.Struct({
  code: Schema.NullOr(Schema.Finite),
  exitMs: Schema.NullOr(Schema.Finite),
  signal: Schema.NullOr(Schema.String),
  stderr: Schema.String,
  stdout: Schema.String,
});

const decodeExitReport = Schema.decodeUnknownEffect(Schema.fromJsonString(ExitReport));

const measureExit = (mode: "print" | "rpc") =>
  Effect.gen(function* () {
    const { env, root } = yield* prepareAgent;
    const result = yield* runNodeScript(DRIVER, {
      cwd: root,
      env,
      scriptArgs: [mode],
      timeout: "60 seconds",
    });
    expect(result.code, result.stderr).toBe(0);
    return yield* decodeExitReport(result.stdout.trim().split("\n").at(-1) ?? "").pipe(
      Effect.orDie,
    );
  });

const exitsRightAfterFinishing = (mode: "print" | "rpc") => () =>
  runTest(
    Effect.gen(function* () {
      const exit = yield* measureExit(mode);
      expect(exit.stdout).toContain("exit check done");
      expect({ code: exit.code, signal: exit.signal }, exit.stderr).toEqual({
        code: 0,
        signal: null,
      });
      expect(exit.exitMs).not.toBeNull();
      expect(exit.exitMs).toBeLessThan(EXIT_BUDGET_MS);
    }),
  );

describe.skipIf(process.platform === "win32")("CLI process exit", () => {
  it(
    "exits print mode right after the answer while a startup probe is still running",
    exitsRightAfterFinishing("print"),
    60_000,
  );

  it(
    "exits rpc mode right after stdin closes while a startup probe is still running",
    exitsRightAfterFinishing("rpc"),
    60_000,
  );
});
