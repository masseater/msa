import { readFileSync } from "fs";

import { describe, expect, it } from "vite-plus/test";

describe("export HTML skill block rendering", () => {
  const templateJs = readFileSync(
    new URL("../src/core/export-html/template.js", import.meta.url),
    "utf-8",
  );

  it("strips skill wrapper XML from user message rendering", () => {
    expect(templateJs).toMatch(/parseSkillBlock/u);
    expect(templateJs).toMatch(/skillBlock\.userMessage/u);
  });

  it("renders skill invocation and user message as separate sibling blocks", () => {
    expect(templateJs).toMatch(/skill-invocation/u);

    expect(templateJs).toMatch(/hasUserContent/u);
  });

  it("renders skill content as markdown, not raw text", () => {
    expect(templateJs).toMatch(/safeMarkedParse\(skillBlock\.content\)/u);
  });

  it("shows skill name and user message in the sidebar tree", () => {
    expect(templateJs).toMatch(/tree-role-skill/u);
  });
});
