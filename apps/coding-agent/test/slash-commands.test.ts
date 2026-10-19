import { describe, expect, it } from "vite-plus/test";

import {
  canonicalizeBuiltinSlashCommand,
  formatHelpMarkdown,
  handoffPrompt,
  parseHandoffCommand,
  withSkillCommands,
} from "../src/core/slash-commands.ts";

describe("built-in slash commands", () => {
  it.each([
    ["/quit", "/exit"],
    ["/new", "/clear"],
    ["/settings", "/config"],
    ["/cost", "/status"],
    ["/continue", "/resume"],
    ["/undo", "/rewind"],
    ["/feedback it\ncrashed", "/bug it\ncrashed"],
    ["/exit", "/exit"],
  ])("runs Claude Code's %j as %j", (typed, run) => {
    expect(canonicalizeBuiltinSlashCommand(typed)).toBe(run);
  });

  it.each(["/thinking high", "/name x", "/session", "/tree", "/clone", "/hotkeys", "/changelog"])(
    "has no alias for the earlier msa name %j",
    (text) => {
      expect(canonicalizeBuiltinSlashCommand(text)).toBe(text);
    },
  );

  it.each(["/quitter", "/skill:quit", "quit", "/usr/bin/env", ""])(
    "leaves %j to extensions, templates, skills, and the model",
    (text) => {
      expect(canonicalizeBuiltinSlashCommand(text)).toBe(text);
    },
  );

  it("lists every skill under its name, taking the name from a command", () => {
    const commands = [
      { name: "review", source: "prompt" },
      { name: "lint", source: "extension" },
    ];
    const skills = [
      { name: "review", source: "skill" },
      { name: "deploy", source: "skill" },
    ];
    expect(withSkillCommands(commands, skills)).toEqual([
      { name: "lint", source: "extension" },
      { name: "review", source: "skill" },
      { name: "deploy", source: "skill" },
    ]);
  });

  it("lists a skill instead of the built-in command whose name it took in /help", () => {
    const help = formatHelpMarkdown([{ name: "status", description: "Project status." }]);
    expect(help).not.toContain("Show session info");
    expect(help).toContain("| `/status` | Project status. |");
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

describe("/handoff", () => {
  it("is /handoff alone, or /handoff with the path to write to", () => {
    expect(parseHandoffCommand("/handoff")).toEqual({ path: "" });
    expect(parseHandoffCommand("/handoff  ~/notes/next.md ")).toEqual({ path: "~/notes/next.md" });
  });

  it.each(["/handoffs", "/handoff-now x", "handoff", "/init"])("does not take %j", (text) => {
    expect(parseHandoffCommand(text)).toBeUndefined();
  });

  it("asks the model for the three sections through the handoff tool, and passes the path on", () => {
    const prompt = handoffPrompt("");
    for (const word of ["`handoff`", "premise", "goals", "donts"]) expect(prompt).toContain(word);
    expect(prompt).not.toContain("path");
    expect(handoffPrompt("~/notes/next.md")).toContain('Pass path: "~/notes/next.md".');
  });
});
