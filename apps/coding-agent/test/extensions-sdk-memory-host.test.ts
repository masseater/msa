import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import loader from "../src/core/extensions/loader.ts";

const { discoverAndLoadExtensions } = loader;
const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const MEMORY_URL = "http://127.0.0.1:47123/api/v1/mcp";
const OTHER_URL = "http://127.0.0.1:47124/mcp";

const extensionCode = `
	export default function(msa) {
		msa.registerMcpServer("recall", { exposure: "direct", url: ${JSON.stringify(MEMORY_URL)} });
		msa.registerMcpServer("recall-proxy", {
			args: ["-y", "mcp-remote", ${JSON.stringify(MEMORY_URL)}],
			command: "npx",
			exposure: "direct",
		});
		msa.registerMcpServer("other", { exposure: "direct", url: ${JSON.stringify(OTHER_URL)} });
	}
`;

const tempLayout = Effect.acquireRelease(makeTempDir("msa-sdk-memory-host-"), (dir) =>
  removePath(dir).pipe(Effect.orDie),
);

const ignoresServersAtTheMemoryHostOfTheAgentDir = Effect.gen(function* () {
  const root = yield* tempLayout;
  const cwd = joinPath(root, "project");
  const agentDir = joinPath(root, "agent");
  yield* makeDirectory(cwd);
  yield* makeDirectory(joinPath(agentDir, "extensions"));
  yield* writeTextFile(
    joinPath(agentDir, "settings.json"),
    yield* toJsonText({ memory: { url: MEMORY_URL } }),
  );
  const extensionPath = joinPath(agentDir, "extensions", "servers.ts");
  yield* writeTextFile(extensionPath, extensionCode);

  const result = yield* awaited(discoverAndLoadExtensions([], cwd, agentDir));

  expect(result.errors).toEqual([]);
  expect(result.runtime.mcpServers.list().map((server) => server.name)).toEqual(["other"]);
  const ignored = result.runtime.mcpServers.ignored();
  for (const name of ["recall", "recall-proxy"])
    expect(ignored.some((notice) => notice.includes(`MCP server "${name}" is ignored`))).toBe(true);
}).pipe(Effect.scoped);

describe("discoverAndLoadExtensions", () => {
  it("ignores MCP servers at the memory.url host of the given agent dir", () =>
    runTest(ignoresServersAtTheMemoryHostOfTheAgentDir));
});
