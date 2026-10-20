import testing from "@msa/testing";
import { Effect } from "effect";

const { joinPath, makeDirectory, makeTempDir, writeJsonFile } = testing;

const dirs: string[] = [];

const setup = Effect.fn("setup")(function* (global: unknown, project: unknown) {
  const root = yield* makeTempDir("msa-mcp-config-");
  dirs.push(root);
  const agentDir = joinPath(root, "agent");
  const cwd = joinPath(root, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(joinPath(cwd, ".msa"));
  yield* writeJsonFile(joinPath(agentDir, "mcp.json"), global);
  yield* writeJsonFile(joinPath(cwd, ".msa", "mcp.json"), project);
  return { agentDir, cwd };
});

const mcpExtensionSupport = {
  dirs,
  setup,
};

export default mcpExtensionSupport;
