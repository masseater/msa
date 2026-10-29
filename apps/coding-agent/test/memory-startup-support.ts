import testing from "@msa/testing";
import { Config, Effect, Schema } from "effect";
import { afterEach } from "vite-plus/test";

import memoryStartupScripts from "./memory-startup-scripts.ts";
import mcpOauthServer from "./suite/mcp-oauth-server.ts";

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
  toJsonText,
  writeJsonFile,
  writeTextFile,
} = testing;
const { startOAuthMcpServer } = mcpOauthServer;
const {
  BROWSER,
  COMPLETION_STREAM,
  CREDENTIAL_HELPER,
  REPLACING_MCP_EXTENSION,
  RPC_DRIVER,
  RUN_CLI,
  memoryToolCallStream,
} = memoryStartupScripts;

const cliPath = resolvePath(import.meta.dirname, "../src/cli.ts");
const sourceResolverUrl = new URL("../src/experimental/source-resolver.ts", import.meta.url).href;

const HELPER_SERVER_URL = "https://msa.invalid/mcp-oauth";
const LEGACY_TOKEN = "token-saved-by-msa-mcp-login";

const RunResult = Schema.Struct({
  code: Schema.NullOr(Schema.Finite),
  stderr: Schema.String,
  stdout: Schema.String,
});

const RpcResult = Schema.Struct({ notices: Schema.Array(Schema.String), stderr: Schema.String });

const ModelRequest = Schema.Struct({
  messages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        content: Schema.optional(Schema.Unknown),
        role: Schema.String,
      }),
    ),
  ),
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

const startModel = (memoryToolRequest: string | undefined) =>
  Effect.gen(function* () {
    const bodies: string[] = [];
    const origin = yield* listen((request) =>
      Effect.promise(() => request.text()).pipe(
        Effect.map((body) => {
          if (!request.url.endsWith("/chat/completions"))
            return new Response(null, { status: 404 });
          bodies.push(body);
          const stream =
            memoryToolRequest !== undefined && bodies.length === 1
              ? memoryToolCallStream(memoryToolRequest)
              : COMPLETION_STREAM;
          return new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }),
      ),
    );
    return { bodies, origin };
  });

const toolResults = (body: string) =>
  Effect.map(Effect.orDie(decodeModelRequest(body)), (request) =>
    (request.messages ?? []).flatMap((message) =>
      message.role === "tool"
        ? [typeof message.content === "string" ? message.content : JSON.stringify(message.content)]
        : [],
    ),
  );

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
  readonly lock: string;
  readonly root: string;
  readonly store: string;
  readonly mcpConfig: string;
}

const makeLayout = Effect.gen(function* () {
  const root = yield* makeTempDir("msa-memory-startup-");
  const agentDir = joinPath(root, "agent");
  const layout: Layout = {
    agentDir,
    bin: joinPath(root, "bin"),
    cwd: joinPath(root, "project"),
    lock: joinPath(root, "keychain-locked"),
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
    if (options.storeFails === true) yield* writeTextFile(layout.lock, "");
    if (options.replaceMcp === true) {
      const extensions = joinPath(layout.agentDir, "extensions");
      yield* makeDirectory(extensions);
      yield* writeTextFile(joinPath(extensions, "other-mcp.js"), REPLACING_MCP_EXTENSION);
    }
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
      MEMORY_CHECK_LOCK: layout.lock,
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
  readonly memoryToolRequest?: string;
  readonly replaceMcp?: boolean;
  readonly storeFails?: boolean;
  readonly tokenRejected?: boolean;
  readonly sepiaceDown?: boolean;
  readonly sepiaceHangs?: boolean;
}

const prepare = (options: PrepareOptions) =>
  Effect.gen(function* () {
    const sepiace = yield* Effect.promise(() =>
      startOAuthMcpServer({
        memory: (request) => (request.includes("release") ? "Releases go to the tap." : ""),
      }),
    );
    if (options.tokenRejected !== true) sepiace.trustToken(LEGACY_TOKEN);
    const model = yield* startModel(options.memoryToolRequest);
    const layout = yield* makeLayout;
    yield* writeBrowser(layout);
    const sepiaceUrl =
      options.sepiaceHangs === true ? `${yield* listen(() => Effect.never)}/mcp` : sepiace.url;
    yield* writeAgentFiles(layout, { model: model.origin, sepiace: sepiaceUrl }, options);
    if (options.sepiaceDown === true) yield* Effect.promise(sepiace.close);
    return { ...layout, ...(yield* runners(layout)), model, sepiace };
  });

const useAgents = () => {
  const tempDirs: string[] = [];
  const closers: (() => Promise<void>)[] = [];
  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        for (const close of closers.splice(0)) yield* Effect.promise(close);
        yield* closeServers;
        yield* removeDirs(tempDirs.splice(0));
      }),
    ),
  );
  return (options: PrepareOptions) =>
    Effect.tap(prepare(options), (agent) =>
      Effect.sync(() => {
        tempDirs.push(agent.root);
        closers.push(agent.sepiace.close);
      }),
    );
};

const memoryStartupSupport = { prepare, toolNames, toolResults, useAgents };

export default memoryStartupSupport;
