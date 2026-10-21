import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import SettingsManager from "../../../src/core/settings-manager.ts";
import frontmatterModule from "../../../src/utils/frontmatter.ts";
import textModule from "../../../src/utils/text.ts";

const { splitBom } = textModule;
const { parseFrontmatter } = frontmatterModule;
const { joinPath, toJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let testDir: string;

const loadsFrontmatterAndSettingsWithA = Effect.gen(function* () {
  expect(splitBom("\uFEFFcontent")).toEqual({ bom: "\uFEFF", text: "content" });
  const document = "---\nname: demo\ndescription: Test\n---\nBody";
  expect(parseFrontmatter(`\uFEFF${document}`)).toEqual({
    body: "Body",
    frontmatter: { description: "Test", name: "demo" },
  });

  const agentDir = joinPath(testDir, "agent");
  const projectDir = joinPath(testDir, "project");
  yield* fs.makeDirectory(joinPath(projectDir, ".msa"), { recursive: true });
  yield* fs.makeDirectory(agentDir, { recursive: true });
  const globalSettingsPath = joinPath(agentDir, "settings.json");
  yield* fs.writeFileString(
    globalSettingsPath,
    `\uFEFF${yield* toJsonText({ defaultModel: "global-model" })}`,
  );
  yield* fs.writeFileString(
    joinPath(projectDir, ".msa", "settings.json"),
    `\uFEFF${yield* toJsonText({ defaultProvider: "project-provider" })}`,
  );

  const settings = yield* Effect.promise(() => SettingsManager.create(projectDir, agentDir));
  expect(settings.models.getDefaultModel()).toBe("global-model");
  expect(settings.models.getDefaultProvider()).toBe("project-provider");

  settings.display.setTheme("dark");
  yield* Effect.promise(() => settings.persistence.flush());
  expect(yield* fs.readFileString(globalSettingsPath)).not.toMatch(/^\uFEFF/u);
});

const loadsFrontmatterAndSettingsWithALeading = () =>
  Effect.runPromise(loadsFrontmatterAndSettingsWithA);

const beforeEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const value = (testDir = yield* fs.makeTempDirectory({ prefix: "msa-8337-" }));
      return value;
    }),
  );

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      if (yield* fs.exists(testDir)) {
        yield* fs.remove(testDir, { force: true, recursive: true });
      }
    }),
  );

describe("issue #8337 UTF-8 BOM parsing", () => {
  beforeEach(beforeEachHook);
  afterEach(afterEachHook);
  it("loads frontmatter and settings with a leading BOM", loadsFrontmatterAndSettingsWithALeading);
});
