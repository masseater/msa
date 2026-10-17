import { describe, expect, it } from "vitest";

import {
  canonicalizeBuiltinSlashCommand,
  formatHelpMarkdown,
  skillCommandName,
} from "../src/core/slash-commands.ts";

describe("built-in slash commands", () => {
  it.each([
    ["/quit", "/exit"],
    ["/new", "/clear"],
    ["/settings", "/config"],
    ["/session", "/status"],
    ["/thinking high", "/effort high"],
    ["/name my session", "/rename my session"],
    ["/feedback it\ncrashed", "/bug it\ncrashed"],
    ["/exit", "/exit"],
  ])("runs %j as %j", (typed, run) => {
    expect(canonicalizeBuiltinSlashCommand(typed)).toBe(run);
  });

  it.each(["/quitter", "/skill:quit", "quit", "/usr/bin/env", ""])(
    "leaves %j to extensions, templates, skills, and the model",
    (text) => {
      expect(canonicalizeBuiltinSlashCommand(text)).toBe(text);
    },
  );

  it("lists skills by name unless a command already uses it", () => {
    const taken = new Set(["review"]);
    expect(skillCommandName("deploy", taken)).toBe("deploy");
    expect(skillCommandName("review", taken)).toBe("skill:review");
    expect(skillCommandName("quit", taken)).toBe("skill:quit");
  });

  it("shows aliases next to each command in /help, then the first sentence of added commands", () => {
    const help = formatHelpMarkdown([
      { name: "deploy", description: "Ship | release. Use when a change is merged." },
      { name: "writing", description: "文章を書くときに読む。記事も対象である。" },
    ]);
    expect(help).toContain("| `/exit` | Exit msa (`/quit`) |");
    expect(help.split("\n").slice(-2)).toEqual([
      "| `/deploy` | Ship \\| release. |",
      "| `/writing` | 文章を書くときに読む。 |",
    ]);
  });
});
