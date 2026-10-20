import contextModule from "@msa/chord/context";
import testing from "@msa/durable/testing";
import { Effect } from "effect";
import { type TestContext, afterAll, describe, expect, test } from "vite-plus/test";

import nodeModule from "../src/storage/jsonl/node.ts";
import memory from "../src/storage/memory.ts";
import node from "../src/storage/sqlite/node.ts";
import type typesModule from "../src/types.types.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { openNodeSqliteStorage } = node;
const { openNodeJsonlStorage } = nodeModule;
const { MemoryStorage } = memory;
const {
  STORAGE_READ_BENCHMARKS,
  STORAGE_WRITE_BENCHMARKS,
  seedStorageBenchmark,
  seedStorageWriteBenchmark,
} = testing;

const { awaited } = effectSupport;
const { copyFile, copyPath, makeTempFile, removeDirs } = platformSupport;

const STORAGE_BENCHMARK_BACKENDS = ["memory", "sqlite", "jsonl"] as const;
type StorageBenchmarkBackend = (typeof STORAGE_BENCHMARK_BACKENDS)[number];
type PersistentBackend = Exclude<StorageBenchmarkBackend, "memory">;

const READ_OPTIONS = { iterations: 10, time: 300, warmupIterations: 3, warmupTime: 75 } as const;
const WRITE_OPTIONS = { iterations: 20, time: 0, warmupIterations: 5, warmupTime: 0 } as const;
const REOPEN_OPTIONS = { iterations: 20, time: 0, warmupIterations: 3, warmupTime: 0 } as const;

type Fixture = {
  readonly backend: StorageBenchmarkBackend;
  readonly storage: typesModule.Storage;
};

type ReopenFixture = {
  readonly backend: PersistentBackend;
  readonly path: string;
  readonly firstEntryId: typesModule.EntryId;
  readonly samples: string[];
};

const fixtures: Fixture[] = [];
const directories: string[] = [];
const reopenedStorages: typesModule.Storage[] = [];

const storagePath = Effect.fn("storagePath")(function* (
  backend: PersistentBackend,
  prefix: string,
) {
  const name = backend === "sqlite" ? "storage.sqlite" : "storage";
  const { directory, path } = yield* makeTempFile(prefix, name);
  directories.push(directory);
  return path;
});

const openPersistentStorage = Effect.fn("openPersistentStorage")(function* (
  backend: PersistentBackend,
  path: string,
) {
  return yield* awaited<typesModule.Storage>(
    backend === "sqlite"
      ? openNodeSqliteStorage(path)
      : openNodeJsonlStorage(path, BACKGROUND_CONTEXT),
  );
});

const createFixture = Effect.fn("createFixture")(function* (backend: StorageBenchmarkBackend) {
  const storage =
    backend === "memory"
      ? new MemoryStorage()
      : yield* openPersistentStorage(
          backend,
          yield* storagePath(backend, "msa-durable-benchmark-"),
        );
  const fixture: Fixture = { backend, storage };
  fixtures.push(fixture);
  return fixture;
});

const createWriteFixture = Effect.fn("createWriteFixture")(function* (
  backend: StorageBenchmarkBackend,
) {
  const fixture = yield* createFixture(backend);
  yield* awaited(seedStorageWriteBenchmark(fixture.storage));
  return fixture;
});

const copyPersistentStorage = Effect.fn("copyPersistentStorage")(function* (
  backend: PersistentBackend,
  source: string,
  destination: string,
) {
  yield* backend === "sqlite" ? copyFile(source, destination) : copyPath(source, destination);
});

const reopenAndRead = Effect.fn("reopenAndRead")(function* (
  backend: PersistentBackend,
  path: string,
  firstEntryId: typesModule.EntryId,
) {
  const storage = yield* openPersistentStorage(backend, path);
  const id = (yield* awaited(storage.entry(firstEntryId, BACKGROUND_CONTEXT)))?.entry.id ?? -1;
  return { id, storage };
});

const seedReads = Effect.gen(function* () {
  const readFixtures = yield* Effect.forEach(STORAGE_BENCHMARK_BACKENDS, createFixture, {
    concurrency: "unbounded",
  });
  const seeded = yield* Effect.forEach(
    readFixtures,
    (fixture) =>
      awaited(seedStorageBenchmark(fixture.storage)).pipe(
        Effect.map((dataset) => ({ dataset, fixture })),
      ),
    { concurrency: "unbounded" },
  );
  for (const { fixture, dataset } of seeded) {
    for (const scenario of STORAGE_READ_BENCHMARKS) {
      expect(yield* awaited(scenario.run(fixture.storage, dataset))).toBe(
        scenario.expected(dataset),
      );
    }
  }
  return seeded;
});

const seedWrites = Effect.gen(function* () {
  const pools = new Map<string, Fixture[]>();
  for (const scenario of STORAGE_WRITE_BENCHMARKS) {
    for (const backend of STORAGE_BENCHMARK_BACKENDS) {
      const validation = yield* createWriteFixture(backend);
      expect(yield* awaited(scenario.run(validation.storage))).toBe(scenario.expected);
      const pool = yield* Effect.forEach(
        Array.from({ length: WRITE_OPTIONS.iterations + WRITE_OPTIONS.warmupIterations }),
        () => createWriteFixture(backend),
        { concurrency: "unbounded" },
      );
      pools.set(`${scenario.name}:${backend}`, pool);
    }
  }
  return pools;
});

const seedReopenFixture = Effect.fn("seedReopenFixture")(function* (backend: PersistentBackend) {
  const seedPath = yield* storagePath(backend, `msa-durable-${backend}-reopen-benchmark-`);
  const seed = yield* openPersistentStorage(backend, seedPath);
  const dataset = yield* awaited(seedStorageBenchmark(seed));
  yield* awaited(seed.close(BACKGROUND_CONTEXT));
  const samples = yield* Effect.forEach(
    Array.from({ length: REOPEN_OPTIONS.iterations + REOPEN_OPTIONS.warmupIterations }),
    () =>
      Effect.gen(function* () {
        const path = yield* storagePath(backend, `msa-durable-${backend}-reopen-sample-`);
        yield* copyPersistentStorage(backend, seedPath, path);
        return path;
      }),
    { concurrency: "unbounded" },
  );
  const fixture: ReopenFixture = {
    backend,
    firstEntryId: dataset.firstEntryId,
    path: seedPath,
    samples,
  };
  const validation = yield* reopenAndRead(backend, seedPath, dataset.firstEntryId);
  expect(validation.id).toBe(dataset.firstEntryId);
  yield* awaited(validation.storage.close(BACKGROUND_CONTEXT));
  return fixture;
});

type BenchContext = Pick<TestContext, "bench">;

const PERSISTENT_BACKENDS = ["sqlite", "jsonl"] as const;

const reads = Effect.runSync(Effect.cached(seedReads));
const writePools = Effect.runSync(Effect.cached(seedWrites));
const reopenFixtures = Effect.runSync(
  Effect.cached(Effect.forEach(PERSISTENT_BACKENDS, seedReopenFixture)),
);

const nextWriteFixture = (pool: Fixture[]): Fixture => {
  const fixture = pool.shift();
  if (fixture === undefined) throw new Error("Write benchmark fixture pool was exhausted");
  return fixture;
};

const nextReopenSample = (fixture: ReopenFixture): string => {
  const path = fixture.samples.shift();
  if (path === undefined) throw new Error("Reopen benchmark fixture pool was exhausted");
  return path;
};

const seededRead = (backend: StorageBenchmarkBackend) =>
  Effect.flatMap(reads, (seeded) => {
    const read = seeded.find(({ fixture }) => fixture.backend === backend);
    return read === undefined
      ? Effect.die(new Error(`No ${backend} read fixture`))
      : Effect.succeed(read);
  });

const readBench =
  (scenario: (typeof STORAGE_READ_BENCHMARKS)[number], backend: StorageBenchmarkBackend) =>
  ({ bench }: BenchContext) =>
    Effect.runPromise(seededRead(backend)).then(({ dataset, fixture }) =>
      bench(backend, () => Effect.runPromise(awaited(scenario.run(fixture.storage, dataset)))).run(
        READ_OPTIONS,
      ),
    );

const writeBench =
  (scenario: (typeof STORAGE_WRITE_BENCHMARKS)[number], backend: StorageBenchmarkBackend) =>
  ({ bench }: BenchContext) =>
    Effect.runPromise(writePools).then((pools) => {
      const pool = pools.get(`${scenario.name}:${backend}`) ?? [];
      return bench(backend, () =>
        Effect.runPromise(
          Effect.suspend(() => awaited(scenario.run(nextWriteFixture(pool).storage))),
        ),
      ).run(WRITE_OPTIONS);
    });

const reopenBench =
  (index: number) =>
  ({ bench }: BenchContext) =>
    Effect.runPromise(reopenFixtures).then((reopenable) => {
      const fixture = reopenable[index];
      if (fixture === undefined) throw new Error("Missing reopen fixture");
      return bench(fixture.backend, () =>
        Effect.runPromise(
          Effect.suspend(() =>
            reopenAndRead(fixture.backend, nextReopenSample(fixture), fixture.firstEntryId),
          ).pipe(Effect.map((result) => reopenedStorages.push(result.storage))),
        ),
      ).run(REOPEN_OPTIONS);
    });

for (const scenario of STORAGE_READ_BENCHMARKS) {
  describe(scenario.name, () => {
    for (const backend of STORAGE_BENCHMARK_BACKENDS) test(backend, readBench(scenario, backend));
  });
}

for (const scenario of STORAGE_WRITE_BENCHMARKS) {
  describe(scenario.name, () => {
    for (const backend of STORAGE_BENCHMARK_BACKENDS) test(backend, writeBench(scenario, backend));
  });
}

describe("reopen and first exact read", () => {
  for (const [index, backend] of PERSISTENT_BACKENDS.entries()) test(backend, reopenBench(index));
});

afterAll(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const storage of reopenedStorages) yield* awaited(storage.close(BACKGROUND_CONTEXT));
      for (const fixture of fixtures) yield* awaited(fixture.storage.close(BACKGROUND_CONTEXT));
      yield* removeDirs(directories);
    }),
  ),
);
