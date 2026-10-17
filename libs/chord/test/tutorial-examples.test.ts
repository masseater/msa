import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { it } from "vite-plus/test";

const tutorial = readFileSync(new URL("../docs/tutorial.md", import.meta.url), "utf8");
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
const runnable = ` ${normalize(
  readFileSync(new URL("tutorial.test.ts", import.meta.url), "utf8"),
)} `;
it("every TypeScript example in the tutorial is tracked under its own name", () => {
  assert.equal(new Set(printed.map((entry) => entry[1])).size, printed.length);
  assert.equal((tutorial.match(/```ts\n/gu) ?? []).length, printed.length);
});

for (const [, name, code] of printed) {
  it(`tutorial example ${name} is printed from runnable source`, () => {
    assert.equal(runnable.split(` ${normalize(code ?? "")} `).length - 1, 1);
  });
}
