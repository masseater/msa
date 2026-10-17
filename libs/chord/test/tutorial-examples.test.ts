import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { it } from "vite-plus/test";

import { readText } from "./fixtures/platform.ts";

const readSibling = (path: string): Promise<string> =>
  Effect.runPromise(readText(fileURLToPath(new URL(path, import.meta.url))));

const tutorial = await readSibling("../docs/tutorial.md");
const printed = [...tutorial.matchAll(/<!-- example:([\w-]+) -->\n+```ts\n([\s\S]*?)\n```/gu)];
function normalize(text: string): string {
  const tokens = (
    text.match(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\w+|\S/gu,
    ) ?? []
  ).filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
  const closers = new Set([")", "]", "}"]);
  return tokens
    .filter((token, index) => !(token === "," && closers.has(tokens[index + 1] ?? "")))
    .join(" ");
}
const sources = ["fixtures/tutorial.ts", "tutorial.test.ts", "tutorial-2.test.ts"];
const runnable = ` ${(await Promise.all(sources.map(readSibling))).map(normalize).join(" ")} `;
it("every TypeScript example in the tutorial is tracked under its own name", () => {
  assert.equal(new Set(printed.map((entry) => entry[1])).size, printed.length);
  assert.equal((tutorial.match(/```ts\n/gu) ?? []).length, printed.length);
});

for (const [, name, code] of printed) {
  it(`tutorial example ${name} is printed from runnable source`, () => {
    assert.equal(runnable.split(` ${normalize(code ?? "")} `).length - 1, 1);
  });
}
