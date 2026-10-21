import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

const { readTextFile, runTest } = testing;

const readTemplate = readTextFile(
  fileURLToPath(new URL("../src/core/export-html/template.js", import.meta.url)),
);

const overridesTheMarkedLinkRendererToUse = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/link\s*\(\s*token\s*\)/u);
      expect(templateJs).toMatch(/sanitizeMarkdownUrl\(token\.href\)/u);
      expect(templateJs).toMatch(/\^\(https\?\|mailto\|tel\|ftp\)/u);
    }),
  );

const overridesTheMarkedImageRendererToUse = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/image\s*\(\s*token\s*\)/u);
      expect(templateJs).toMatch(/sanitizeMarkdownUrl\(token\.href\)/u);
    }),
  );

const stripsC0ControlsBeforeCheckingAndEmitting = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toContain("replace(/[\\x00-\\x1f\\x7f]/g, '')");
      expect(templateJs).not.toMatch(/\^\\s\*\(javascript\|vbscript\|data\):/iu);
    }),
  );

const escapesHrefAttributesInTheCustomLink = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).toMatch(/escapeHtml\(href\)/u);
    }),
  );

const escapesImageMimetypeAttributes = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).not.toMatch(/\$\{img\.mimeType\}/u);
      expect(templateJs).toMatch(/escapeHtml\(img\.mimeType/u);
    }),
  );

const escapesImageDataAttributes = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).not.toMatch(/;base64,\$\{img\.data\}"/u);
      expect(templateJs).toMatch(/;base64,\$\{escapeHtml\(img\.data \|\| (?:''|"")\)\}"/u);
    }),
  );

const escapesEntryIdsBeforeInsertingThemInto = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).not.toMatch(/id="\$\{entryId\}"/u);
      expect(templateJs).not.toMatch(/data-entry-id="\$\{entryId\}"/u);
      expect(templateJs).toMatch(/entry-\$\{escapeHtml\(entry\.id\)\}/u);
      expect(templateJs).toMatch(/data-entry-id="\$\{escapeHtml\(entryId\)\}"/u);
    }),
  );

const escapesTreeMetadataRenderedFromSessionFields = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
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
    }),
  );

const escapesModelNamesInTheExportedHeader = () =>
  runTest(
    Effect.gen(function* () {
      const templateJs = yield* readTemplate;
      expect(templateJs).not.toMatch(/\$\{globalStats\.models\.join\(', '\) \|\| 'unknown'\}/u);
      expect(templateJs).toMatch(
        /\$\{escapeHtml\(globalStats\.models\.join\(', '\) \|\| 'unknown'\)\}/u,
      );
    }),
  );

describe("export HTML markdown link sanitization", () => {
  it(
    "overrides the marked link renderer to use scheme allow-list sanitization",
    overridesTheMarkedLinkRendererToUse,
  );

  it(
    "overrides the marked image renderer to use scheme allow-list sanitization",
    overridesTheMarkedImageRendererToUse,
  );

  it(
    "strips C0 controls before checking and emitting markdown URLs",
    stripsC0ControlsBeforeCheckingAndEmitting,
  );

  it("escapes href attributes in the custom link renderer", escapesHrefAttributesInTheCustomLink);

  it("escapes image mimeType attributes", escapesImageMimetypeAttributes);

  it("escapes image data attributes", escapesImageDataAttributes);

  it(
    "escapes entry IDs before inserting them into attributes",
    escapesEntryIdsBeforeInsertingThemInto,
  );

  it(
    "escapes tree metadata rendered from session fields",
    escapesTreeMetadataRenderedFromSessionFields,
  );

  it("escapes model names in the exported header", escapesModelNamesInTheExportedHeader);
});
