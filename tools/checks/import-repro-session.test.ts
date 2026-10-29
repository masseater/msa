import { Buffer } from "node:buffer";

import { expect, it } from "vite-plus/test";

import session from "../../.msa/extensions/import-repro/session.ts";

const { ImportReproError, decodeExportedHtml } = session;

const header = { cwd: "/repo", id: "s1", type: "session" };
const base64 = (text: string): string => Buffer.from(text).toString("base64");

const refusalOf = (html: string): unknown => {
  try {
    decodeExportedHtml(html);
  } catch (error) {
    return error;
  }
  return undefined;
};

it("reads the session from the JSONL download link of the current export", () => {
  const html = `<a download href="data:application/x-ndjson;base64,${base64(JSON.stringify(header))}">↓ JSONL</a>`;
  expect(decodeExportedHtml(html).header).toEqual(header);
});

it("refuses the old export with embedded session data by naming it and saying how to re-export", () => {
  const data = base64(JSON.stringify({ entries: [], header }));
  const refusal = refusalOf(
    `<body><script id="session-data" type="application/json">${data}</script></body>`,
  );
  expect(refusal).toBeInstanceOf(ImportReproError);
  expect(refusal).toMatchObject({ message: expect.stringContaining('<script id="session-data">') });
  expect(refusal).toMatchObject({ message: expect.stringContaining("msa --export") });
});

it("refuses HTML without any msa session as not an msa export", () => {
  expect(refusalOf("<body><p>hello</p></body>")).toMatchObject({
    message: "HTML does not contain the msa session JSONL",
  });
});
