import testing from "@msa/testing";
import type { TestProject } from "vite-plus/test/node";

const { makeDirectory, removePath, runTest } = testing;

const setup = (project: TestProject): Promise<() => Promise<void>> => {
  const agentDir = project.config.env["MSA_CODING_AGENT_DIR"] ?? "";
  return runTest(makeDirectory(agentDir)).then(() => () => runTest(removePath(agentDir)));
};

export default setup;
