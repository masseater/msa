import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai";
import {
  type Component,
  type Focusable,
  getKeybindings,
  Input,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@msa/tui";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited, awaitingWith } from "../../../core/awaiting.ts";
import type { MessageRenderer } from "../../../core/extensions/types.ts";
import type {
  SessionNodeWithDependencies,
  SessionStatus,
} from "../../../core/orchestrator/graph.ts";
import type { Orchestrator, OrchestratorReport } from "../../../core/orchestrator/orchestrator.ts";
import { nowMs } from "../../../core/platform.ts";
import { formatToolCallWithArgs, formatToolDuration } from "../../../core/tools/render-utils.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, keyText, rawKeyHint } from "./keybinding-hints.ts";
import { truncateToVisualLines } from "./visual-truncate.ts";

const STATUS_ORDER: readonly SessionStatus[] = [
  "failed",
  "running",
  "queued",
  "completed",
  "stopped",
];

const STATUS_LABEL: Record<SessionStatus, string> = {
  failed: "Failed",
  running: "Running",
  queued: "Waiting",
  completed: "Done",
  stopped: "Stopped",
};

function statusGlyph(node: Pick<SessionNodeWithDependencies, "kind" | "status">): string {
  if (node.kind === "review") {
    const color = node.status === "failed" ? "error" : node.status === "stopped" ? "dim" : "accent";
    return theme.fg(color, "◆");
  }
  switch (node.status) {
    case "failed":
      return theme.fg("error", "✗");
    case "running":
      return theme.fg("accent", "●");
    case "queued":
      return theme.fg("muted", "○");
    case "completed":
      return theme.fg("success", "✓");
    case "stopped":
      return theme.fg("dim", "■");
  }
}

function stoppable(node: SessionNodeWithDependencies): boolean {
  return node.status === "running" || node.status === "queued";
}

function modelName(reference: string): string {
  const slash = reference.indexOf("/");
  return slash === -1 ? reference : reference.slice(slash + 1);
}

function titleOf(prompt: string): string {
  const line = firstLine(prompt);
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

function firstLine(text: string | undefined): string {
  return (
    (text ?? "")
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

function activityLines(messages: readonly AgentMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of (message as AssistantMessage).content) {
      if (part.type === "toolCall") {
        lines.push(formatToolCallWithArgs(part.name, part.arguments, theme, false));
      } else if (part.type === "text" && part.text.trim() !== "") {
        lines.push(firstLine(part.text));
      }
    }
  }
  return lines;
}

export const describeSessionCounts: {
  (label?: string): (sessions: readonly SessionNodeWithDependencies[]) => string | undefined;
  (sessions: readonly SessionNodeWithDependencies[], label?: string): string | undefined;
} = dual(
  (args) => Array.isArray(args[0]),
  (sessions: readonly SessionNodeWithDependencies[], label = "Sessions"): string | undefined => {
    const tasks = sessions.filter((node) => node.kind === "task");
    if (tasks.length === 0) return undefined;
    const count = (status: SessionStatus) => tasks.filter((node) => node.status === status).length;
    const parts = [
      [count("running"), theme.fg("accent", "●"), "running"],
      [count("queued"), theme.fg("muted", "○"), "waiting"],
      [count("failed"), theme.fg("error", "✗"), "failed"],
      [count("completed"), theme.fg("success", "✓"), "done"],
      [count("stopped"), theme.fg("dim", "■"), "stopped"],
    ] as const;
    const review = sessions.findLast((node) => node.kind === "review");
    const reviewText =
      review?.status === "running"
        ? `${theme.fg("accent", "◆")} reviewing`
        : review?.status === "completed"
          ? `${theme.fg("success", "◆")} reviewed`
          : undefined;
    return [
      label === "" ? undefined : theme.fg("muted", label),
      ...parts
        .filter(([n]) => n > 0)
        .map(([n, glyph, statusLabel]) => `${glyph} ${n} ${statusLabel}`),
      reviewText,
    ]
      .filter(Boolean)
      .join("  ");
  },
);

const REPORT_VERB: Record<SessionStatus, string> = {
  completed: "finished",
  failed: "failed",
  stopped: "stopped",
  running: "is running",
  queued: "is waiting",
};

export function createSessionReportRenderer(
  orchestrator: Orchestrator | undefined,
): MessageRenderer<OrchestratorReport> {
  return (message, { expanded, outputPad }) => {
    const details = message.details;
    if (details === undefined) return undefined;
    const title = (id: string) =>
      orchestrator?.sessions.find((node) => node.id === id)?.title ?? id;
    const started =
      details.started.length > 0
        ? theme.fg("muted", ` · started ${details.started.map(title).join(", ")}`)
        : "";
    const lines = [
      `${statusGlyph(details)} ${theme.bold(title(details.sessionId))} ${theme.fg("muted", REPORT_VERB[details.status])}${started}`,
    ];
    const content = typeof message.content === "string" ? message.content : "";
    const report = /<session-report>\n([\s\S]*)\n<\/session-report>/u.exec(content)?.[1];
    if (expanded && report !== undefined && report !== "") {
      lines.push(...report.split("\n").map((line) => theme.fg("toolOutput", `  ${line}`)));
    } else if (report !== undefined && report !== "") {
      lines.push(theme.fg("dim", `  ${firstLine(report)}`));
    }
    return new Text(lines.join("\n"), outputPad, 0);
  };
}

export interface SessionsViewOptions {
  orchestrator: Orchestrator;
  onClose: () => void;
  onPickModel: (id: string) => void;
  onError: (message: string) => void;
  requestRender: () => void;
  maxHeight: () => number;
}

type Composing =
  | { kind: "message"; id: string }
  | { kind: "start"; dependsOn: readonly string[]; after: string | undefined };

export class SessionsView implements Component, Focusable {
  private readonly options: SessionsViewOptions;
  private selectedId: string | undefined;
  private openId: string | undefined;
  private readonly input = new Input({ prompt: "› " });
  private composing: Composing | undefined;
  private focusedState = false;

  constructor(options: SessionsViewOptions, initialId?: string) {
    this.options = options;
    this.selectedId = initialId;
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => this.stopComposing();
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value && this.composing !== undefined;
  }

  invalidate(): void {}

  private sessions(): SessionNodeWithDependencies[] {
    const sessions = [...this.options.orchestrator.sessions];
    const tasks = sessions.filter((node) => node.kind === "task");
    return [
      ...STATUS_ORDER.flatMap((status) => tasks.filter((node) => node.status === status)),
      ...sessions.filter((node) => node.kind === "review"),
    ];
  }

  private selected(
    rows: readonly SessionNodeWithDependencies[],
  ): SessionNodeWithDependencies | undefined {
    return rows.find((node) => node.id === this.selectedId) ?? rows[0];
  }

  render(width: number): string[] {
    const rows = this.sessions();
    const open =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((node) => node.id === this.openId)
        : undefined;
    const lines =
      open === undefined ? this.renderList(rows, width) : this.renderDetail(open, rows, width);
    const max = Math.max(8, this.options.maxHeight());
    const hints = lines.pop() ?? "";
    return [...lines.slice(0, max - 1), hints];
  }

  private header(title: string, right: string, width: number): string[] {
    const gap = Math.max(1, width - 2 - visibleWidth(title) - visibleWidth(right));
    return [
      ...new Spacer(1).render(width),
      truncateToWidth(` ${theme.bold(title)}${" ".repeat(gap)}${right}`, width),
      ...new DynamicBorder((line) => theme.fg("borderMuted", line)).render(width),
    ];
  }

  private renderList(rows: readonly SessionNodeWithDependencies[], width: number): string[] {
    const lines = this.header("Sessions", describeSessionCounts(rows, "") ?? "", width);
    if (rows.length === 0) {
      if (this.composing !== undefined) return [...lines, "", ...this.renderComposer(width)];
      lines.push(
        "",
        ` ${keyHint("app.orchestrator.start", "start a session")}  ${keyHint("tui.select.cancel", "close")}`,
      );
      return lines;
    }
    const selected = this.selected(rows);
    const byId = new Map(rows.map((node) => [node.id, node]));
    let group: string | undefined;
    for (const node of rows) {
      const label = node.kind === "review" ? "Review" : STATUS_LABEL[node.status];
      if (label !== group) {
        group = label;
        lines.push(theme.fg("muted", ` ${label}`));
      }
      const isSelected = node.id === selected?.id;
      const cursor = isSelected ? theme.fg("accent", "›") : " ";
      const title = isSelected ? theme.bold(node.title) : node.title;
      const meta = theme.fg("dim", modelName(node.model));
      const left = ` ${cursor} ${statusGlyph(node)} ${title}`;
      const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(meta) - 1);
      lines.push(truncateToWidth(`${left}${" ".repeat(gap)}${meta}`, width));
      const detail = this.rowDetail(node, byId);
      if (detail !== "") lines.push(truncateToWidth(`       ${theme.fg("muted", detail)}`, width));
    }
    lines.push("");
    if (this.composing !== undefined) {
      lines.push(...this.renderComposer(width));
      return lines;
    }
    lines.push(
      ` ${[
        rawKeyHint(`${keyText("tui.select.up")}/${keyText("tui.select.down")}`, "select"),
        keyHint("tui.select.confirm", "open"),
        keyHint("app.orchestrator.start", "start"),
        selected !== undefined && stoppable(selected)
          ? keyHint("app.orchestrator.stop", "stop")
          : undefined,
        keyHint("app.orchestrator.model", "model"),
        keyHint("tui.select.cancel", "close"),
      ]
        .filter(Boolean)
        .join("  ")}`,
    );
    return lines;
  }

  private rowDetail(
    node: SessionNodeWithDependencies,
    byId: ReadonlyMap<string, SessionNodeWithDependencies>,
  ): string {
    if (node.status === "queued") {
      const waiting = node.dependsOn
        .map((id) => byId.get(id))
        .filter((dependency) => dependency && dependency.status !== "completed")
        .map((dependency) => dependency?.title);
      return waiting.length > 0 ? `after ${waiting.join(", ")}` : "starting";
    }
    if (node.status === "running") {
      return this.progressLine(
        node,
        activityLines(this.options.orchestrator.messages(node.id)).at(-1),
      );
    }
    return firstLine(node.report);
  }

  private progressLine(node: SessionNodeWithDependencies, doing: string | undefined): string {
    const { startedAt, retrying } = this.options.orchestrator.progress(node.id);
    const now = retrying ? "retrying" : (doing ?? "waiting for the model");
    return startedAt === undefined ? now : `${formatToolDuration(nowMs() - startedAt)}  ${now}`;
  }

  private renderDetail(
    node: SessionNodeWithDependencies,
    rows: readonly SessionNodeWithDependencies[],
    width: number,
  ): string[] {
    const { activity, section, lines, body } = SessionsView.renderDetailActivity(
      this,
      node,
      width,
      rows,
    );
    SessionsView.renderDetailPart2(this, activity, node, section, lines, width, body);
    if (this.composing === undefined) {
      lines.push(
        ` ${[
          node.status === "queued"
            ? undefined
            : keyHint("tui.select.confirm", node.status === "running" ? "steer" : "rerun"),
          keyHint("app.orchestrator.start", "start after this"),
          stoppable(node) ? keyHint("app.orchestrator.stop", "stop") : undefined,
          keyHint("app.orchestrator.model", "model"),
          keyHint("tui.select.cancel", "back"),
        ]
          .filter(Boolean)
          .join("  ")}`,
      );
    } else {
      lines.push(...this.renderComposer(width));
    }
    return lines;
  }

  private static renderDetailActivity(
    self: SessionsView,
    node: SessionNodeWithDependencies,
    width: number,
    rows: readonly SessionNodeWithDependencies[],
  ): {
    activity: string[];
    section: (title: string) => void;
    lines: string[];
    body: (text: string, limit: number) => void;
  } {
    const right = theme.fg(
      "dim",
      `${STATUS_LABEL[node.status].toLowerCase()} · ${modelName(node.model)} · ${node.thinkingLevel}`,
    );
    const lines = self.header(`${statusGlyph(node)} ${node.title}`, right, width);
    const byId = new Map(rows.map((other) => [other.id, other]));
    const section = (title: string) => {
      lines.push("", theme.fg("accent", ` ${title}`));
    };
    const body = (text: string, limit: number) => {
      const { visualLines, skippedCount } = truncateToVisualLines(text, limit, width - 3);
      if (skippedCount > 0) lines.push(theme.fg("dim", `   … ${skippedCount} more lines`));
      lines.push(...visualLines.map((line) => `   ${line}`));
    };

    if (node.dependsOn.length > 0) {
      section(node.kind === "review" ? "Reviews" : "Depends on");
      lines.push(
        `   ${node.dependsOn
          .map((id) => byId.get(id))
          .map((dependency) =>
            dependency === undefined ? "" : `${statusGlyph(dependency)} ${dependency.title}`,
          )
          .join("   ")}`,
      );
    }
    const activity = activityLines(self.options.orchestrator.messages(node.id));
    return { activity, section, lines, body };
  }

  private static renderDetailPart2(
    self: SessionsView,
    activity: string[],
    node: SessionNodeWithDependencies,
    section: (title: string) => void,
    lines: string[],
    width: number,
    body: (text: string, limit: number) => void,
  ): void {
    if (activity.length > 0 || node.status === "running") {
      section("Activity");
      for (const line of activity.slice(-8)) lines.push(truncateToWidth(`   ${line}`, width));
      if (node.status === "running") {
        lines.push(
          truncateToWidth(
            theme.fg(
              "dim",
              `   ${self.progressLine(node, activity.length > 0 ? "working" : undefined)}`,
            ),
            width,
          ),
        );
      }
    }
    if (node.report !== undefined && node.report !== "") {
      section(node.status === "failed" ? "Error" : "Report");
      body(node.report, 12);
    }
    if (node.prompt !== "") {
      section("Task");
      body(node.prompt, 4);
    }
    lines.push("");
  }

  private renderComposer(width: number): string[] {
    const composing = this.composing;
    if (composing === undefined) return [];
    const label =
      composing.kind === "message"
        ? "Message to this session"
        : composing.after !== undefined && composing.after !== ""
          ? `Task of a session that starts after ${composing.after}`
          : "Task of a session to start now";
    return [
      truncateToWidth(` ${theme.fg("accent", label)}`, width),
      ...this.input.render(width),
      ` ${keyHint("tui.input.submit", composing.kind === "message" ? "send" : "start")}  ${keyHint("tui.select.cancel", "cancel")}`,
    ];
  }

  handleInput(data: string): void {
    if (this.composing !== undefined) {
      this.input.handleInput(data);
      this.options.requestRender();
      return;
    }
    const kb = getKeybindings();
    const rows = this.sessions();
    const selected =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((node) => node.id === this.openId)
        : this.selected(rows);
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.openId !== undefined && this.openId !== "") this.openId = undefined;
      else this.options.onClose();
    } else if (
      (this.openId === undefined || this.openId === "") &&
      kb.matches(data, "tui.select.up")
    ) {
      this.move(rows, -1);
    } else if (
      (this.openId === undefined || this.openId === "") &&
      kb.matches(data, "tui.select.down")
    ) {
      this.move(rows, 1);
    } else if (kb.matches(data, "tui.select.confirm") && selected !== undefined) {
      if (this.openId === undefined || this.openId === "") this.openId = selected.id;
      else if (selected.status !== "queued")
        this.startComposing({ kind: "message", id: selected.id });
    } else if (kb.matches(data, "app.orchestrator.start")) {
      this.startComposing(
        this.openId !== undefined && this.openId !== "" && selected !== undefined
          ? { kind: "start", dependsOn: [selected.id], after: selected.title }
          : { kind: "start", dependsOn: [], after: undefined },
      );
    } else if (
      kb.matches(data, "app.orchestrator.stop") &&
      selected !== undefined &&
      stoppable(selected)
    ) {
      this.options.orchestrator.stop(selected.id).catch((error: unknown) => {
        this.options.onError(toErrorMessage(error));
      });
    } else if (kb.matches(data, "app.orchestrator.model") && selected !== undefined) {
      this.options.onPickModel(selected.id);
      return;
    }
    this.options.requestRender();
  }

  private move(rows: readonly SessionNodeWithDependencies[], step: number): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((node) => node.id === this.selected(rows)?.id);
    this.selectedId = rows[(index + step + rows.length) % rows.length]?.id;
  }

  private startComposing(composing: Composing): void {
    this.composing = composing;
    this.input.setValue("");
    this.input.focused = this.focusedState;
  }

  private stopComposing(): void {
    this.composing = undefined;
    this.input.focused = false;
    this.options.requestRender();
  }

  private submit(value: string): void {
    const composing = this.composing;
    const prompt = value.trim();
    this.stopComposing();
    if (composing === undefined || prompt === "") return;
    const failed = (error: unknown) => {
      this.options.onError(toErrorMessage(error));
    };
    if (composing.kind === "message") {
      this.options.orchestrator.send(composing.id, prompt).catch(failed);
      return;
    }
    Effect.runFork(
      awaitingWith(function* () {
        try {
          const { session } = yield* awaited(
            this.options.orchestrator.start({
              title: titleOf(prompt),
              prompt,
              dependsOn: composing.dependsOn,
            }),
          );
          this.selectedId = session.id;
          this.openId = undefined;
          this.options.requestRender();
        } catch (error: unknown) {
          failed(error);
        }
      }, this),
    );
  }
}
