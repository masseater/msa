import htmlModule from "../apps/coding-agent/src/utils/html.ts";
import type toolStatsReportTypes from "./tool-stats-report.types.ts";

const { escapeXml: escapeHtml } = htmlModule;

type Row = toolStatsReportTypes.HistogramRow;

const fmt = (value: number): string => Math.round(value).toLocaleString("en-US");

const shortLabel = (label: string): string => label.replaceAll(/000(?!\d)/gu, "k");

const ratio = (value: number, max: number): string => (max <= 0 ? "0" : (value / max).toFixed(4));

const dataCell = (value: number, max: number, tooltip: string): string =>
  `<td style="--size: ${ratio(value, max)}"><span class="data">${fmt(value)}</span><span class="tooltip">${escapeHtml(tooltip)}</span></td>`;

const LABEL_HEADROOM = 1.25;

const totalsChart = (
  rows: ReadonlyArray<Row>,
  value: (row: Row) => number,
  unit: string,
): string => {
  const max = Math.max(0, ...rows.map(value)) * LABEL_HEADROOM;
  const body = rows
    .map(
      (row) =>
        `<tr><th scope="row">${escapeHtml(row.name)}</th>${dataCell(value(row), max, `${row.name}: ${fmt(value(row))} ${unit}`)}</tr>`,
    )
    .join("");
  return `<table class="charts-css bar show-labels data-outside data-spacing-2 totals"><tbody>${body}</tbody></table>`;
};

const histogramChart = (
  row: Row,
  labels: ReadonlyArray<string>,
  className: string,
  showLabels: boolean,
): string => {
  const max = Math.max(0, ...row.histogram);
  const body = row.histogram
    .map(
      (count, index) =>
        `<tr>${showLabels ? `<th scope="row">${escapeHtml(shortLabel(labels[index] ?? ""))}</th>` : ""}${dataCell(count, max, `${labels[index] ?? ""} tokens: ${fmt(count)} results`)}</tr>`,
    )
    .join("");
  const options = showLabels ? "show-labels show-primary-axis data-outside" : "hide-data";
  return `<table class="charts-css column ${options} data-spacing-1 ${className}"><tbody>${body}</tbody></table>`;
};

const resultsOf = (row: Row): number => row.results ?? row.samples.length;

const summary = (row: Row): string =>
  `${fmt(row.calls)} calls, ${fmt(resultsOf(row))} results, ${fmt(row.estimatedTokens)} estimated result tokens, ${fmt(row.avg)} avg/result`;

const selectedHistograms = (
  group: string,
  rows: ReadonlyArray<Row>,
  labels: ReadonlyArray<string>,
): string =>
  rows.length === 0
    ? "<p>No data</p>"
    : rows
        .map(
          (row, index) =>
            `<div class="selected" data-group="${group}" data-row="${index}"><p class="summary">${escapeHtml(row.name)}: ${summary(row)}</p>${histogramChart(row, labels, "histogram", true)}<p class="axis">estimated tokens/result → result count</p></div>`,
        )
        .join("");

const tableRow = (group: string, labels: ReadonlyArray<string>) => (row: Row, index: number) =>
  `<tr><td><label><input type="radio" name="${group}" id="${group}-${index}"${index === 0 ? " checked" : ""}> <span class="name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span></label></td><td class="number">${fmt(row.calls)}</td><td class="number">${fmt(resultsOf(row))}</td><td class="number">${fmt(row.estimatedTokens)}</td><td class="number">${fmt(row.avg)}</td><td>${histogramChart(row, labels, "mini", false)}</td></tr>`;

const table = (group: string, rows: ReadonlyArray<Row>, labels: ReadonlyArray<string>): string =>
  `<div class="overflow-auto"><table class="striped"><thead><tr><th>Name</th><th class="number">Calls</th><th class="number">Results</th><th class="number">Est. tokens</th><th class="number">Avg/result</th><th>Histogram</th></tr></thead><tbody>${rows.map(tableRow(group, labels)).join("")}</tbody></table></div>`;

const selectionCss = (group: string, rows: ReadonlyArray<Row>): string =>
  rows
    .map(
      (_row, index) =>
        `body:has(#${group}-${index}:checked) .selected[data-group="${group}"][data-row="${index}"] { display: block; }`,
    )
    .join("\n");

const toolStatsCharts = {
  escapeHtml,
  selectedHistograms,
  selectionCss,
  table,
  totalsChart,
};

export default toolStatsCharts;
