import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";

const { fuzzyFilter } = tui;

type Model = aiTypes.Model<aiTypes.Api>;

const COLUMNS = [
  ["provider", (m: Model) => m.provider],
  ["model", (m: Model) => m.id],
  ["context", (m: Model) => formatTokenCount(m.contextWindow)],
  ["max-out", (m: Model) => formatTokenCount(m.maxTokens)],
  ["thinking", (m: Model) => (m.reasoning ? "yes" : "no")],
  ["images", (m: Model) => (m.input.includes("image") ? "yes" : "no")],
] as const;

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const thousands = count / 1_000;
    return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
  }
  return count.toString();
}

const matchingModels = (models: readonly Model[], searchPattern: string | undefined): Model[] =>
  (searchPattern === undefined || searchPattern === ""
    ? [...models]
    : fuzzyFilter([...models], searchPattern, (m) => `${m.provider} ${m.id}`)
  ).sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));

function formatModelTable(models: readonly Model[]): string[] {
  const cells = [
    COLUMNS.map(([header]) => header as string),
    ...models.map((model) => COLUMNS.map(([, cell]) => cell(model))),
  ];
  const widths = COLUMNS.map((_, column) =>
    Math.max(...cells.map((row) => row[column]?.length ?? 0)),
  );
  return cells.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  "));
}

const modelTable = { formatModelTable, matchingModels };

export default modelTable;
