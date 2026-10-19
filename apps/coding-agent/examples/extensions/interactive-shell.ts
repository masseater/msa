import { NodeServices } from "@effect/platform-node";
import { readProcessEnv } from "@msa/ai/utils/env";
import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { Effect, ManagedRuntime } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const runtime = ManagedRuntime.make(NodeServices.layer);

const DEFAULT_INTERACTIVE_COMMANDS = [
  "vim",
  "nvim",
  "vi",
  "nano",
  "emacs",
  "pico",
  "micro",
  "helix",
  "hx",
  "kak",

  "less",
  "more",
  "most",

  "git commit",
  "git rebase",
  "git merge",
  "git cherry-pick",
  "git revert",
  "git add -p",
  "git add --patch",
  "git add -i",
  "git add --interactive",
  "git stash -p",
  "git stash --patch",
  "git reset -p",
  "git reset --patch",
  "git checkout -p",
  "git checkout --patch",
  "git difftool",
  "git mergetool",

  "htop",
  "top",
  "btop",
  "glances",

  "ranger",
  "nnn",
  "lf",
  "mc",
  "vifm",

  "tig",
  "lazygit",
  "gitui",

  "fzf",
  "sk",

  "ssh",
  "telnet",
  "mosh",

  "psql",
  "mysql",
  "sqlite3",
  "mongosh",
  "redis-cli",

  "kubectl edit",
  "kubectl exec -it",
  "docker exec -it",
  "docker run -it",

  "tmux",
  "screen",
  "ncdu",
];

function splitEnvList(name: string): string[] {
  return (readProcessEnv(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getInteractiveCommands(): string[] {
  const additional = splitEnvList("INTERACTIVE_COMMANDS");
  const excluded = new Set(splitEnvList("INTERACTIVE_EXCLUDE").map((s) => s.toLowerCase()));
  return [...DEFAULT_INTERACTIVE_COMMANDS, ...additional].filter(
    (cmd) => !excluded.has(cmd.toLowerCase()),
  );
}

function isInteractiveCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  const commands = getInteractiveCommands();

  for (const cmd of commands) {
    const cmdLower = cmd.toLowerCase();

    if (
      trimmed === cmdLower ||
      trimmed.startsWith(`${cmdLower} `) ||
      trimmed.startsWith(`${cmdLower}\t`)
    ) {
      return true;
    }

    const pipeIdx = trimmed.lastIndexOf("|");
    if (pipeIdx !== -1) {
      const afterPipe = trimmed.slice(pipeIdx + 1).trim();
      if (afterPipe === cmdLower || afterPipe.startsWith(`${cmdLower} `)) {
        return true;
      }
    }
  }
  return false;
}

const runShell = (shell: string, command: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(shell, ["-c", command], {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          }),
        );
        return yield* handle.exitCode;
      }),
    );
  });

const bashResult = (output: string, exitCode: number) => ({
  result: { output, exitCode, cancelled: false, truncated: false },
});

const openShell = (ctx: ExtensionContext, command: string): Promise<number | null> =>
  ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
    tui.stop();
    process.stdout.write("\x1b[2J\x1b[H");

    const shell = readProcessEnv("SHELL") || "/bin/sh";
    void runtime.runFork(
      runShell(shell, command).pipe(
        Effect.andThen((code) =>
          Effect.sync(() => {
            tui.start();
            tui.requestRender(true);
            done(code);
          }),
        ),
      ),
    );

    return { render: () => [], invalidate: () => {} };
  });

const stripForcePrefix = (command: string): { command: string; forced: boolean } => {
  if (command.startsWith("i ") || command.startsWith("i\t")) {
    return { command: command.slice(2).trim(), forced: true };
  }
  return { command, forced: false };
};

const runInteractive = (ctx: ExtensionContext, command: string) =>
  Effect.gen(function* () {
    const exitCode = yield* Effect.promise(() => openShell(ctx, command));
    const output =
      exitCode === 0
        ? "(interactive command completed successfully)"
        : `(interactive command exited with code ${exitCode})`;
    return bashResult(output, exitCode ?? 1);
  });

export default function (msa: ExtensionAPI) {
  msa.on("user_bash", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { command, forced } = stripForcePrefix(event.command);
        if (!forced && !isInteractiveCommand(command)) return undefined;
        if (ctx.mode !== "tui") {
          return bashResult("(interactive commands require TUI)", 1);
        }
        return yield* runInteractive(ctx, command);
      }),
    ),
  );
}
