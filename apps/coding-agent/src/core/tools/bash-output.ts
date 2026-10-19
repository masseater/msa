import type { AgentToolResult } from "@msa/agent-core";
import { Effect } from "effect";
import type { Fiber } from "effect";

import {
  currentTimeMillis,
  type ForeignError,
  fromPromise,
  platformRuntime,
} from "../platform/index.ts";
import type { OutputAccumulator, OutputSnapshot } from "./output-accumulator.ts";
import { BASH_UPDATE_THROTTLE_MS } from "./renderers/bash.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult } from "./truncate.ts";

export interface BashToolDetails {
  truncation?: TruncationResult | undefined;
  fullOutputPath?: string | undefined;
}

export type BashUpdateCallback = (partial: AgentToolResult<BashToolDetails | undefined>) => void;

export class BashOutputReporter {
  private acceptingOutput = true;
  private updateTimer: Fiber.Fiber<void> | undefined;
  private updateDirty = false;
  private lastUpdateAt = 0;

  private readonly output: OutputAccumulator;
  private readonly onUpdate: BashUpdateCallback | undefined;

  constructor(output: OutputAccumulator, onUpdate: BashUpdateCallback | undefined) {
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

  finish(): Effect.Effect<OutputSnapshot, ForeignError> {
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
    snapshot: OutputSnapshot,
    emptyText = "(no output)",
  ): { text: string; details: BashToolDetails | undefined } {
    const { truncation } = snapshot;
    const base = snapshot.content === "" ? emptyText : snapshot.content;
    if (!truncation.truncated) return { text: base, details: undefined };
    return {
      text: base + this.truncationNotice(truncation, snapshot),
      details: { truncation, fullOutputPath: snapshot.fullOutputPath },
    };
  }

  private emitUpdate(): void {
    if (this.onUpdate === undefined || !this.updateDirty) return;
    this.updateDirty = false;
    this.lastUpdateAt = currentTimeMillis();
    const snapshot = this.output.snapshot({ persistIfTruncated: true });
    this.onUpdate({
      content: [{ type: "text", text: snapshot.content }],
      details: {
        truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
        fullOutputPath: snapshot.fullOutputPath,
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
    this.updateTimer ??= platformRuntime.runFork(
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

  private truncationNotice(truncation: TruncationResult, snapshot: OutputSnapshot): string {
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
