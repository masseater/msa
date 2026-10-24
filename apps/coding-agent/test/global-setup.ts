import testing from "@msa/testing";
import type { TestProject } from "vite-plus/test/node";

import liveAuth from "./live-auth.ts";

const { makeDirectory, removePath, runTest } = testing;

const { liveAuthAvailable } = liveAuth;

declare module "vitest" {
  interface ProvidedContext {
    readonly liveAuthAvailable: boolean;
  }
}

const setup = (project: TestProject): Promise<() => Promise<void>> => {
  const agentDir = project.config.env["MSA_CODING_AGENT_DIR"] ?? "";
  if (agentDir === "") {
    return Promise.reject(
      new Error("MSA_CODING_AGENT_DIR is empty; set it in test.env of vitest.config.ts"),
    );
  }
  return runTest(liveAuthAvailable)
    .then((available) => project.provide("liveAuthAvailable", available))
    .then(() => runTest(makeDirectory(agentDir)))
    .then(() => () => runTest(removePath(agentDir)));
};

export default setup;
