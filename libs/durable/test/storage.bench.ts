import { strictEqual } from "node:assert/strict";
import { copyFile, cp } from "node:fs/promises";

import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import {
  STORAGE_READ_BENCHMARKS,
  STORAGE_WRITE_BENCHMARKS,
  seedStorageBenchmark,
  seedStorageWriteBenchmark,
} from "@msa/durable/testing";
import { afterAll, describe, test } from "vite-plus/test";

import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import type { EntryId, Storage } from "../src/types.ts";
import { removeDir, makeTempFile } from "./temp-support.ts";

const STORAGE_BENCHMARK_BACKENDS = ["memory", "sqlite", "jsonl"] as const;
type StorageBenchmarkBackend = (typeof STORAGE_BENCHMARK_BACKENDS)[number];

const READ_OPTIONS = { time: 300, iterations: 10, warmupTime: 75, warmupIterations: 3 } as const;
const WRITE_OPTIONS = { time: 0, iterations: 20, warmupTime: 0, warmupIterations: 5 } as const;
const REOPEN_OPTIONS = { time: 0, iterations: 20, warmupTime: 0, warmupIterations: 3 } as const;

type Fixture = {
  readonly backend: StorageBenchmarkBackend;
  readonly storage: Storage;
};

const fixtures: Fixture[] = [];
const directories: string[] = [];

// A fresh storage location for `backend` in a temporary directory removed after the benchmarks.
async function storagePath(backend: "sqlite" | "jsonl", prefix: string): Promise<string> {
  const name = backend === "sqlite" ? "storage.sqlite" : "storage";
  const { directory, path } = await makeTempFile(prefix, name);
  directories.push(directory);
  return path;
}

async function createFixture(backend: StorageBenchmarkBackend): Promise<Fixture> {
  if (backend === "memory") {
    const fixture = { backend, storage: new MemoryStorage() } satisfies Fixture;
    fixtures.push(fixture);
    return fixture;
  }
  const path = await storagePath(backend, "msa-durable-benchmark-");
  if (backend === "sqlite") {
    const fixture = { backend, storage: await openNodeSqliteStorage(path) } satisfies Fixture;
    fixtures.push(fixture);
    return fixture;
  }
  const fixture = {
    backend,
    storage: await openNodeJsonlStorage(path, BACKGROUND_CONTEXT),
  } satisfies Fixture;
  fixtures.push(fixture);
  return fixture;
}

const readFixtures = await Promise.all(STORAGE_BENCHMARK_BACKENDS.map(createFixture));
const reads = await Promise.all(
  readFixtures.map(async (fixture) => ({
    fixture,
    dataset: await seedStorageBenchmark(fixture.storage),
  })),
);
for await (const { fixture, dataset } of reads) {
  for await (const scenario of STORAGE_READ_BENCHMARKS) {
    strictEqual(await scenario.run(fixture.storage, dataset), scenario.expected(dataset));
  }
}

for (const scenario of STORAGE_READ_BENCHMARKS) {
  describe(scenario.name, () => {
    for (const { fixture, dataset } of reads) {
      test(fixture.backend, async ({ bench }) => {
        await bench(fixture.backend, async () => {
          await scenario.run(fixture.storage, dataset);
        }).run(READ_OPTIONS);
      });
    }
  });
}

async function createWriteFixture(backend: StorageBenchmarkBackend): Promise<Fixture> {
  const fixture = await createFixture(backend);
  await seedStorageWriteBenchmark(fixture.storage);
  return fixture;
}

const writePools = new Map<string, Fixture[]>();
for await (const scenario of STORAGE_WRITE_BENCHMARKS) {
  for await (const backend of STORAGE_BENCHMARK_BACKENDS) {
    const validation = await createWriteFixture(backend);
    strictEqual(await scenario.run(validation.storage), scenario.expected);
    const pool = await Promise.all(
      Array.from({ length: WRITE_OPTIONS.iterations + WRITE_OPTIONS.warmupIterations }, () =>
        createWriteFixture(backend),
      ),
    );
    writePools.set(`${scenario.name}:${backend}`, pool);
  }
  describe(scenario.name, () => {
    for (const backend of STORAGE_BENCHMARK_BACKENDS) {
      const pool = writePools.get(`${scenario.name}:${backend}`)!;
      test(backend, async ({ bench }) => {
        await bench(backend, async () => {
          const fixture = pool.shift();
          if (fixture === undefined) throw new Error("Write benchmark fixture pool was exhausted");
          await scenario.run(fixture.storage);
        }).run(WRITE_OPTIONS);
      });
    }
  });
}

type PersistentBackend = Exclude<StorageBenchmarkBackend, "memory">;
type ReopenFixture = {
  readonly backend: PersistentBackend;
  readonly path: string;
  readonly firstEntryId: EntryId;
  readonly samples: string[];
};

function openPersistentStorage(backend: PersistentBackend, path: string): Promise<Storage> {
  return Promise.resolve(
    backend === "sqlite"
      ? openNodeSqliteStorage(path)
      : openNodeJsonlStorage(path, BACKGROUND_CONTEXT),
  );
}

async function copyPersistentStorage(
  backend: PersistentBackend,
  source: string,
  destination: string,
): Promise<void> {
  if (backend === "sqlite") await copyFile(source, destination);
  else await cp(source, destination, { recursive: true });
}

const reopenFixtures: ReopenFixture[] = [];
for await (const backend of STORAGE_BENCHMARK_BACKENDS) {
  if (backend === "memory") continue;
  const seedPath = await storagePath(backend, `msa-durable-${backend}-reopen-benchmark-`);
  const seed = await openPersistentStorage(backend, seedPath);
  const dataset = await seedStorageBenchmark(seed);
  await seed.close(BACKGROUND_CONTEXT);
  const samples = await Promise.all(
    Array.from(
      { length: REOPEN_OPTIONS.iterations + REOPEN_OPTIONS.warmupIterations },
      async () => {
        const path = await storagePath(backend, `msa-durable-${backend}-reopen-sample-`);
        await copyPersistentStorage(backend, seedPath, path);
        return path;
      },
    ),
  );
  reopenFixtures.push({ backend, path: seedPath, firstEntryId: dataset.firstEntryId, samples });
}

const reopenedStorages: Storage[] = [];
async function reopenAndRead(
  backend: PersistentBackend,
  path: string,
  firstEntryId: EntryId,
): Promise<{ readonly id: number; readonly storage: Storage }> {
  const storage = await openPersistentStorage(backend, path);
  const id = (await storage.entry(firstEntryId, BACKGROUND_CONTEXT))?.entry.id ?? -1;
  return { id, storage };
}

for await (const fixture of reopenFixtures) {
  const reopenValidation = await reopenAndRead(fixture.backend, fixture.path, fixture.firstEntryId);
  strictEqual(reopenValidation.id, fixture.firstEntryId);
  await reopenValidation.storage.close(BACKGROUND_CONTEXT);
}

describe("reopen and first exact read", () => {
  for (const fixture of reopenFixtures) {
    test(fixture.backend, async ({ bench }) => {
      await bench(fixture.backend, async () => {
        const path = fixture.samples.shift();
        if (path === undefined) throw new Error("Reopen benchmark fixture pool was exhausted");
        const result = await reopenAndRead(fixture.backend, path, fixture.firstEntryId);
        reopenedStorages.push(result.storage);
      }).run(REOPEN_OPTIONS);
    });
  }
});

afterAll(async () => {
  for await (const storage of reopenedStorages) await storage.close(BACKGROUND_CONTEXT);
  for await (const fixture of fixtures) await fixture.storage.close(BACKGROUND_CONTEXT);
  for await (const directory of directories) await removeDir(directory);
});
