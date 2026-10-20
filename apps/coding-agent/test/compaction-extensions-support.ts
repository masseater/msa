import { streamSimple } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import type { AgentSession } from "../src/core/agent-session.ts";
import {
  type Extension,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionEvent,
} from "../src/core/extensions/index.ts";
import { readEnv } from "../src/core/process-env.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createCodingTools } from "../src/index.ts";
import type compactionExtensionsSupportTypes from "./compaction-extensions-support.types.ts";
import sessionKit from "./session-kit.ts";

const { createAgentSession } = sessionKit;
const { makeTempDir, removePath, runTest } = testing;

const API_KEY = readEnv("ANTHROPIC_OAUTH_TOKEN") ?? readEnv("ANTHROPIC_API_KEY");

const hasApiKey = API_KEY !== undefined && API_KEY.length > 0;

const capturedEvents: SessionEvent[] = [];

const sessions: AgentSession[] = [];

let tempDir = "";

const extensionFrom = (
  handlers: Map<string, compactionExtensionsSupportTypes.Handler[]>,
): Extension => ({
  commands: new Map(),
  flags: new Map(),
  handlers,
  messageRenderers: new Map(),
  path: "test-extension",
  resolvedPath: "/test/test-extension.ts",
  shortcuts: new Map(),
  sourceInfo: createSyntheticSourceInfo("<test:test-extension>", { source: "test" }),
  tools: new Map(),
});

const createExtension = (
  onBeforeCompact?: compactionExtensionsSupportTypes.BeforeCompactHandler,
  onCompact?: (event: SessionCompactEvent) => void,
): Extension =>
  extensionFrom(
    new Map<string, compactionExtensionsSupportTypes.Handler[]>([
      [
        "session_before_compact",
        [
          (event) =>
            runTest(
              Effect.sync(() => {
                capturedEvents.push(event as SessionBeforeCompactEvent);
                return onBeforeCompact?.(event as SessionBeforeCompactEvent);
              }),
            ),
        ],
      ],
      [
        "session_compact",
        [
          (event) =>
            runTest(
              Effect.sync(() => {
                capturedEvents.push(event as SessionCompactEvent);
                onCompact?.(event as SessionCompactEvent);
                return undefined;
              }),
            ),
        ],
      ],
    ]),
  );

const createSession = Effect.fn("createSession")(function* (extensions: Extension[]) {
  const { session, settingsManager } = yield* createAgentSession({
    agentTools: createCodingTools(process.cwd()),
    apiKey: API_KEY,
    cwd: tempDir,
    extensions,
    persistSession: true,
    streamFn: streamSimple,
    systemPrompt: "You are a helpful assistant. Be concise.",
    useTestKey: false,
  });
  settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  sessions.push(session);
  return session;
});

const prepare = (): Promise<void> =>
  runTest(
    Effect.gen(function* () {
      tempDir = yield* makeTempDir("msa-compaction-extensions-test-");
      capturedEvents.length = 0;
    }),
  );

const cleanUp = (): Promise<void> =>
  runTest(
    Effect.gen(function* () {
      for (const session of sessions.splice(0)) session.dispose();
      yield* removePath(tempDir);
    }),
  );

const compactionExtensionsSupport = {
  API_KEY,
  capturedEvents,
  cleanUp,
  createExtension,
  createSession,
  extensionFrom,
  hasApiKey,
  prepare,
};

export default compactionExtensionsSupport;
