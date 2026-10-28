import testing from "@msa/testing";
import { Config, Effect, Schema } from "effect";

import mcpOauthServer from "./suite/mcp-oauth-server.ts";

const {
  changeMode,
  joinPath,
  listen,
  makeDirectory,
  makeTempDir,
  pathDelimiter,
  resolvePath,
  runNodeScript,
  toJsonText,
  writeJsonFile,
  writeTextFile,
} = testing;
const { startOAuthMcpServer } = mcpOauthServer;

const cliPath = resolvePath(import.meta.dirname, "../src/cli.ts");
const sourceResolverUrl = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const HELPER_SERVER_URL = "https://msa.invalid/mcp-oauth";
const LEGACY_TOKEN = "token-saved-by-msa-mcp-login";

const CREDENTIAL_HELPER = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [, , file, action] = process.argv;
const input = readFileSync(0, "utf8");
const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
if (action === "store") {
  const entry = JSON.parse(input);
  data[entry.ServerURL] = entry;
  writeFileSync(file, JSON.stringify(data));
} else if (action === "erase") {
  delete data[input.trim()];
  writeFileSync(file, JSON.stringify(data));
} else {
  const entry = data[input.trim()];
  if (entry === undefined) {
    process.stdout.write("credentials not found in native keychain");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(entry));
}
`;

const BROWSER = `const url = process.argv.at(-1);
await fetch(url, { redirect: "follow" }).then((response) => response.text());
`;

const chunk = (delta: string, finishReason: string) =>
  `data: {"id":"chatcmpl-memory","object":"chat.completion.chunk","created":0,"model":"memory-model","choices":[{"index":0,"delta":${delta},"finish_reason":${finishReason}}]}\n\n`;

const COMPLETION_STREAM = [
  chunk('{"role":"assistant","content":""}', "null"),
  chunk('{"content":"memory check done"}', "null"),
  chunk("{}", '"stop"'),
  "data: [DONE]\n\n",
].join("");

const RPC_DRIVER = `
import { spawn } from "node:child_process";
const commands = JSON.parse(process.argv.at(-1));
const child = spawn(process.execPath, ["--import", process.env.MEMORY_CHECK_RESOLVER,
  process.env.MEMORY_CHECK_CLI, "--no-session", "--mode", "rpc"], { stdio: ["pipe", "pipe", "pipe"] });
const notices = [];
let buffer = "";
let stderr = "";
let next = 0;
const send = () => {
  if (next >= commands.length) { child.stdin.end(); return; }
  child.stdin.write(JSON.stringify({ id: "c" + next, type: "prompt", message: commands[next] }) + "\\n");
  next += 1;
};
child.stderr.on("data", (data) => { stderr += data; });
child.stdout.on("data", (data) => {
  buffer += data;
  const lines = buffer.split("\\n");
  buffer = lines.pop();
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "extension_ui_request" && event.method === "notify") {
      notices.push(event.message);
      if (notices.length === next) send();
    }
  }
});
send();
const timer = setTimeout(() => child.kill(), 30000);
child.on("exit", () => {
  clearTimeout(timer);
  console.log(JSON.stringify({ notices, stderr: stderr.slice(-4000) }));
});
`;

const RunResult = Schema.Struct({
  code: Schema.NullOr(Schema.Finite),
  stderr: Schema.String,
  stdout: Schema.String,
});

const RpcResult = Schema.Struct({ notices: Schema.Array(Schema.String), stderr: Schema.String });

const ModelRequest = Schema.Struct({
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({ function: Schema.optional(Schema.Struct({ name: Schema.String })) }),
    ),
  ),
});

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

const decodeRun = Schema.decodeUnknownEffect(Schema.fromJsonString(RunResult));
const decodeRpc = Schema.decodeUnknownEffect(Schema.fromJsonString(RpcResult));
const decodeModelRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(ModelRequest));

const legacySignIn = (url: string) =>
  Effect.map(
    toJsonText({
      [`mcp__sepiace|${url}`]: {
        serverUrl: url,
        tokens: { access_token: LEGACY_TOKEN, token_type: "Bearer" },
      },
    }),
    (secret) => ({
      [HELPER_SERVER_URL]: { Secret: secret, ServerURL: HELPER_SERVER_URL, Username: "msa" },
    }),
  );

const startModel = Effect.gen(function* () {
  const bodies: string[] = [];
  const origin = yield* listen((request) =>
    Effect.promise(() => request.text()).pipe(
      Effect.map((body) => {
        if (!request.url.endsWith("/chat/completions")) return new Response(null, { status: 404 });
        bodies.push(body);
        return new Response(COMPLETION_STREAM, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    ),
  );
  return { bodies, origin };
});

const toolNames = (body: string) =>
  Effect.map(Effect.orDie(decodeModelRequest(body)), (request) =>
    (request.tools ?? []).flatMap((tool) =>
      tool.function === undefined ? [] : [tool.function.name],
    ),
  );

interface Layout {
  readonly agentDir: string;
  readonly bin: string;
  readonly cwd: string;
  readonly root: string;
  readonly store: string;
  readonly mcpConfig: string;
}

const RUN_CLI = `import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--import", process.env.MEMORY_CHECK_RESOLVER,
  process.env.MEMORY_CHECK_CLI, ...JSON.parse(process.argv.at(-1))], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
console.log(JSON.stringify({ code: result.status, stderr: result.stderr, stdout: result.stdout }));`;

const makeLayout = Effect.gen(function* () {
  const root = yield* makeTempDir("msa-memory-startup-");
  const agentDir = joinPath(root, "agent");
  const layout: Layout = {
    agentDir,
    bin: joinPath(root, "bin"),
    cwd: joinPath(root, "project"),
    mcpConfig: joinPath(agentDir, "mcp.json"),
    root,
    store: joinPath(root, "credentials.json"),
  };
  for (const directory of [layout.agentDir, layout.cwd, layout.bin])
    yield* makeDirectory(directory);
  return layout;
});

const writeBrowser = (layout: Layout) =>
  Effect.gen(function* () {
    const browser = joinPath(layout.root, "browser.mjs");
    yield* writeTextFile(browser, BROWSER);
    for (const name of ["open", "xdg-open"]) {
      const path = joinPath(layout.bin, name);
      yield* writeTextFile(path, `#!/bin/sh\nexec "${process.execPath}" "${browser}" "$1"\n`);
      yield* changeMode(path, 0o755);
    }
  });

const writeAgentFiles = (
  layout: Layout,
  urls: { readonly sepiace: string; readonly model: string },
  options: PrepareOptions,
) =>
  Effect.gen(function* () {
    const helper = joinPath(layout.root, "credential-helper.mjs");
    yield* writeTextFile(helper, CREDENTIAL_HELPER);
    yield* writeJsonFile(layout.store, options.signedIn ? yield* legacySignIn(urls.sepiace) : {});
    yield* writeJsonFile(layout.mcpConfig, {
      credentialHelper: { args: [helper, layout.store], command: process.execPath },
      mcpServers: options.mcpServers?.(urls.sepiace) ?? {},
    });
    yield* writeJsonFile(joinPath(layout.agentDir, "settings.json"), {
      memory: { url: urls.sepiace, ...options.memory },
    });
    yield* writeJsonFile(joinPath(layout.agentDir, "models.json"), {
      providers: {
        "memory-check": {
          api: "openai-completions",
          apiKey: "memory-check",
          baseUrl: `${urls.model}/v1`,
          models: [{ contextWindow: 128_000, id: "memory-model", maxTokens: 1024 }],
        },
      },
    });
  });

const runners = (layout: Layout) =>
  Effect.gen(function* () {
    const inheritedPath = yield* Config.String("PATH").pipe(Config.withDefault(""));
    const env = {
      MEMORY_CHECK_CLI: cliPath,
      MEMORY_CHECK_RESOLVER: sourceResolverUrl,
      MSA_CODING_AGENT_DIR: layout.agentDir,
      MSA_OFFLINE: "1",
      MSA_SKIP_VERSION_CHECK: "1",
      PATH: `${layout.bin}${pathDelimiter}${inheritedPath}`,
    };
    const script = (source: string, args: readonly string[]) =>
      Effect.flatMap(toJsonText(args), (encoded) =>
        runNodeScript(source, {
          cwd: layout.cwd,
          env,
          scriptArgs: [encoded],
          timeout: "60 seconds",
        }),
      ).pipe(Effect.map((result) => lastLine(result.stdout)));
    const run = (args: readonly string[]) =>
      Effect.flatMap(script(RUN_CLI, args), (line) => Effect.orDie(decodeRun(line)));
    const prompt = (text: string, flags: readonly string[] = []) =>
      run([
        "--no-session",
        "--provider",
        "memory-check",
        "--model",
        "memory-model",
        ...flags,
        "-p",
        text,
      ]);
    const rpc = (commands: readonly string[]) =>
      Effect.flatMap(script(RPC_DRIVER, commands), (line) => Effect.orDie(decodeRpc(line)));
    return { prompt, rpc, run };
  });

interface PrepareOptions {
  readonly signedIn: boolean;
  readonly mcpServers?: (sepiaceUrl: string) => Record<string, unknown>;
  readonly memory?: Record<string, unknown>;
}

const prepare = (options: PrepareOptions) =>
  Effect.gen(function* () {
    const sepiace = yield* Effect.promise(() =>
      startOAuthMcpServer({
        memory: (request) => (request.includes("release") ? "Releases go to the tap." : ""),
      }),
    );
    sepiace.trustToken(LEGACY_TOKEN);
    const model = yield* startModel;
    const layout = yield* makeLayout;
    yield* writeBrowser(layout);
    yield* writeAgentFiles(layout, { model: model.origin, sepiace: sepiace.url }, options);
    return { ...layout, ...(yield* runners(layout)), model, sepiace };
  });

const memoryStartupSupport = { prepare, toolNames };

export default memoryStartupSupport;
