import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach } from "vite-plus/test";

import type codingAgentTypes from "../src/index.types.ts";
import sessionKit from "./session-kit.ts";

const { runTest } = testing;
const { disposeWorkspace, prepareWorkspace } = sessionKit;

interface Workspace {
  tempDir: string;
  session: codingAgentTypes.AgentSession | undefined;
}

const useWorkspace = (prefix: string): Workspace => {
  const workspace: Workspace = { session: undefined, tempDir: "" };

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        workspace.tempDir = yield* prepareWorkspace(prefix);
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* disposeWorkspace(workspace.session, workspace.tempDir);
        workspace.session = undefined;
        workspace.tempDir = "";
      }),
    ),
  );

  return workspace;
};

const sessionWorkspace = {
  useWorkspace,
};

export default sessionWorkspace;
