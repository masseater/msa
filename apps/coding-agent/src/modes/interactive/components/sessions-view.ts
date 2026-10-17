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

import type { MessageRenderer } from "../../../core/extensions/types.ts";
import type {
  SessionNodeWithDependencies,
  SessionStatus,
} from "../../../core/orchestrator/graph.ts";
import type { Orchestrator, OrchestratorReport } from "../../../core/orchestrator/orchestrator.ts";
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

/** Names a session the user started by hand after the first line of the task they typed. */
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

/** One line per notable step of a transcript: tool calls and the latest text. */
function activityLines(messages: readonly AgentMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of (message as AssistantMessage).content) {
      if (part.type === "toolCall") {
        lines.push(formatToolCallWithArgs(part.name, part.arguments, theme, false));
      } else if (part.type === "text" && part.text.trim()) {
        lines.push(firstLine(part.text));
      }
    }
  }
  return lines;
}

/** `● 2 running  ○ 1 waiting  ✗ 1 failed  ✓ 3 done`, or undefined without sessions. */
export function describeSessionCounts(
  sessions: readonly SessionNodeWithDependencies[],
  label = "Sessions",
): string | undefined {
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
    label ? theme.fg("muted", label) : undefined,
    ...parts
      .filter(([n]) => n > 0)
      .map(([n, glyph, statusLabel]) => `${glyph} ${n} ${statusLabel}`),
    reviewText,
  ]
    .filter(Boolean)
    .join("  ");
}

const REPORT_VERB: Record<SessionStatus, string> = {
  completed: "finished",
  failed: "failed",
  stopped: "stopped",
  running: "is running",
  queued: "is waiting",
};

/** A session's report in the conversation: one line, with the report itself when expanded. */
export function createSessionReportRenderer(
  orchestrator: Orchestrator | undefined,
): MessageRenderer<OrchestratorReport> {
  return (message, { expanded, outputPad }) => {
    const details = message.details;
    if (!details) return undefined;
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
    const report = /<session-report>\n([\s\S]*)\n<\/session-report>/.exec(content)?.[1];
    if (expanded && report) {
      lines.push(...report.split("\n").map((line) => theme.fg("toolOutput", `  ${line}`)));
    } else if (report) {
      lines.push(theme.fg("dim", `  ${firstLine(report)}`));
    }
    return new Text(lines.join("\n"), outputPad, 0);
  };
}

export interface SessionsViewOptions {
  orchestrator: Orchestrator;
  onClose: () => void;
  /** Opens a model picker for `id`; the view comes back when it closes. */
  onPickModel: (id: string) => void;
  onError: (message: string) => void;
  requestRender: () => void;
  /** Rows the view may use, so long lists scroll instead of pushing the editor away. */
  maxHeight: () => number;
}

/** What the input composes: a message to a session, or the task of a session to start. */
type Composing =
  | { kind: "message"; id: string }
  | { kind: "start"; dependsOn: readonly string[]; after: string | undefined };

/**
 * `/sessions`: the sessions the orchestrator started, grouped by status, and one session in detail
 * with its progress, dependencies, and report, where the user starts sessions of their own, steers,
 * stops, or switches a session's model.
 */
export class SessionsView implements Component, Focusable {
  private readonly options: SessionsViewOptions;
  private selectedId: string | undefined;
  private openId: string | undefined;
  private readonly input = new Input({ prompt: "› " });
  private composing: Composing | undefined;
  private _focused = false;

  constructor(options: SessionsViewOptions, initialId?: string) {
    this.options = options;
    this.selectedId = initialId;
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => this.stopComposing();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this.composing !== undefined;
  }

  invalidate(): void {}

  /** Tasks by status, then the reviews, which close their rounds. */
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
    const open = this.openId ? rows.find((node) => node.id === this.openId) : undefined;
    const lines = open ? this.renderDetail(open, rows, width) : this.renderList(rows, width);
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
      if (this.composing) return [...lines, "", ...this.renderComposer(width)];
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
      if (detail) lines.push(truncateToWidth(`       ${theme.fg("muted", detail)}`, width));
    }
    lines.push("");
    if (this.composing) {
      lines.push(...this.renderComposer(width));
      return lines;
    }
    lines.push(
      ` ${[
        rawKeyHint(`${keyText("tui.select.up")}/${keyText("tui.select.down")}`, "select"),
        keyHint("tui.select.confirm", "open"),
        keyHint("app.orchestrator.start", "start"),
        selected && stoppable(selected) ? keyHint("app.orchestrator.stop", "stop") : undefined,
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

  /** How long the session has been running and what it is doing now. */
  private progressLine(node: SessionNodeWithDependencies, doing: string | undefined): string {
    const { startedAt, retrying } = this.options.orchestrator.progress(node.id);
    const now = retrying ? "retrying" : (doing ?? "waiting for the model");
    return startedAt === undefined ? now : `${formatToolDuration(Date.now() - startedAt)}  ${now}`;
  }

  private renderDetail(
    node: SessionNodeWithDependencies,
    rows: readonly SessionNodeWithDependencies[],
    width: number,
  ): string[] {
    const right = theme.fg(
      "dim",
      `${STATUS_LABEL[node.status].toLowerCase()} · ${modelName(node.model)} · ${node.thinkingLevel}`,
    );
    const lines = this.header(`${statusGlyph(node)} ${node.title}`, right, width);
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
          .map((dependency) => (dependency ? `${statusGlyph(dependency)} ${dependency.title}` : ""))
          .join("   ")}`,
      );
    }
    const activity = activityLines(this.options.orchestrator.messages(node.id));
    if (activity.length > 0 || node.status === "running") {
      section("Activity");
      for (const line of activity.slice(-8)) lines.push(truncateToWidth(`   ${line}`, width));
      if (node.status === "running") {
        lines.push(
          truncateToWidth(
            theme.fg(
              "dim",
              `   ${this.progressLine(node, activity.length > 0 ? "working" : undefined)}`,
            ),
            width,
          ),
        );
      }
    }
    if (node.report) {
      section(node.status === "failed" ? "Error" : "Report");
      body(node.report, 12);
    }
    if (node.prompt) {
      section("Task");
      body(node.prompt, 4);
    }
    lines.push("");
    if (this.composing) {
      lines.push(...this.renderComposer(width));
    } else {
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
    }
    return lines;
  }

  /** The input the user types into, labelled with what the text will do. */
  private renderComposer(width: number): string[] {
    const composing = this.composing;
    if (!composing) return [];
    const label =
      composing.kind === "message"
        ? "Message to this session"
        : composing.after
          ? `Task of a session that starts after ${composing.after}`
          : "Task of a session to start now";
    return [
      truncateToWidth(` ${theme.fg("accent", label)}`, width),
      ...this.input.render(width),
      ` ${keyHint("tui.input.submit", composing.kind === "message" ? "send" : "start")}  ${keyHint("tui.select.cancel", "cancel")}`,
    ];
  }

  handleInput(data: string): void {
    if (this.composing) {
      this.input.handleInput(data);
      this.options.requestRender();
      return;
    }
    const kb = getKeybindings();
    const rows = this.sessions();
    const selected = this.openId
      ? rows.find((node) => node.id === this.openId)
      : this.selected(rows);
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.openId) this.openId = undefined;
      else this.options.onClose();
    } else if (!this.openId && kb.matches(data, "tui.select.up")) {
      this.move(rows, -1);
    } else if (!this.openId && kb.matches(data, "tui.select.down")) {
      this.move(rows, 1);
    } else if (kb.matches(data, "tui.select.confirm") && selected) {
      if (!this.openId) this.openId = selected.id;
      else if (selected.status !== "queued")
        this.startComposing({ kind: "message", id: selected.id });
    } else if (kb.matches(data, "app.orchestrator.start")) {
      this.startComposing(
        this.openId && selected
          ? { kind: "start", dependsOn: [selected.id], after: selected.title }
          : { kind: "start", dependsOn: [], after: undefined },
      );
    } else if (kb.matches(data, "app.orchestrator.stop") && selected && stoppable(selected)) {
      this.options.orchestrator.stop(selected.id).catch((error: unknown) => {
        this.options.onError(toErrorMessage(error));
      });
    } else if (kb.matches(data, "app.orchestrator.model") && selected) {
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
    this.input.focused = this._focused;
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
    if (!composing || !prompt) return;
    const failed = (error: unknown) => {
      this.options.onError(toErrorMessage(error));
    };
    if (composing.kind === "message") {
      this.options.orchestrator.send(composing.id, prompt).catch(failed);
      return;
    }
    this.options.orchestrator
      .start({ title: titleOf(prompt), prompt, dependsOn: composing.dependsOn })
      .then(({ session }) => {
        this.selectedId = session.id;
        this.openId = undefined;
        this.options.requestRender();
      })
      .catch(failed);
  }
}
