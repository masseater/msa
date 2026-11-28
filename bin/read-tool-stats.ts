import { Effect, Schema } from "effect";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import hostModule from "./host.ts";
import jsonModule from "./json.ts";
import readToolArgs from "./read-tool-args.ts";
import readToolReport from "./read-tool-report.ts";
import readToolScan from "./read-tool-scan.ts";
import type readToolStatsTypes from "./read-tool-stats.types.ts";
import readToolSummary from "./read-tool-summary.ts";
import reportZoneModule from "./report-zone.ts";
import scanOptionsModule from "./scan-options.ts";

const { IndentedJson } = jsonModule;
const { ReadToolStatsError, parseArgs } = readToolArgs;
const { reportZone } = reportZoneModule;
const { scanReadCalls } = readToolScan;
const { buildReadSummary } = readToolSummary;
const { buildReadHtmlReport, buildReadTextReport } = readToolReport;
const { Host, runScript } = hostModule;
const { matchesModelFilter, resolveScanScope } = scanOptionsModule;

const encodeIndentedJson = Schema.encodeEffect(IndentedJson);

const bucketKeys = (args: readToolStatsTypes.Args) =>
  Effect.gen(function* () {
    const zone = yield* reportZone;
    const inBucket = args.bucket === "day" ? zone.day : zone.week;
    return {
      bucketOf: (record: readToolStatsTypes.ReadRecord): string =>
        Number.isFinite(record.timestampMs) ? inBucket(record.timestampMs) : "[unknown]",
      hourOf: (record: readToolStatsTypes.ReadRecord): string =>
        Number.isFinite(record.timestampMs) ? zone.hour(record.timestampMs) : "[unknown]",
    };
  });

const report = (options: {
  readonly args: readToolStatsTypes.Args;
  readonly records: ReadonlyArray<readToolStatsTypes.ReadRecord>;
  readonly summary: ReturnType<typeof buildReadSummary>;
}) =>
  Effect.gen(function* () {
    const { args, records, summary } = options;
    if (args.json) {
      return yield* scriptOutput.print(
        yield* encodeIndentedJson(args.includeRecords ? { records, summary } : { summary }),
      );
    }
    if (args.text) return yield* scriptOutput.print(buildReadTextReport(summary));
    const host = yield* Host;
    yield* host.writeHtmlReport(args.output, buildReadHtmlReport(summary));
    return yield* scriptOutput.print(`Wrote ${args.output}`);
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const { meta, records } = yield* scanReadCalls(
    yield* resolveScanScope({
      args,
      fail: (message) => ReadToolStatsError.make({ message }),
      host,
    }),
  );
  const filtered = records.filter((record) =>
    matchesModelFilter({ modelFilter: args.modelFilter, providerModel: record.providerModel }),
  );
  const summary = buildReadSummary({
    bucket: args.bucket,
    ...(yield* bucketKeys(args)),
    meta,
    modelFilter: args.modelFilter,
    records: filtered,
    top: args.top,
  });
  yield* report({ args, records: filtered, summary });
});

runScript(program);
