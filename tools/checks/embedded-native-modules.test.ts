import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { expect, it } from "vite-plus/test";

const EMBEDDED_NATIVE_MODULES = [
  "apps",
  "coding-agent",
  "src",
  "bun",
  "embedded-native-modules.ts",
];
const NATIVE_DIR = ["libs", "tui", "native"];
const IMPORT_PATTERN =
  /import (\w+) from "@msa\/tui\/(native\/[^"]+\.node)" with \{ type: "file" \};/gu;
const REGISTRATION_PATTERN = /"(native\/[^"]+\.node)": (\w+),/gu;

const prebuildsOnDisk = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..", ...NATIVE_DIR);
  const found: string[] = [];
  for (const platform of yield* fs.readDirectory(root)) {
    const prebuilds = path.join(root, platform, "prebuilds");
    const isPlatformDir = (yield* fs.stat(path.join(root, platform))).type === "Directory";
    if (!isPlatformDir || !(yield* fs.exists(prebuilds))) continue;
    for (const target of yield* fs.readDirectory(prebuilds)) {
      for (const file of yield* fs.readDirectory(path.join(prebuilds, target))) {
        if (file.endsWith(".node")) found.push(`native/${platform}/prebuilds/${target}/${file}`);
      }
    }
  }
  return found.toSorted();
});

const embedded = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = yield* fs.readFileString(
    path.resolve(import.meta.dirname, "../..", ...EMBEDDED_NATIVE_MODULES),
  );
  const imported = new Map(
    [...source.matchAll(IMPORT_PATTERN)].map(([, name, file]) => [name, file] as const),
  );
  const registered = [...source.matchAll(REGISTRATION_PATTERN)].map(
    ([, key, name]) => [key, imported.get(name ?? "")] as const,
  );
  return {
    imported: [...imported.values()].toSorted(),
    mismatched: registered.filter(([key, file]) => key !== file),
    registered: registered.map(([key]) => key).toSorted(),
  };
});

const runtime = ManagedRuntime.make(NodeServices.layer);

it("embeds every native prebuild into the binary and registers it under its own path", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const onDisk = yield* prebuildsOnDisk;
      const { imported, mismatched, registered } = yield* embedded;
      expect(onDisk.length).toBeGreaterThan(0);
      expect(imported).toEqual(onDisk);
      expect(registered).toEqual(onDisk);
      expect(mismatched).toEqual([]);
    }),
  ));
