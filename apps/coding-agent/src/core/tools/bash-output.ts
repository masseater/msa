import type { Fiber } from "effect";
import { Effect } from "effect";

import platform from "../platform/index.ts";
import type platformTypes from "../platform/index.types.ts";
import type bashOutputTypes from "./bash-output.types.ts";
import type outputAccumulatorTypes from "./output-accumulator.types.ts";
import bash from "./renderers/bash.ts";
import truncate from "./truncate.ts";
import type truncateTypes from "./truncate.types.ts";

const { currentTimeMillis, fromPromise } = platform;
const { BASH_UPDATE_THROTTLE_MS } = bash;
const { DEFAULT_MAX_BYTES, formatSize } = truncate;

export default class BashOutputReporter {
  private acceptingOutput = true;
  private updateTimer: Fiber.Fiber<void> | undefined;
  private updateDirty = false;
  private lastUpdateAt = 0;

  private readonly output: outputAccumulatorTypes.OutputAccumulator;
  private readonly onUpdate: bashOutputTypes.BashUpdateCallback | undefined;

  constructor(
    output: outputAccumulatorTypes.OutputAccumulator,
    onUpdate: bashOutputTypes.BashUpdateCallback | undefined,
  ) {
    this.output = output;
    this.onUpdate = onUpdate;
  }

  readonly handleData = (data: Buffer): void => {
    if (!this.acceptingOutput) return;
    this.output.append(data);
    this.scheduleUpdate();
  };

  clearTimer(): void {
    this.updateTimer?.interruptUnsafe();
    this.updateTimer = undefined;
  }

  finish(): Effect.Effect<outputAccumulatorTypes.OutputSnapshot, platformTypes.ForeignError> {
    return Effect.suspend(() => {
      this.acceptingOutput = false;
      this.output.finish();
      this.clearTimer();
      this.emitUpdate();
      const snapshot = this.output.snapshot({ persistIfTruncated: true });
      return fromPromise(() => this.output.closeTempFile()).pipe(Effect.as(snapshot));
    });
  }

  format(
    snapshot: outputAccumulatorTypes.OutputSnapshot,
    emptyText = "(no output)",
  ): { text: string; details: bashOutputTypes.BashToolDetails | undefined } {
    const { truncation } = snapshot;
    const base = snapshot.content === "" ? emptyText : snapshot.content;
    if (!truncation.truncated) return { details: undefined, text: base };
    return {
      details: { fullOutputPath: snapshot.fullOutputPath, truncation },
      text: base + this.truncationNotice(truncation, snapshot),
    };
  }

  private emitUpdate(): void {
    if (this.onUpdate === undefined || !this.updateDirty) return;
    this.updateDirty = false;
    this.lastUpdateAt = currentTimeMillis();
    const snapshot = this.output.snapshot({ persistIfTruncated: true });
    this.onUpdate({
      content: [{ text: snapshot.content, type: "text" }],
      details: {
        fullOutputPath: snapshot.fullOutputPath,
        truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
      },
    });
  }

  private scheduleUpdate(): void {
    if (this.onUpdate === undefined) return;
    this.updateDirty = true;
    const delay = BASH_UPDATE_THROTTLE_MS - (currentTimeMillis() - this.lastUpdateAt);
    if (delay <= 0) {
      this.clearTimer();
      this.emitUpdate();
      return;
    }
    this.updateTimer ??= Effect.runFork(
      Effect.sleep(delay).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.updateTimer = undefined;
            this.emitUpdate();
          }),
        ),
      ),
    );
  }

  private truncationNotice(
    truncation: truncateTypes.TruncationResult,
    snapshot: outputAccumulatorTypes.OutputSnapshot,
  ): string {
    const startLine = truncation.totalLines - truncation.outputLines + 1;
    const endLine = truncation.totalLines;
    const fullOutput = `Full output: ${snapshot.fullOutputPath}`;
    if (truncation.lastLinePartial) {
      const lastLineSize = formatSize(this.output.getLastLineBytes());
      return `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). ${fullOutput}]`;
    }
    if (truncation.truncatedBy === "lines") {
      return `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. ${fullOutput}]`;
    }
    return `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). ${fullOutput}]`;
  }
}
