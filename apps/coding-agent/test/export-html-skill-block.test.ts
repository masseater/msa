import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

const { readTextFile, runTest } = testing;

const readTemplate = readTextFile(
  fileURLToPath(new URL("../src/core/export-html/template.js", import.meta.url)),
);

const stripsSkillWrapperXmlFromUserMessage = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/parseSkillBlock/u);
      expect(templateJs).toMatch(/skillBlock\.userMessage/u);
    }),
  );

const rendersSkillInvocationAndUserMessageAs = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/skill-invocation/u);
      expect(templateJs).toMatch(/hasUserContent/u);
    }),
  );

const rendersSkillContentAsMarkdownNotRaw = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/safeMarkedParse\(skillBlock\.content\)/u);
    }),
  );

const showsSkillNameAndUserMessageIn = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/tree-role-skill/u);
    }),
  );

describe("export HTML skill block rendering", () => {
  it("strips skill wrapper XML from user message rendering", stripsSkillWrapperXmlFromUserMessage);

  it(
    "renders skill invocation and user message as separate sibling blocks",
    rendersSkillInvocationAndUserMessageAs,
  );

  it("renders skill content as markdown, not raw text", rendersSkillContentAsMarkdownNotRaw);

  it("shows skill name and user message in the sidebar tree", showsSkillNameAndUserMessageIn);
});
