import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../../../src/core/default-resource-loader.ts";

const { joinPath, toJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

let tempDir: string;

let agentDir: string;

let cwd: string;

function createPackageWithSkill(name: string, description: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const pkgDir = joinPath(tempDir, `fake-package-${name}`);
      const skillDir = joinPath(pkgDir, "skills", name);
      yield* fs.makeDirectory(skillDir, { recursive: true });
      yield* fs.writeFileString(
        joinPath(pkgDir, "package.json"),
        yield* toJsonText({
          msa: { skills: [`skills/${name}`] },
          name: `fake-pkg-${name}`,
          version: "1.0.0",
        }),
      );
      yield* fs.writeFileString(
        joinPath(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\nPackage skill content`,
      );
      return pkgDir;
    }),
  );
}

function createUserSkill(name: string, description: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const skillDir = joinPath(agentDir, "skills", name);
      yield* fs.makeDirectory(skillDir, { recursive: true });
      const skillPath = joinPath(skillDir, "SKILL.md");
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
      const skillDir = joinPath(cwd, ".msa", "skills", name);
      yield* fs.makeDirectory(skillDir, { recursive: true });
      const skillPath = joinPath(skillDir, "SKILL.md");
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
      const settingsDir = scope === "user" ? agentDir : joinPath(cwd, ".msa");
      yield* fs.makeDirectory(settingsDir, { recursive: true });
      yield* fs.writeFileString(
        joinPath(settingsDir, "settings.json"),
        yield* toJsonText({ packages: [pkgDir] }),
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
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

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* Effect.promise(() => loader.reload());

  const { diagnostics } = loader.getSkills();
  const collision = diagnostics.find(
    (d) => d.type === "collision" && d.collision?.name === "web-fetch",
  );
  expect(collision).toBeDefined();
  expect(collision!.collision!.loserPath).toContain("fake-package");
});

const userAutoDiscoveredSkillShouldOverridePackage = () =>
  Effect.runPromise(userAutoDiscoveredSkillShouldOverride);

const projectAutoDiscoveredSkillShouldOverridePackage = () =>
  Effect.runPromise(projectAutoDiscoveredSkillShouldOverride);

const projectSkillShouldOverrideUserSkillWhich = () =>
  Effect.runPromise(projectSkillShouldOverrideUserSkill);

const collisionDiagnosticsShouldReportPackageSkillAs = () =>
  Effect.runPromise(collisionDiagnosticsShouldReportPackageSkill);

const beforeEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      tempDir = yield* fs.makeTempDirectory({ prefix: `msa-2781-` });
      agentDir = joinPath(tempDir, "agent");
      cwd = joinPath(tempDir, "project");
      yield* fs.makeDirectory(agentDir, { recursive: true });
      yield* fs.makeDirectory(cwd, { recursive: true });
    }),
  );

describe("issue #2781 skill collision precedence: user skills should override package skills", () => {
  beforeEach(beforeEachHook);
  afterEach(() => runtime.runPromise(fs.remove(tempDir, { force: true, recursive: true })));
  it(
    "user auto-discovered skill should override package skill with same name",
    userAutoDiscoveredSkillShouldOverridePackage,
  );
  it(
    "project auto-discovered skill should override package skill with same name",
    projectAutoDiscoveredSkillShouldOverridePackage,
  );
  it(
    "project skill should override user skill which should override package skill",
    projectSkillShouldOverrideUserSkillWhich,
  );
  it(
    "collision diagnostics should report package skill as loser when user skill wins",
    collisionDiagnosticsShouldReportPackageSkillAs,
  );
});
