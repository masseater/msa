import testing from "@msa/testing";
import { Effect } from "effect";

import type codingAgentTypes from "../../../src/index.types.ts";
import closeAgentSessionModule from "../../close-agent-session.ts";

const { makeDirectory, makeTempDir, removeDir } = testing;
const { closeAgentSession } = closeAgentSessionModule;

const createTempDir = (): Promise<string> =>
  Effect.runPromise(
    Effect.flatMap(makeTempDir("msa-suite-"), (tempDir) =>
      Effect.as(makeDirectory(tempDir), tempDir),
    ),
  );

const closeSession = (input: {
  fauxProvider: { unregister: () => void };
  session: codingAgentTypes.AgentSession;
  tempDir: string;
}): Promise<void> =>
  closeAgentSession(input.session)
    .finally(() => input.fauxProvider.unregister())
    .then(() => Effect.runPromise(removeDir(input.tempDir)));

const runtime = {
  closeSession,
  createTempDir,
};

export default runtime;
