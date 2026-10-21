import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import memorySupport from "./memory-support.ts";

const { awaited, joinPath, makeDirectory, runTest } = testing;

const { cleanup, embeddingServer, embeddingSettings, makeWorkspace, openService, settings } =
  memorySupport;

afterEach(() => runTest(cleanup));

const repositoryWithSubdirectory = Effect.gen(function* () {
  const workspace = yield* makeWorkspace();
  const repository = joinPath(workspace, "shared-repo");
  const subdirectory = joinPath(repository, "packages", "app");
  yield* makeDirectory(joinPath(repository, ".git"));
  yield* makeDirectory(subdirectory);
  return { repository, subdirectory, workspace };
});

const scopesEveryCallFromASubdirectoryToTheRepository = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const { baseUrl } = yield* embeddingServer([[1, 0]]);
        const { repository, subdirectory, workspace } = yield* repositoryWithSubdirectory;
        const memorySettings = settings(workspace, { embedding: embeddingSettings(baseUrl) });
        const atRoot = yield* openService(repository, memorySettings);
        const saved = yield* awaited(atRoot.save({ content: "releases ship through the tap" }));
        expect(saved.record.project).toBe("shared-repo");

        const inSubdirectory = yield* openService(subdirectory, memorySettings);
        const [recalled, listed, status] = yield* awaited(
          Promise.all([
            inSubdirectory.recall("how do releases ship?"),
            inSubdirectory.list(),
            inSubdirectory.describeStatus(),
          ]),
        );

        expect(recalled.map((record) => record.id)).toEqual([saved.record.id]);
        expect(listed.map((record) => record.id)).toEqual([saved.record.id]);
        expect(status).toContain("Project: shared-repo");
        expect(inSubdirectory.project).toBe("shared-repo");
      }),
    ),
  );

describe("MemoryService project scope", () => {
  it(
    "scopes recall, list, and status from a subdirectory to the repository before any other call",
    scopesEveryCallFromASubdirectoryToTheRepository,
  );
});
