import testing from "@msa/testing";
import { Effect } from "effect";

import type codingAgentTypes from "../../../src/index.types.ts";
import closeAgentSessionModule from "../../close-agent-session.ts";

const { makeDirectory, makeTempDir, removeDir } = testing;
const { closeAgentSession } = closeAgentSessionModule;

const createTempDir = (): Promise<string> =>
  Effect.runPromise(Effect.tap(makeTempDir("msa-suite-"), (tempDir) => makeDirectory(tempDir)));

const closeSession = (input: {
  fauxProvider: { unregister: () => void };
  session: codingAgentTypes.AgentSession;
  tempDir: string;
}): Promise<void> => {
  const removeTempDir = () => Effect.runPromise(removeDir(input.tempDir));
  return closeAgentSession(input.session)
    .finally(() => input.fauxProvider.unregister())
    .then(removeTempDir, (error: unknown) =>
      removeTempDir().then(
        () => Promise.reject(error),
        () => Promise.reject(error),
      ),
    );
};

const runtime = {
  closeSession,
  createTempDir,
};

export default runtime;
