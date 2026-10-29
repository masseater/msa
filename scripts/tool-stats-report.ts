import { Effect, Schema } from "effect";

import inlineScriptModule from "./inline-script.ts";
import json from "./json.ts";
import type toolStatsReportTypes from "./tool-stats-report.types.ts";

const { inlineScript } = inlineScriptModule;
const { Json } = json;

const HEAD = `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<title>msa Tool Stats</title>
	<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
	<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js"></script>
</head>`;

const markup = (
  data: toolStatsReportTypes.ReportData,
): string => `<body class="bg-zinc-950 text-zinc-100 p-6">
	<main class="max-w-7xl mx-auto space-y-6">
		<h1 class="text-3xl font-bold">msa Tool Stats</h1>
		<p class="text-zinc-400">${data.files} session files from <code>${data.sessionsDir}</code>. Generated ${data.generatedAt}.</p>
		<section class="grid md:grid-cols-2 gap-6">
			<div class="bg-zinc-900 rounded p-4"><h2 class="font-semibold mb-3">Estimated result tokens by tool</h2><canvas id="tokens"></canvas></div>
			<div class="bg-zinc-900 rounded p-4"><h2 class="font-semibold mb-3">Tool calls</h2><canvas id="calls"></canvas></div>
		</section>
		<section class="grid md:grid-cols-2 gap-6">
			<div class="bg-zinc-900 rounded p-4">
				<div class="flex items-center justify-between gap-4 mb-3">
					<h2 class="font-semibold">Tool result token histogram</h2>
					<select id="toolSelect" class="bg-zinc-800 rounded px-2 py-1 text-sm"></select>
				</div>
				<p id="toolSummary" class="text-sm text-zinc-400 mb-3"></p>
				<canvas id="toolHistogram" height="120"></canvas>
			</div>
			<div class="bg-zinc-900 rounded p-4">
				<div class="flex items-center justify-between gap-4 mb-3">
					<h2 class="font-semibold">Bash result token histogram</h2>
					<select id="bashSelect" class="bg-zinc-800 rounded px-2 py-1 text-sm"></select>
				</div>
				<p id="bashSummary" class="text-sm text-zinc-400 mb-3"></p>
				<canvas id="bashHistogram" height="120"></canvas>
			</div>
		</section>
		<section class="bg-zinc-900 rounded p-4"><h2 class="font-semibold mb-3">Tools</h2><div id="tools"></div></section>
		<section class="bg-zinc-900 rounded p-4">
			<h2 class="font-semibold mb-3">Bash common commands (best effort)</h2>
			<div id="bash" class="mt-4"></div>
		</section>
	</main>`;

const renderReport = (data: toolStatsReportTypes.ReportData) =>
  Effect.gen(function* () {
    const script = yield* inlineScript(`${import.meta.dirname}/tool-stats-report.js`);
    const serialized = (yield* Schema.encodeEffect(Json)(data)).replaceAll("<", String.raw`\u003c`);
    return `${HEAD}
${markup(data)}
	<script id="report-data" type="application/json">${serialized}</script>
	${script}
</body>
</html>`;
  });

const toolStatsReport = {
  renderReport,
};

export default toolStatsReport;
