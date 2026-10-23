import testing from "@msa/testing";
import type { TestProject } from "vite-plus/test/node";

const { makeDirectory, removePath, runTest } = testing;

const setup = (project: TestProject): Promise<() => Promise<void>> => {
  const agentDir = project.config.env["MSA_CODING_AGENT_DIR"] ?? "";
  if (agentDir === "") {
    return Promise.reject(
      new Error("MSA_CODING_AGENT_DIR is empty; set it in test.env of vitest.config.ts"),
    );
  }
  return runTest(makeDirectory(agentDir)).then(() => () => runTest(removePath(agentDir)));
};

export default setup;
