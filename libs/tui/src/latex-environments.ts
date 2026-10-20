import latexLayout from "./latex-layout.ts";
import type latexParserTypes from "./latex-parser.types.ts";
import utils from "./utils.ts";

const { PROTECTED_SPACE } = latexLayout;
const { visibleWidth } = utils;

type MatrixDelimiters = readonly [string, string, string, string, string, string];

const CONDITION_WORDS = new Set(["if", "when", "for", "otherwise"]);
const EQUATION_ENVIRONMENTS = new Set(["equation", "equation*", "displaymath"]);
const ALIGNED_ENVIRONMENTS = new Set([
  "aligned",
  "align",
  "align*",
  "alignedat",
  "alignat",
  "alignat*",
  "gather",
  "gathered",
  "multline",
  "multline*",
  "split",
]);
const ALIGNED_AT_ENVIRONMENTS = new Set(["alignedat", "alignat", "alignat*"]);
const MATRIX_ENVIRONMENTS = new Set([
  "array",
  "matrix",
  "smallmatrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
]);
const UNDELIMITED_MATRICES = new Set(["array", "matrix", "smallmatrix"]);
const MATRIX_DELIMITERS: ReadonlyMap<string, MatrixDelimiters> = new Map([
  ["pmatrix", ["⎛", "⎞", "⎜", "⎟", "⎝", "⎠"]],
  ["bmatrix", ["⎡", "⎤", "⎢", "⎥", "⎣", "⎦"]],
  ["Bmatrix", ["⎧", "⎫", "⎨", "⎬", "⎩", "⎭"]],
  ["vmatrix", ["│", "│", "│", "│", "│", "│"]],
  ["Vmatrix", ["║", "║", "║", "║", "║", "║"]],
]);

function splitEnvironmentRows(body: string): string[] {
  return body.split(/\\\\(?:\[[^\]\n]*\])?/u);
}

function renderCells(parser: latexParserTypes.LatexParser, body: string): string[][] {
  return splitEnvironmentRows(body)
    .map((row) => row.split("&").map((cell) => parser.renderNested(cell, false).trim()))
    .filter((row) => row.some(Boolean));
}

function renderAligned(
  parser: latexParserTypes.LatexParser,
  environment: string,
  body: string,
): string {
  const alignedAt = ALIGNED_AT_ENVIRONMENTS.has(environment);
  const alignedBody = alignedAt ? body.replace(/^\s*\{[^}]*\}/u, "") : body;
  return splitEnvironmentRows(alignedBody)
    .map((row) => {
      const cells = row.split("&");
      const source = alignedAt
        ? Array.from({ length: Math.ceil(cells.length / 2) }, (_, index) =>
            cells.slice(index * 2, index * 2 + 2).join(""),
          ).join(" ")
        : cells.join("");
      return parser.renderNested(source).trim();
    })
    .filter(Boolean)
    .join("\n");
}

function caseContent(row: readonly string[], valueWidth: number): string {
  const value = (row[0] ?? "").replace(/,\s*$/u, "");
  const condition = row[1] ?? "";
  if (condition === "") {
    return value;
  }
  const leadingWord = /^\w*/u.exec(condition)?.[0].toLowerCase() ?? "";
  const conditionPrefix = CONDITION_WORDS.has(leadingWord) ? " " : " if ";
  return `${value}${PROTECTED_SPACE.repeat(valueWidth - visibleWidth(value))}${conditionPrefix}${condition}`;
}

function renderCases(parser: latexParserTypes.LatexParser, body: string): string {
  const rows = renderCells(parser, body);
  const valueWidth = Math.max(
    0,
    ...rows.map((row) => visibleWidth((row[0] ?? "").replace(/,\s*$/u, ""))),
  );
  const contents = rows.map((row) => caseContent(row, valueWidth));
  if (contents.length <= 1) {
    return contents.length === 0 ? "" : `⎧ ${contents[0]}`;
  }

  const middle = Math.floor(contents.length / 2);
  const visualRows: Array<string | undefined> = [...contents];
  if (contents.length % 2 === 0) {
    visualRows.splice(middle, 0, undefined);
  }
  const lines = visualRows.map((content, index) => {
    const delimiter = index === 0 ? "⎧" : index === visualRows.length - 1 ? "⎩" : "⎨";
    return content === undefined ? delimiter : `${delimiter} ${content}`;
  });
  return parser.pushLayout({ baseline: middle, lines, type: "matrix" });
}

function alignedMatrixRows(matrix: readonly string[][]): string[] {
  const columnCount = Math.max(0, ...matrix.map((row) => row.length));
  const columnWidths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(0, ...matrix.map((row) => visibleWidth(row[column] ?? ""))),
  );
  return matrix.map((row) =>
    Array.from({ length: columnCount }, (_, column) => {
      const cell = row[column] ?? "";
      return `${cell}${PROTECTED_SPACE.repeat(Math.max(0, (columnWidths[column] ?? 0) - visibleWidth(cell)))}`;
    }).join(" │ "),
  );
}

function delimitedRows(rows: readonly string[], delimiter: MatrixDelimiters): string[] {
  return rows.map((row, index) => {
    const position = index === 0 ? 0 : index === rows.length - 1 ? 4 : 2;
    return `${delimiter[position]} ${row} ${delimiter[position + 1]}`;
  });
}

function renderMatrix(
  parser: latexParserTypes.LatexParser,
  environment: string,
  body: string,
): string {
  const rows = alignedMatrixRows(renderCells(parser, body));
  let lines = rows;
  if (!UNDELIMITED_MATRICES.has(environment)) {
    const delimiter = MATRIX_DELIMITERS.get(environment);
    if (delimiter === undefined) {
      parser.supported = false;
      return rows.join("\n");
    }
    lines = delimitedRows(rows, delimiter);
  }

  if (lines.length <= 1) {
    return lines[0] ?? "";
  }
  return parser.pushLayout({ baseline: 0, lines, type: "matrix" });
}

function renderEnvironment(
  parser: latexParserTypes.LatexParser,
  environment: string,
  body: string,
): string {
  if (EQUATION_ENVIRONMENTS.has(environment)) {
    return parser.renderNested(body).trim();
  }
  if (ALIGNED_ENVIRONMENTS.has(environment)) {
    return renderAligned(parser, environment, body);
  }
  if (environment === "cases" || environment === "cases*") {
    return renderCases(parser, body);
  }
  if (MATRIX_ENVIRONMENTS.has(environment)) {
    const matrixBody = environment === "array" ? body.replace(/^\s*\{[^}]*\}/u, "") : body;
    return renderMatrix(parser, environment, matrixBody);
  }
  parser.supported = false;
  return body;
}

function parseEnvironment(parser: latexParserTypes.LatexParser): string {
  const environment = parser.readRawGroup();
  if (environment === undefined || environment === "") {
    return "";
  }
  const endMarker = `\\end{${environment}}`;
  const end = parser.source.indexOf(endMarker, parser.position);
  if (end < 0) {
    parser.supported = false;
    return "";
  }
  const body = parser.source.slice(parser.position, end);
  parser.position = end + endMarker.length;
  return renderEnvironment(parser, environment, body);
}

const latexEnvironments = {
  parseEnvironment,
};

export default latexEnvironments;
