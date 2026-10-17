import { describe, expect, it } from "vite-plus/test";

import { CodemodeSourceError, parseCodemodeSource } from "../src/source.ts";

function returnsPlainCodeUnchanged(): void {
  expect(parseCodemodeSource("text('hi')")).toEqual({ code: "text('hi')", options: {} });
  expect(parseCodemodeSource("// just a comment\nreturn 1")).toEqual({
    code: "// just a comment\nreturn 1",
    options: {},
  });
}

function parsesTheOptionsLineAndKeeps(): void {
  expect(parseCodemodeSource('// @options: {"timeout_ms": 10}\nconst a = 1;\ntext(a)')).toEqual({
    code: "\nconst a = 1;\ntext(a)",
    options: { timeoutMs: 10 },
  });
  expect(
    parseCodemodeSource('  // @options:{"max_output_tokens":0,"timeout_ms":1500}\r\ntext(1)')
      .options,
  ).toEqual({
    maxOutputTokens: 0,
    timeoutMs: 1500,
  });
  expect(parseCodemodeSource("// @options: {}\ntext(1)")).toEqual({
    code: "\ntext(1)",
    options: {},
  });
}

function onlyTreatsTheFirstLineAs(): void {
  expect(parseCodemodeSource("// @optionsx {}\ntext(1)").options).toEqual({});
  expect(parseCodemodeSource('text("// @options: {}")').options).toEqual({});
}

function rejectsAnOptionsLineThatIs(): void {
  const cases: [string, number][] = [
    ['// count things\n// @options: {"timeout_ms": 1000}\nwhile (true) {}', 2],
    ['\n  // @options: {"timeout_ms": 1000}\nwhile (true) {}', 2],
    ['text(1)\r\n// @options: {"timeout_ms": 1}', 2],
    ['// @options: {"timeout_ms": 1}\ntext(1)\n// @options: {"timeout_ms": 2}', 3],
  ];
  for (const [input, line] of cases) {
    expect(() => parseCodemodeSource(input), input).toThrow(CodemodeSourceError);
    expect(() => parseCodemodeSource(input), input).toThrow(
      `The // @options: line must be the first line of the input; found one on line ${line}`,
    );
  }
}

function rejectsEmptyInputAndInvalidOptions(): void {
  const cases: [string, string | RegExp][] = [
    ["", /Expected JavaScript source text \(non-empty\)/u],
    ["  \n", /Expected JavaScript source text \(non-empty\)/u],
    ["// @options:\ntext(1)", /@options must be a JSON object with supported fields/u],
    ["// @options: {timeout_ms: 1}\ntext(1)", /@options must be valid JSON with supported fields/u],
    ["// @options: [1]\ntext(1)", /@options must be a JSON object with supported fields/u],
    [
      '// @options: {"yield": 1}\ntext(1)',
      "@options only supports `max_output_tokens` and `timeout_ms`; got `yield`",
    ],
    [
      '// @options: {"max_output_tokens": 1.5}\ntext(1)',
      "@options field `max_output_tokens` must be a non-negative safe integer",
    ],
    [
      '// @options: {"timeout_ms": 0}\ntext(1)',
      /@options field `timeout_ms` must be a positive integer/u,
    ],
    [
      '// @options: {"timeout_ms": 1}',
      "The @options line must be followed by JavaScript source on subsequent lines",
    ],
    [
      '// @options: {"timeout_ms": 1}\n  \n',
      "The @options line must be followed by JavaScript source on subsequent lines",
    ],
  ];
  for (const [input, message] of cases) {
    expect(() => parseCodemodeSource(input), input).toThrow(CodemodeSourceError);
    expect(() => parseCodemodeSource(input), input).toThrow(message);
  }
}

describe("parseCodemodeSource", () => {
  it("returns plain code unchanged", returnsPlainCodeUnchanged);

  it("parses the options line and keeps line numbers", parsesTheOptionsLineAndKeeps);

  it("only treats the first line as an options line", onlyTreatsTheFirstLineAs);

  it("rejects an options line that is not the first line", rejectsAnOptionsLineThatIs);

  it("rejects empty input and invalid options", rejectsEmptyInputAndInvalidOptions);
});
