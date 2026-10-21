import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";
import platform from "../src/core/platform/index.ts";
import sourceInfoModule from "../src/core/source-info.ts";
import src from "../src/index.ts";
import type compactionExtensionsSupportTypes from "./compaction-extensions-support.types.ts";
import sessionKit from "./session-kit.ts";

const { readEnv } = platform;
const { createSyntheticSourceInfo } = sourceInfoModule;
const { createCodingTools } = src;

const { streamSimple } = compat;

const { createAgentSession } = sessionKit;
const { makeTempDir, removePath, runTest } = testing;

const API_KEY = readEnv("ANTHROPIC_OAUTH_TOKEN") ?? readEnv("ANTHROPIC_API_KEY");

const hasApiKey = API_KEY !== undefined && API_KEY.length > 0;

const capturedEvents: extensionsTypes.SessionEvent[] = [];

const sessions: agentSessionTypes.AgentSession[] = [];

let tempDir = "";

const extensionFrom = (
  handlers: Map<string, compactionExtensionsSupportTypes.Handler[]>,
): extensionsTypes.Extension => ({
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
  onCompact?: (event: extensionsTypes.SessionCompactEvent) => void,
): extensionsTypes.Extension =>
  extensionFrom(
    new Map<string, compactionExtensionsSupportTypes.Handler[]>([
      [
        "session_before_compact",
        [
          (event) =>
            runTest(
              Effect.sync(() => {
                capturedEvents.push(event as extensionsTypes.SessionBeforeCompactEvent);
                return onBeforeCompact?.(event as extensionsTypes.SessionBeforeCompactEvent);
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
                capturedEvents.push(event as extensionsTypes.SessionCompactEvent);
                onCompact?.(event as extensionsTypes.SessionCompactEvent);
                return undefined;
              }),
            ),
        ],
      ],
    ]),
  );

const createSession = Effect.fn("createSession")(function* (
  extensions: extensionsTypes.Extension[],
) {
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
