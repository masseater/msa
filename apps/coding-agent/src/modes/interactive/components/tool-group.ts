import tui from "@msa/tui";

import themeModule from "../theme/theme.ts";
import AssistantMessageComponent from "./assistant-message.ts";
import ToolExecutionComponent from "./tool-execution.ts";
import type toolExecutionTypes from "./tool-execution.types.ts";
import ToolRow from "./tool-row.ts";

const { theme } = themeModule;
const { Container, MouseRegion, Spacer, truncateToWidth } = tui;

const FILE_VERBS: ReadonlyMap<string, string> = new Map([
  ["edit", "edited"],
  ["read", "read"],
  ["write", "wrote"],
]);
const SEARCH_TOOLS = new Set(["grep", "find", "ls"]);
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (/^\+\s*\d/u.test(line)) added++;
    else if (/^-\s*\d/u.test(line)) removed++;
  }
  return { added, removed };
}
function summarize(calls: readonly toolExecutionTypes.ToolCallSummary[], thought: boolean): string {
  const files = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  let added = 0;
  let removed = 0;
  let failed = 0;
  let running = 0;

  for (const call of calls) {
    if (!call.done) running++;
    else if (call.isError) failed++;
    const verb = FILE_VERBS.get(call.toolName);
    if (verb !== undefined && verb !== "") {
      const path = call.args?.path ?? call.args?.file_path ?? "";
      const paths = files.get(verb) ?? new Set<string>();
      paths.add(String(path));
      files.set(verb, paths);
    } else {
      const key = SEARCH_TOOLS.has(call.toolName) ? "search" : call.toolName;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (call.toolName === "edit" && typeof call.details?.diff === "string") {
      const diff = countDiffLines(call.details.diff);
      added += diff.added;
      removed += diff.removed;
    } else if (call.toolName === "write" && call.done && !call.isError) {
      const content = call.args?.content;
      if (typeof content === "string" && content.length > 0) added += content.split("\n").length;
    }
  }

  const parts: string[] = thought ? ["thought"] : [];
  for (const [verb, paths] of files) parts.push(`${verb} ${plural(paths.size, "file")}`);
  for (const [key, count] of counts) {
    if (key === "bash") parts.push(`ran ${plural(count, "command")}`);
    else if (key === "search") parts.push(`searched ${plural(count, "time")}`);
    else parts.push(count === 1 ? `called ${key}` : `called ${key} ×${count}`);
  }
  const text = parts.join(", ");
  let line = theme.fg("toolTitle", text.charAt(0).toUpperCase() + text.slice(1));
  if (added > 0 || removed > 0) {
    line += ` ${theme.fg("toolDiffAdded", `+${added}`)} ${theme.fg("toolDiffRemoved", `-${removed}`)}`;
  }
  if (failed > 0) line += theme.fg("error", `, ${failed} failed`);
  if (running > 0) line += theme.fg("muted", " …");
  return line;
}
export default class ToolGroupComponent extends tui.Container {
  readonly items = new Container();
  private expanded = false;
  private showAll = false;
  private outputPad: number;
  private readonly rows = new Map<toolExecutionTypes.ToolExecutionComponent, ToolRow>();
  private readonly spacer = new Spacer(1);
  private readonly headerRegion = new MouseRegion(
    { invalidate: () => {}, render: (width) => [this.header(width)] },
    (event) => {
      if (event.type !== "click" || event.button !== "left") return undefined;
      this.expanded = !this.expanded;
      return { handled: true };
    },
  );
  private readonly body = new Container();

  constructor(outputPad: number) {
    super();
    this.outputPad = outputPad;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.showAll = expanded;
    for (const tool of this.tools()) {
      tool.setExpanded(expanded);
      this.row(tool).open = expanded;
    }
  }

  setOutputPad(outputPad: number): void {
    this.outputPad = outputPad;
  }

  private tools(): toolExecutionTypes.ToolExecutionComponent[] {
    return this.items.children.filter((item) => item instanceof ToolExecutionComponent);
  }

  private row(tool: toolExecutionTypes.ToolExecutionComponent): ToolRow {
    let row = this.rows.get(tool);
    if (row === undefined) {
      row = new ToolRow(tool, () => this.outputPad);
      row.open = this.showAll;
      this.rows.set(tool, row);
    }
    return row;
  }

  private header(width: number): string {
    const pad = " ".repeat(this.outputPad);
    const marker = theme.fg("muted", this.expanded ? " ⌄" : " ›");
    const thought = this.items.children.some(
      (item) => item instanceof AssistantMessageComponent && item.hasThinking(),
    );
    const summary = summarize(
      this.tools().map((tool) => tool.getCallSummary()),
      thought,
    );
    return truncateToWidth(`${pad}${summary}${marker}`, width, "...");
  }

  override render(width: number): string[] {
    if (this.items.children.length <= 1) {
      this.children = [this.items];
    } else {
      this.body.children = this.expanded
        ? this.items.children.map((item) =>
            item instanceof ToolExecutionComponent ? this.row(item) : item,
          )
        : [];
      this.children = [this.spacer, this.headerRegion, this.body];
    }
    return super.render(width);
  }
}
