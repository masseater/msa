import { readFileSync } from "fs";

import { describe, expect, it } from "vite-plus/test";

describe("export HTML markdown link sanitization", () => {
  const templateJs = readFileSync(
    new URL("../src/core/export-html/template.js", import.meta.url),
    "utf-8",
  );

  it("overrides the marked link renderer to use scheme allow-list sanitization", () => {
    expect(templateJs).toMatch(/link\s*\(\s*token\s*\)/u);
    expect(templateJs).toMatch(/sanitizeMarkdownUrl\(token\.href\)/u);
    expect(templateJs).toMatch(/\^\(https\?\|mailto\|tel\|ftp\)/u);
  });

  it("overrides the marked image renderer to use scheme allow-list sanitization", () => {
    expect(templateJs).toMatch(/image\s*\(\s*token\s*\)/u);
    expect(templateJs).toMatch(/sanitizeMarkdownUrl\(token\.href\)/u);
  });

  it("strips C0 controls before checking and emitting markdown URLs", () => {
    expect(templateJs).toContain("replace(/[\\x00-\\x1f\\x7f]/g, '')");
    expect(templateJs).not.toMatch(/\^\\s\*\(javascript\|vbscript\|data\):/iu);
  });

  it("escapes href attributes in the custom link renderer", () => {
    expect(templateJs).toMatch(/escapeHtml\(href\)/u);
  });

  it("escapes image mimeType attributes", () => {
    expect(templateJs).not.toMatch(/\$\{img\.mimeType\}/u);
    expect(templateJs).toMatch(/escapeHtml\(img\.mimeType/u);
  });

  it("escapes image data attributes", () => {
    expect(templateJs).not.toMatch(/;base64,\$\{img\.data\}"/u);
    expect(templateJs).toMatch(/;base64,\$\{escapeHtml\(img\.data \|\| (?:''|"")\)\}"/u);
  });

  it("escapes entry IDs before inserting them into attributes", () => {
    expect(templateJs).not.toMatch(/id="\$\{entryId\}"/u);
    expect(templateJs).not.toMatch(/data-entry-id="\$\{entryId\}"/u);
    expect(templateJs).toMatch(/entry-\$\{escapeHtml\(entry\.id\)\}/u);
    expect(templateJs).toMatch(/data-entry-id="\$\{escapeHtml\(entryId\)\}"/u);
  });

  it("escapes tree metadata rendered from session fields", () => {
    expect(templateJs).not.toMatch(/\[\$\{msg\.toolName \|\| 'tool'\}\]/u);
    expect(templateJs).not.toMatch(/\[\$\{msg\.role\}\]/u);
    expect(templateJs).not.toMatch(/\[model: \$\{entry\.modelId\}\]/u);
    expect(templateJs).not.toMatch(/\[thinking: \$\{entry\.thinkingLevel\}\]/u);
    expect(templateJs).not.toMatch(/\[\$\{entry\.type\}\]/u);
    expect(templateJs).toMatch(/\$\{escapeHtml\(msg\.toolName \|\| 'tool'\)\}/u);
    expect(templateJs).toMatch(/\$\{escapeHtml\(msg\.role\)\}/u);
    expect(templateJs).toMatch(/\$\{escapeHtml\(entry\.modelId\)\}/u);
    expect(templateJs).toMatch(/\$\{escapeHtml\(entry\.thinkingLevel\)\}/u);
    expect(templateJs).toMatch(/\$\{escapeHtml\(entry\.type\)\}/u);
  });

  it("escapes model names in the exported header", () => {
    expect(templateJs).not.toMatch(/\$\{globalStats\.models\.join\(', '\) \|\| 'unknown'\}/u);
    expect(templateJs).toMatch(
      /\$\{escapeHtml\(globalStats\.models\.join\(', '\) \|\| 'unknown'\)\}/u,
    );
  });
});
