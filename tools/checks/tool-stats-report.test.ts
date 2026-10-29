import { ManagedRuntime } from "effect";
import { expect, it } from "vite-plus/test";

import hostModule from "../../scripts/host.ts";
import toolStatsReport from "../../scripts/tool-stats-report.ts";

const { hostLayer } = hostModule;
const { renderReport } = toolStatsReport;

const row = (name: string, histogram: readonly number[]) => ({
  avg: 120,
  calls: 3,
  estimatedTokens: 360,
  histogram,
  name,
  results: 3,
  samples: [100, 120, 140],
});

const report = renderReport({
  bashCommands: [row("git <status>", [0, 3, 0])],
  bucketLabels: ["0-50", "50-100", "100+"],
  files: 2,
  generatedAt: "2026-01-01T00:00:00.000Z",
  parseErrors: 0,
  sessionsDir: "sessions",
  tools: [row("read", [1, 2, 0]), row("bash", [0, 0, 3])],
});

const runtime = ManagedRuntime.make(hostLayer);

it("renders the tool stats report as HTML and CSS without scripts", () =>
  runtime.runPromise(report).then((html) => {
    expect(html).not.toMatch(/<script/iu);
    expect(html).toContain(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';',
    );
    expect(html).toContain('<table class="charts-css bar show-labels');
    expect(html).toContain('<input type="radio" name="tool" id="tool-1">');
    expect(html).toContain(
      'body:has(#tool-1:checked) .selected[data-group="tool"][data-row="1"] { display: block; }',
    );
    expect(html).toContain("git &lt;status&gt;");
    return undefined;
  }));
