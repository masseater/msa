import type { AgentMessage } from "@msa/agent-core";
import { fauxAssistantMessage } from "@msa/ai";
import { setKeybindings } from "@msa/tui";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionNodeWithDependencies } from "../src/core/orchestrator/graph.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import {
  createSessionReportRenderer,
  describeSessionCounts,
  SessionsView,
} from "../src/modes/interactive/components/sessions-view.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function node(
  id: string,
  patch: Partial<SessionNodeWithDependencies> = {},
): SessionNodeWithDependencies {
  return {
    id,
    project: "p",
    kind: "task",
    title: id,
    prompt: `do ${id}`,
    status: "queued",
    model: "fast/flash",
    thinkingLevel: "low",
    cwd: "/repo",
    round: 1,
    createdAt: 0,
    dependsOn: [],
    ...patch,
  };
}

const SESSIONS = [
  node("review", { kind: "review", title: "Review of round 1", dependsOn: ["readme"], prompt: "" }),
  node("readme", { dependsOn: ["fizzbuzz", "primes"] }),
  node("fizzbuzz", { status: "running" }),
  node("primes", { status: "completed", report: "primes.py written\nmore" }),
  node("notes", { status: "failed", report: "429 rate limited" }),
];

function setup(
  sessions = SESSIONS,
  progress: Orchestrator["progress"] = () => ({ startedAt: undefined, retrying: false }),
) {
  const messages: Record<string, AgentMessage[]> = {
    fizzbuzz: [
      {
        ...fauxAssistantMessage(""),
        content: [{ type: "toolCall", id: "1", name: "write", arguments: { path: "fizzbuzz.py" } }],
      } as AgentMessage,
    ],
  };
  const orchestrator = {
    sessions,
    messages: (id: string) => messages[id] ?? [],
    progress,
    stop: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
  };
  const onClose = vi.fn();
  const onPickModel = vi.fn();
  const view = new SessionsView({
    orchestrator: orchestrator as unknown as Orchestrator,
    onClose,
    onPickModel,
    onError: () => {},
    requestRender: () => {},
    maxHeight: () => 40,
  });
  const screen = () => view.render(100).map((line) => stripAnsi(line).trimEnd());
  return { view, orchestrator, onClose, onPickModel, screen };
}

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";

beforeAll(() => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
});

describe("SessionsView", () => {
  it("groups tasks by status, keeps the review last, and shows what each one is doing", () => {
    const { screen } = setup();
    const lines = screen();
    const groups = lines.filter((line) =>
      /^ (Failed|Running|Waiting|Done|Stopped|Review)$/.test(line),
    );
    expect(groups.map((line) => line.trim())).toEqual([
      "Failed",
      "Running",
      "Waiting",
      "Done",
      "Review",
    ]);
    const text = lines.join("\n");
    expect(text).toContain("429 rate limited");
    expect(text).toContain('write path="fizzbuzz.py"');
    expect(text).toContain("after fizzbuzz");
    expect(text).not.toContain("after fizzbuzz, primes");
    expect(text).toContain("after readme");
  });

  it("opens a session, sends it a message, and goes back", () => {
    const { view, orchestrator, screen } = setup();
    view.handleInput(ENTER);
    expect(screen().join("\n")).toContain("Error");
    view.handleInput(ENTER);
    for (const key of "try again") view.handleInput(key);
    view.handleInput(ENTER);
    expect(orchestrator.send).toHaveBeenCalledWith("notes", "try again");
    view.handleInput(ESC);
    expect(screen().join("\n")).toContain("Failed");
  });

  it("stops only sessions that are running or waiting, and closes on escape", () => {
    const { view, orchestrator, onClose, onPickModel } = setup();
    view.handleInput("s");
    expect(orchestrator.stop).not.toHaveBeenCalled();
    view.handleInput(DOWN);
    view.handleInput("s");
    expect(orchestrator.stop).toHaveBeenCalledWith("fizzbuzz");
    view.handleInput("m");
    expect(onPickModel).toHaveBeenCalledWith("fizzbuzz");
    view.handleInput(ESC);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows how long a running session has run and when it is retrying", () => {
    const startedAt = Date.now() - 75_000;
    const { view, screen } = setup(SESSIONS, (id) => ({
      startedAt,
      retrying: id === "fizzbuzz",
    }));
    expect(screen().join("\n")).toContain("1m 15s  retrying");
    view.handleInput(DOWN);
    view.handleInput(ENTER);
    expect(screen().join("\n")).toMatch(
      /Activity\n {3}write path="fizzbuzz\.py"\n {3}1m 15s {2}retrying/,
    );
  });
});

describe("describeSessionCounts", () => {
  it("counts tasks by status and says nothing without tasks", () => {
    expect(stripAnsi(describeSessionCounts(SESSIONS) ?? "")).toBe(
      "Sessions  ● 1 running  ○ 1 waiting  ✗ 1 failed  ✓ 1 done",
    );
    expect(describeSessionCounts([node("r", { kind: "review" })])).toBeUndefined();
  });
});

describe("createSessionReportRenderer", () => {
  it("shows one line per report and the report when expanded", () => {
    const render = createSessionReportRenderer({ sessions: SESSIONS } as unknown as Orchestrator);
    const message = {
      role: "custom" as const,
      customType: "msa.orchestrator.report",
      content:
        "Session primes completed.\n\n<session-report>\nprimes.py written\nmore\n</session-report>",
      display: true,
      details: {
        sessionId: "primes",
        kind: "task" as const,
        status: "completed" as const,
        started: ["readme"],
      },
      timestamp: 0,
    };
    const text = (expanded: boolean) =>
      render(message, { expanded, outputPad: 0 }, theme)
        ?.render(100)
        .map((line) => stripAnsi(line).trimEnd()) ?? [];
    expect(text(false)).toEqual(["✓ primes finished · started readme", "  primes.py written"]);
    expect(text(true)).toEqual([
      "✓ primes finished · started readme",
      "  primes.py written",
      "  more",
    ]);
  });
});
