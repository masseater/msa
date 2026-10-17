import { Console, Effect, Schema } from "effect";

import { Host, runScript } from "./host.ts";
import { IndentedJson } from "./json.ts";
import { parseArgs, ReadToolStatsError } from "./read-tool-args.ts";
import type { Args } from "./read-tool-args.ts";
import { buildReadHtmlReport, buildReadTextReport } from "./read-tool-report.ts";
import { scanReadCalls } from "./read-tool-scan.ts";
import type { ReadRecord } from "./read-tool-scan.ts";
import { buildReadSummary } from "./read-tool-summary.ts";
import { reportZone } from "./report-zone.ts";
import { matchesModelFilter, resolveScanScope } from "./scan-options.ts";

const encodeIndentedJson = Schema.encodeEffect(IndentedJson);

const bucketKeys = (args: Args) =>
  Effect.gen(function* () {
    const zone = yield* reportZone;
    const inBucket = args.bucket === "day" ? zone.day : zone.week;
    return {
      bucketOf: (record: ReadRecord): string =>
        Number.isFinite(record.timestampMs) ? inBucket(record.timestampMs) : "[unknown]",
      hourOf: (record: ReadRecord): string =>
        Number.isFinite(record.timestampMs) ? zone.hour(record.timestampMs) : "[unknown]",
    };
  });

const printReport = (options: {
  readonly args: Args;
  readonly records: ReadonlyArray<ReadRecord>;
  readonly summary: ReturnType<typeof buildReadSummary>;
}) =>
  Effect.gen(function* () {
    const { args, records, summary } = options;
    if (args.json) {
      return yield* Console.log(
        yield* encodeIndentedJson(args.includeRecords ? { summary, records } : { summary }),
      );
    }
    if (args.text) return yield* Console.log(buildReadTextReport(summary));
    return yield* Console.log(buildReadHtmlReport(summary));
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const { meta, records } = yield* scanReadCalls(
    yield* resolveScanScope({ args, fail: (message) => new ReadToolStatsError({ message }), host }),
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
  yield* printReport({ args, records: filtered, summary });
});

runScript(program);
