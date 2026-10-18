import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { stringifyJsonPretty } from "../../test-json.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let agentDir: string;

let cwd: string;

function createPackageWithSkill(name: string, description: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const pkgDir = join(tempDir, `fake-package-${name}`);
      const skillDir = join(pkgDir, "skills", name);
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(
        join(pkgDir, "package.json"),
        stringifyJsonPretty({
          name: `fake-pkg-${name}`,
          version: "1.0.0",
          msa: { skills: [`skills/${name}`] },
        }),
      );
      yield* fs.writeFileString(
        join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\nPackage skill content`,
      );
      return pkgDir;
    }),
  );
}

function createUserSkill(name: string, description: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const skillDir = join(agentDir, "skills", name);
      yield* fs.makeDirectory(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      yield* fs.writeFileString(
        skillPath,
        `---\nname: ${name}\ndescription: ${description}\n---\nUser skill content`,
      );
      return skillPath;
    }),
  );
}

function createProjectSkill(name: string, description: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const skillDir = join(cwd, ".msa", "skills", name);
      yield* fs.makeDirectory(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      yield* fs.writeFileString(
        skillPath,
        `---\nname: ${name}\ndescription: ${description}\n---\nProject skill content`,
      );
      return skillPath;
    }),
  );
}

function createSettingsWithPackage(pkgDir: string, scope: "user" | "project") {
  return runtime.runPromise(
    Effect.gen(function* () {
      const settingsDir = scope === "user" ? agentDir : join(cwd, ".msa");
      yield* fs.makeDirectory(settingsDir, { recursive: true });
      yield* fs.writeFileString(
        join(settingsDir, "settings.json"),
        stringifyJsonPretty({ packages: [pkgDir] }),
      );
    }),
  );
}

const userAutoDiscoveredSkillShouldOverride = Effect.gen(function* () {
  const pkgDir = yield* Effect.promise(() =>
    createPackageWithSkill("web-fetch", "Package web-fetch skill"),
  );
  const userSkillPath = yield* Effect.promise(() =>
    createUserSkill("web-fetch", "User web-fetch override"),
  );
  yield* Effect.promise(() => createSettingsWithPackage(pkgDir, "user"));

  const loader = new DefaultResourceLoader({ cwd, agentDir });
  yield* Effect.promise(() => loader.reload());

  const { skills } = loader.getSkills();
  const webFetch = skills.find((s) => s.name === "web-fetch");
  expect(webFetch).toBeDefined();
  expect(webFetch!.filePath).toBe(userSkillPath);
  expect(webFetch!.description).toBe("User web-fetch override");
});

const projectAutoDiscoveredSkillShouldOverride = Effect.gen(function* () {
  const pkgDir = yield* Effect.promise(() =>
    createPackageWithSkill("web-fetch", "Package web-fetch skill"),
  );
  const projectSkillPath = yield* Effect.promise(() =>
    createProjectSkill("web-fetch", "Project web-fetch override"),
  );
  yield* Effect.promise(() => createSettingsWithPackage(pkgDir, "user"));

  const loader = new DefaultResourceLoader({ cwd, agentDir });
  yield* Effect.promise(() => loader.reload());

  const { skills } = loader.getSkills();
  const webFetch = skills.find((s) => s.name === "web-fetch");
  expect(webFetch).toBeDefined();
  expect(webFetch!.filePath).toBe(projectSkillPath);
  expect(webFetch!.description).toBe("Project web-fetch override");
});

const projectSkillShouldOverrideUserSkill = Effect.gen(function* () {
  const pkgDir = yield* Effect.promise(() =>
    createPackageWithSkill("web-fetch", "Package web-fetch skill"),
  );
  yield* Effect.promise(() => createUserSkill("web-fetch", "User web-fetch override"));
  const projectSkillPath = yield* Effect.promise(() =>
    createProjectSkill("web-fetch", "Project web-fetch override"),
  );
  yield* Effect.promise(() => createSettingsWithPackage(pkgDir, "user"));

  const loader = new DefaultResourceLoader({ cwd, agentDir });
  yield* Effect.promise(() => loader.reload());

  const { skills } = loader.getSkills();
  const webFetch = skills.find((s) => s.name === "web-fetch");
  expect(webFetch).toBeDefined();
  expect(webFetch!.filePath).toBe(projectSkillPath);
  expect(webFetch!.description).toBe("Project web-fetch override");
});

const collisionDiagnosticsShouldReportPackageSkill = Effect.gen(function* () {
  const pkgDir = yield* Effect.promise(() =>
    createPackageWithSkill("web-fetch", "Package web-fetch skill"),
  );
  yield* Effect.promise(() => createUserSkill("web-fetch", "User web-fetch override"));
  yield* Effect.promise(() => createSettingsWithPackage(pkgDir, "user"));

  const loader = new DefaultResourceLoader({ cwd, agentDir });
  yield* Effect.promise(() => loader.reload());

  const { diagnostics } = loader.getSkills();
  const collision = diagnostics.find(
    (d) => d.type === "collision" && d.collision?.name === "web-fetch",
  );
  expect(collision).toBeDefined();
  expect(collision!.collision!.loserPath).toContain("fake-package");
});

describe("issue #2781 skill collision precedence: user skills should override package skills", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir = yield* fs.makeTempDirectory({ prefix: `msa-2781-` });
        agentDir = join(tempDir, "agent");
        cwd = join(tempDir, "project");
        yield* fs.makeDirectory(agentDir, { recursive: true });
        yield* fs.makeDirectory(cwd, { recursive: true });
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempDir, { recursive: true, force: true })));
  it("user auto-discovered skill should override package skill with same name", () =>
    Effect.runPromise(userAutoDiscoveredSkillShouldOverride));
  it("project auto-discovered skill should override package skill with same name", () =>
    Effect.runPromise(projectAutoDiscoveredSkillShouldOverride));
  it("project skill should override user skill which should override package skill", () =>
    Effect.runPromise(projectSkillShouldOverrideUserSkill));
  it("collision diagnostics should report package skill as loser when user skill wins", () =>
    Effect.runPromise(collisionDiagnosticsShouldReportPackageSkill));
});
