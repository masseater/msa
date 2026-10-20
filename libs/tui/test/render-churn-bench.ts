import { Session } from "node:inspector/promises";
import { performance } from "node:perf_hooks";

import { Console, Effect } from "effect";

import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { CURSOR_MARKER, type Component, Container } from "../src/tui-component.ts";
import renderChurnNullTerminal from "./render-churn-null-terminal.ts";
import type renderChurnNullTerminalTypes from "./render-churn-null-terminal.types.ts";

const { COLUMNS, NullTerminal, ROWS } = renderChurnNullTerminal;

const WARMUP_FRAMES = 20;
const FRAMES = 300;
const SAMPLING_INTERVAL = 4096;

class EditorSim implements Component {
  private text = "";
  private cachedText?: string | undefined;
  private cachedWidth?: number | undefined;
  private cachedLines?: string[] | undefined;

  append(char: string): void {
    this.text += char;
  }

  invalidate(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (
      this.cachedLines !== undefined &&
      this.cachedText === this.text &&
      this.cachedWidth === width
    ) {
      return this.cachedLines;
    }
    const border = `\x1b[90m${"─".repeat(Math.max(1, width - 2))}\x1b[39m`;
    const lines = [border, ` > ${this.text}${CURSOR_MARKER}`, border];
    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

function buildTranscript(): Container {
  const container = new Container();
  for (let i = 0; i < 150; i++) {
    const styled =
      i % 3 === 0
        ? `\x1b[1m\x1b[36muser ${i}\x1b[39m\x1b[22m message with some \x1b[33mstyled\x1b[39m content padding padding`
        : `assistant ${i} plain response line with enough text to be representative of a transcript row`;
    container.addChild(new Text(styled, 1, 0));
  }
  return container;
}

interface SamplingNode {
  selfSize: number;
  children: SamplingNode[];
}

function sumProfile(node: SamplingNode): number {
  let total = node.selfSize;
  for (const child of node.children) total += sumProfile(child);
  return total;
}

interface ScenarioResult {
  allocatedBytes: number;
  elapsedMs: number;
  bytesWritten: number;
}

function runScenario(
  session: Session,
  terminal: renderChurnNullTerminalTypes.NullTerminal,
  tui: TuiAltScreen,
  frame: (index: number) => void,
): Effect.Effect<ScenarioResult> {
  return Effect.gen(function* () {
    const writtenBefore = terminal.bytesWritten;
    yield* Effect.promise(() =>
      session.post("HeapProfiler.startSampling", {
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
        samplingInterval: SAMPLING_INTERVAL,
      }),
    );
    const start = performance.now();
    for (let i = 0; i < FRAMES; i++) {
      frame(i);
      tui.renderNow();
    }
    const elapsedMs = performance.now() - start;
    const { profile } = yield* Effect.promise(() => session.post("HeapProfiler.stopSampling"));
    return {
      allocatedBytes: sumProfile(profile.head as SamplingNode),
      bytesWritten: terminal.bytesWritten - writtenBefore,
      elapsedMs,
    };
  });
}

function report(name: string, result: ScenarioResult): Effect.Effect<void> {
  const perFrameKiB = result.allocatedBytes / FRAMES / 1024;
  const totalMiB = result.allocatedBytes / 1024 / 1024;
  const msPerFrame = result.elapsedMs / FRAMES;
  return Console.log(
    `${name.padEnd(8)} allocated ${totalMiB.toFixed(1).padStart(7)} MiB total  ` +
      `${perFrameKiB.toFixed(1).padStart(8)} KiB/frame  ` +
      `${msPerFrame.toFixed(3).padStart(7)} ms/frame  ` +
      `${(result.bytesWritten / FRAMES).toFixed(0).padStart(6)} written bytes/frame`,
  );
}

function main(): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const terminal = new NullTerminal();
      const tui = new TuiAltScreen(terminal, false, "/tmp/msa-tui-bench");

      const transcript = buildTranscript();
      const editor = new EditorSim();
      const scrollView = new ScrollView(transcript, {
        follow: "end",
        overscroll: "chain",
        primary: true,
        scrollbar: "auto",
      });
      const status = new Text("\x1b[2mstatus: idle\x1b[22m", 1, 0);
      const footer = new Text("\x1b[2m~/workspaces/msa  main  100k tokens\x1b[22m", 1, 0);
      const dock = new VStack([
        { component: status, minSize: 0, shrink: 1 },
        { component: editor, minSize: 3, shrink: 1 },
        { component: footer, minSize: 1, shrink: 1 },
      ]);
      const root = new VStack([
        { basis: 0, component: scrollView, grow: 1, minSize: 1, shrink: 1 },
        { basis: "auto", component: dock, grow: 0, minSize: 1, shrink: 1 },
      ]);
      tui.setLayoutRoot(root);
      tui.start();

      for (let i = 0; i < WARMUP_FRAMES; i++) tui.renderNow();

      const session = new Session();
      session.connect();

      const staticResult = yield* runScenario(session, terminal, tui, () => {});
      const editorResult = yield* runScenario(session, terminal, tui, (i) => {
        editor.append(String.fromCharCode(97 + (i % 26)));
      });

      session.disconnect();
      tui.stop();

      yield* Console.log(
        `frames=${FRAMES} viewport=${COLUMNS}x${ROWS} transcript=${transcript.render(COLUMNS).length} lines`,
      );
      yield* report("static", staticResult);
      yield* report("editor", editorResult);
    }),
  );
}

void main();
