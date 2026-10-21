import testing from "@msa/testing";
import { Effect } from "effect";

import MemoryService from "../src/core/memory/memory-service.ts";
import type memoryTypes from "../src/core/memory/memory.types.ts";
const { closeServers, joinPath, listen, makeTempDir, readMessage, removeDirs } = testing;

const workspaces: string[] = [];

const vector = (values: number[]): Float32Array => new Float32Array(values);

const makeWorkspace = Effect.fn("makeWorkspace")(function* () {
  const dir = yield* makeTempDir("msa-memory-");
  workspaces.push(dir);
  return dir;
});

const cleanup: Effect.Effect<void> = Effect.gen(function* () {
  yield* closeServers;
  yield* removeDirs(workspaces.splice(0));
});

const embeddingServer = Effect.fn("embeddingServer")(function* (responses: number[][]) {
  const inputs: string[] = [];
  let index = 0;
  const origin = yield* listen((request) =>
    Effect.gen(function* () {
      const message = yield* readMessage(request).pipe(Effect.orElseSucceed(() => ({ input: "" })));
      inputs.push(String(message["input"]));
      const values = responses[Math.min(index, responses.length - 1)];
      index++;
      return Response.json({ data: [{ embedding: values }] });
    }),
  );
  return { baseUrl: `${origin}/v1`, inputs };
});

const settings = (
  workspace: string,
  overrides: Partial<memoryTypes.ResolvedMemorySettings> = {},
): memoryTypes.ResolvedMemorySettings => ({
  database: joinPath(workspace, "memory.db"),
  embedding: {
    baseUrl: "http://127.0.0.1:1/v1",
    documentPrefix: "",
    enabled: false,
    model: "test",
    queryPrefix: "",
    timeoutMs: 500,
  },
  enabled: true,
  recall: { enabled: true, limit: 5, minScore: 0.35 },
  ...overrides,
});

const embeddingSettings = (baseUrl: string): memoryTypes.ResolvedMemorySettings["embedding"] => ({
  baseUrl,
  documentPrefix: "D: ",
  enabled: true,
  model: "test",
  queryPrefix: "Q: ",
  timeoutMs: 2_000,
});

const openService = (cwd: string, serviceSettings: memoryTypes.ResolvedMemorySettings) =>
  Effect.acquireRelease(
    Effect.sync(() => new MemoryService({ cwd, settings: serviceSettings })),
    (service) => Effect.promise(() => service.close()),
  );

const memorySupport = {
  cleanup,
  embeddingServer,
  embeddingSettings,
  makeWorkspace,
  openService,
  settings,
  vector,
};

export default memorySupport;
