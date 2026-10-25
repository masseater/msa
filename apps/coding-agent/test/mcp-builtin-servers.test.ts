import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import memory from "../src/core/memory/memory.ts";
import builtinServersModule from "../src/extensions/mcp/builtin-servers.ts";
import mcpConfig from "../src/extensions/mcp/config.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removeDir,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;
const { loadMcpConfig, updateMcpServerConfig } = mcpConfig;
const { builtinServers, sepiaceEntry, shellBuiltinServers } = builtinServersModule;
const { SEPIACE_URL } = memory;

const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const directory of directories.splice(0)) yield* removeDir(directory);
    }),
  ),
);

const workspace = Effect.gen(function* () {
  const root = yield* makeTempDir("msa-builtin-mcp-");
  directories.push(root);
  const agentDir = joinPath(root, "agent");
  const cwd = joinPath(root, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(joinPath(cwd, ".msa"));
  const load = () =>
    awaited(
      loadMcpConfig({ agentDir, builtins: [sepiaceEntry(agentDir)], cwd, projectTrusted: true }),
    );
  const writeConfig = (path: string, mcpServers: Record<string, unknown>) =>
    Effect.flatMap(toJsonText({ mcpServers }), (text) => writeTextFile(path, text));
  return {
    agentDir,
    cwd,
    globalPath: joinPath(agentDir, "mcp.json"),
    load,
    projectPath: joinPath(cwd, ".msa", "mcp.json"),
    writeConfig,
  };
});

const sepiaceOf = (loaded: Awaited<ReturnType<typeof loadMcpConfig>>) =>
  loaded.servers.find((server) => server.name === "sepiace");

const appliesOverridesToTheBuiltinServer = () =>
  runTest(
    Effect.gen(function* () {
      const { globalPath, load, projectPath, writeConfig } = yield* workspace;
      const plain = sepiaceOf(yield* load());
      expect(plain?.config).toMatchObject({ exposure: "hidden", url: SEPIACE_URL });

      yield* writeConfig(globalPath, { sepiace: { enabled: false } });
      const disabled = yield* load();
      expect(disabled.errors).toEqual([]);
      expect(sepiaceOf(disabled)?.config).toMatchObject({ enabled: false, url: SEPIACE_URL });
      expect(sepiaceOf(disabled)?.override).toBeUndefined();

      yield* writeConfig(projectPath, { sepiace: { enabled: true } });
      const reenabled = sepiaceOf(yield* load());
      expect(reenabled?.config.enabled).toBe(true);
      expect(reenabled?.override).toBe(projectPath);

      yield* writeConfig(globalPath, {
        sepiace: {
          exposure: "codemode",
          toolExposure: { memory: "direct" },
          url: "http://127.0.0.1:9/mcp",
        },
      });
      yield* writeConfig(projectPath, {});
      const replaced = sepiaceOf(yield* load());
      expect(replaced?.config).toMatchObject({ exposure: "hidden", url: "http://127.0.0.1:9/mcp" });
      expect(replaced?.config.toolExposure).toBeUndefined();
      expect(replaced?.scope).toBe("builtin");

      yield* writeConfig(projectPath, { sepiace: { url: "http://127.0.0.1:8/mcp" } });
      const fromProject = yield* load();
      expect(sepiaceOf(fromProject)?.config).toMatchObject({ url: "http://127.0.0.1:9/mcp" });
      expect(fromProject.errors).toHaveLength(1);

      yield* writeConfig(projectPath, { sepiace: { exposure: "direct" } });
      const exposed = yield* load();
      expect(sepiaceOf(exposed)?.config.exposure).toBe("hidden");
      expect(exposed.errors).toHaveLength(1);
    }),
  );

const savesBuiltinChangesAsAGlobalOverride = () =>
  runTest(
    Effect.gen(function* () {
      const { globalPath, load } = yield* workspace;
      yield* awaited(
        updateMcpServerConfig(globalPath, "sepiace", { enabled: false }, { override: true }),
      );
      expect(sepiaceOf(yield* load())?.config.enabled).toBe(false);
    }),
  );

const ignoresAnUntrustedProjectForShellCommands = () =>
  runTest(
    Effect.gen(function* () {
      const root = yield* makeTempDir("msa-builtin-shell-");
      directories.push(root);
      const agentDir = joinPath(root, "agent");
      const cwd = joinPath(root, "project");
      yield* makeDirectory(agentDir);
      yield* makeDirectory(joinPath(cwd, ".msa"));
      yield* writeTextFile(
        joinPath(cwd, ".msa", "settings.json"),
        yield* toJsonText({ memory: { enabled: false } }),
      );
      const enabled = () =>
        Effect.map(awaited(shellBuiltinServers(cwd, agentDir)), (servers) =>
          servers.map((server) => `${server.name}:${String(server.config.enabled !== false)}`),
        );
      expect(yield* enabled()).toEqual(["sepiace:true"]);
      yield* writeTextFile(
        joinPath(agentDir, "settings.json"),
        yield* toJsonText({ memory: { enabled: false } }),
      );
      expect(yield* enabled()).toEqual(["sepiace:false"]);
    }),
  );

const keepsAReplacedServerHiddenAndOffWithMemoryOff = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir, globalPath, writeConfig, cwd } = yield* workspace;
      yield* writeConfig(globalPath, { sepiace: { url: "http://127.0.0.1:9/mcp" } });
      const loaded = yield* awaited(
        loadMcpConfig({
          agentDir,
          builtins: builtinServers(agentDir, { memory: { enabled: false } }),
          cwd,
          projectTrusted: true,
        }),
      );
      expect(sepiaceOf(loaded)?.config).toMatchObject({
        enabled: false,
        exposure: "hidden",
        url: "http://127.0.0.1:9/mcp",
      });
    }),
  );

describe("built-in MCP servers", () => {
  it(
    "applies global and project overrides to the built-in sepiace server",
    appliesOverridesToTheBuiltinServer,
  );
  it(
    "keeps the built-in server after a change is saved for it",
    savesBuiltinChangesAsAGlobalOverride,
  );
  it(
    "keeps a replaced sepiace hidden and off while memory is off",
    keepsAReplacedServerHiddenAndOffWithMemoryOff,
  );
  it(
    "reads memory.enabled for shell commands without an untrusted project's settings",
    ignoresAnUntrustedProjectForShellCommands,
  );
});
