import { expect, it } from "vite-plus/test";

import classSeal from "../src/core/platform/node/class-seal.ts";
import classSealSources from "./class-seal-sources.ts";

const { entries, expectedSealed } = classSealSources;

const loaded = import.meta.glob(
  [
    "../src/**/*.ts",
    "!../src/**/*.d.ts",
    "!../src/cli.ts",
    "!../src/rpc-entry.ts",
    "!../src/bun/cli.ts",
    "!../src/bun/embedded-native-modules.ts",
    "!../src/bun/runtime-setup.ts",
    "!../src/experimental/source-resolver.ts",
    "!../src/utils/image-resize-worker.ts",
    "!../src/extensions/codemode/worker.ts",
  ],
  { eager: true },
);

it("seals every class of src when vitest loads every module", () =>
  expectedSealed().then(({ counts, entryCounts }) => {
    expect(Object.keys(loaded).length).toBeGreaterThan(1000);
    expect(entryCounts).toEqual(Object.fromEntries(entries.map((entry) => [entry, 0])));
    expect(
      Object.fromEntries(
        [...classSeal.sealedModules()].filter(([module]) => module.startsWith("src/")),
      ),
    ).toEqual(counts);
    return undefined;
  }));
