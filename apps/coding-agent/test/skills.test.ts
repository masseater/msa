import testing from "@msa/testing";
import { Array as Arr, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import skillsSupport from "./skills-support.ts";

const { fixturesDir, loadedFrom } = skillsSupport;

const { joinPath, runTest } = testing;

interface Expected {
  readonly skills: number;
  readonly name?: string;
  readonly description?: string;
  readonly descriptionIncludes?: readonly string[];
  readonly disableModelInvocation?: boolean;
  readonly source?: string;
  readonly diagnosticCount?: number;
  readonly diagnostic?: Readonly<{ includes: string; present: boolean }>;
}

const FIXTURES: readonly (readonly [string, string, Expected])[] = [
  [
    "should load a valid skill",
    "valid-skill",
    {
      description: "A valid skill for testing purposes.",
      diagnosticCount: 0,
      disableModelInvocation: false,
      name: "valid-skill",
      skills: 1,
      source: "test",
    },
  ],
  [
    "should allow names that don't match parent directory",
    "name-mismatch",
    {
      diagnostic: { includes: "does not match parent directory", present: false },
      name: "different-name",
      skills: 1,
    },
  ],
  [
    "should warn when name contains invalid characters",
    "invalid-name-chars",
    { diagnostic: { includes: "invalid characters", present: true }, skills: 1 },
  ],
  [
    "should warn when name exceeds 64 characters",
    "long-name",
    { diagnostic: { includes: "exceeds 64 characters", present: true }, skills: 1 },
  ],
  [
    "should warn and skip skill when description is missing",
    "missing-description",
    { diagnostic: { includes: "description is required", present: true }, skills: 0 },
  ],
  ["should ignore unknown frontmatter fields", "unknown-field", { diagnosticCount: 0, skills: 1 }],
  [
    "should load nested skills recursively",
    "nested",
    { diagnosticCount: 0, name: "child-skill", skills: 1 },
  ],
  [
    "should prefer a directory's root SKILL.md over nested SKILL.md files",
    "root-skill-preferred",
    {
      description: "Root skill should win.",
      diagnosticCount: 0,
      name: "root-skill-preferred",
      skills: 1,
    },
  ],
  [
    "should skip files without frontmatter",
    "no-frontmatter",
    { diagnostic: { includes: "description is required", present: true }, skills: 0 },
  ],
  [
    "should warn and skip skill when YAML frontmatter is invalid",
    "invalid-yaml",
    { diagnostic: { includes: "at line", present: true }, skills: 0 },
  ],
  [
    "should preserve multiline descriptions from YAML",
    "multiline-description",
    {
      descriptionIncludes: ["\n", "This is a multiline description."],
      diagnosticCount: 0,
      skills: 1,
    },
  ],
  [
    "should warn when name contains consecutive hyphens",
    "consecutive-hyphens",
    { diagnostic: { includes: "consecutive hyphens", present: true }, skills: 1 },
  ],
  [
    "should use parent directory name when name not in frontmatter",
    "valid-skill",
    { name: "valid-skill", skills: 1 },
  ],
  [
    "should parse disable-model-invocation frontmatter field",
    "disable-model-invocation",
    {
      diagnostic: { includes: "unknown frontmatter field", present: false },
      disableModelInvocation: true,
      name: "disable-model-invocation",
      skills: 1,
    },
  ],
];

const loadsAs = (fixture: string, expected: Expected) =>
  Effect.gen(function* () {
    const { skills, diagnostics } = yield* loadedFrom(joinPath(fixturesDir, fixture));
    const [skill] = skills;
    expect(skills).toHaveLength(expected.skills);
    if (expected.name !== undefined) {
      expect(skill?.name).toBe(expected.name);
    }
    if (expected.description !== undefined) {
      expect(skill?.description).toBe(expected.description);
    }
    Arr.forEach(expected.descriptionIncludes ?? [], (part) => {
      expect(skill?.description).toContain(part);
    });
    if (expected.disableModelInvocation !== undefined) {
      expect(skill?.disableModelInvocation).toBe(expected.disableModelInvocation);
    }
    if (expected.source !== undefined) {
      expect(skill?.sourceInfo.source).toBe(expected.source);
    }
    if (expected.diagnosticCount !== undefined) {
      expect(diagnostics).toHaveLength(expected.diagnosticCount);
    }
    if (expected.diagnostic !== undefined) {
      const { includes, present } = expected.diagnostic;
      expect(Arr.some(diagnostics, ({ message }) => message.includes(includes))).toBe(present);
    }
  });

describe("skills", () => {
  describe("loadSkillsFromDir", () => {
    Arr.forEach(FIXTURES, ([name, fixture, expected]) => {
      it(name, () => runTest(loadsAs(fixture, expected)));
    });
  });
});
