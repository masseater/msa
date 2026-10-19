import { fileURLToPath } from "node:url";

import { readTextFile, runTest } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

describe("export HTML skill block rendering", () => {
  const readTemplate = readTextFile(
    fileURLToPath(new URL("../src/core/export-html/template.js", import.meta.url)),
  );

  it("strips skill wrapper XML from user message rendering", () =>
    runTest(
      Effect.gen(function* () {
        const templateJs = yield* readTemplate;
        expect(templateJs).toMatch(/parseSkillBlock/u);
        expect(templateJs).toMatch(/skillBlock\.userMessage/u);
      }),
    ));

  it("renders skill invocation and user message as separate sibling blocks", () =>
    runTest(
      Effect.gen(function* () {
        const templateJs = yield* readTemplate;
        expect(templateJs).toMatch(/skill-invocation/u);
        expect(templateJs).toMatch(/hasUserContent/u);
      }),
    ));

  it("renders skill content as markdown, not raw text", () =>
    runTest(
      Effect.gen(function* () {
        const templateJs = yield* readTemplate;
        expect(templateJs).toMatch(/safeMarkedParse\(skillBlock\.content\)/u);
      }),
    ));

  it("shows skill name and user message in the sidebar tree", () =>
    runTest(
      Effect.gen(function* () {
        const templateJs = yield* readTemplate;
        expect(templateJs).toMatch(/tree-role-skill/u);
      }),
    ));
});
