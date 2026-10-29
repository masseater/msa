import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import hostModule from "./host.ts";
import toolStatsCharts from "./tool-stats-charts.ts";
import type toolStatsReportTypes from "./tool-stats-report.types.ts";

const { Host } = hostModule;
const { escapeHtml, selectedHistograms, selectionCss, table, totalsChart } = toolStatsCharts;

const STYLESHEETS = ["@picocss/pico/css/pico.min.css", "charts.css/dist/charts.min.css"] as const;

const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'";

const REPORT_CSS = `
.charts-css { --color: #60a5fa; font-size: 0.65rem; }
.charts-css :is(td, th) { border-bottom: 0; }
.charts-css .data { white-space: nowrap; }
.charts-css.totals { --labels-size: 9rem; }
.charts-css.totals tbody tr { height: 1.4rem; }
.charts-css.histogram { --aspect-ratio: 5 / 2; --labels-size: 1.5rem; margin-block-start: 1.5rem; }
.charts-css.histogram th { white-space: nowrap; font-size: 0.55rem; }
.charts-css.mini { --aspect-ratio: 8 / 1; width: 10rem; }
.charts-css.mini .tooltip { display: none; }
table.striped { font-size: 0.85rem; }
.selected { display: none; }
.number { text-align: right; }
.axis { font-size: 0.75rem; color: var(--pico-muted-color); }
label:has(> input[type="radio"]) { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; }
label:has(> input[type="radio"]) > input { flex-shrink: 0; margin: 0; border-color: var(--pico-muted-color); }
.name { font-family: var(--pico-font-family-monospace); max-width: 22rem; white-space: normal; overflow-wrap: break-word; }
td { vertical-align: middle; }
`;

const head = (css: string): string => `<!doctype html>
<html lang="en" data-theme="dark">
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
	<title>msa Tool Stats</title>
	<style>${css}</style>
</head>`;

const markup = (data: toolStatsReportTypes.ReportData): string => `<body>
	<main class="container">
		<h1>msa Tool Stats</h1>
		<p>${data.files} session files from <code>${escapeHtml(data.sessionsDir)}</code>. Generated ${escapeHtml(data.generatedAt)}.</p>
		<div class="grid">
			<article><h2>Estimated result tokens by tool</h2>${totalsChart(data.tools, (row) => row.estimatedTokens, "estimated tokens")}</article>
			<article><h2>Tool calls</h2>${totalsChart(data.tools, (row) => row.calls, "calls")}</article>
		</div>
		<div class="grid">
			<article><h2>Tool result token histogram</h2>${selectedHistograms("tool", data.tools, data.bucketLabels)}</article>
			<article><h2>Bash result token histogram</h2>${selectedHistograms("bash", data.bashCommands, data.bucketLabels)}</article>
		</div>
		<article><h2>Tools</h2>${table("tool", data.tools, data.bucketLabels)}</article>
		<article><h2>Bash common commands (best effort)</h2>${table("bash", data.bashCommands, data.bucketLabels)}</article>
	</main>
</body>
</html>`;

const renderReport = (data: toolStatsReportTypes.ReportData) =>
  Effect.gen(function* () {
    const host = yield* Host;
    const libraries = yield* Effect.forEach(STYLESHEETS, (sheet) =>
      host.readText(fileURLToPath(import.meta.resolve(sheet))),
    );
    const css = [
      ...libraries,
      REPORT_CSS,
      selectionCss("tool", data.tools),
      selectionCss("bash", data.bashCommands),
    ].join("\n");
    return `${head(css)}\n${markup(data)}\n`;
  });

const toolStatsReport = {
  renderReport,
};

export default toolStatsReport;
