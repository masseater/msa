import { dual } from "effect/Function";

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/iu,
  /\brmdir\b/iu,
  /\bmv\b/iu,
  /\bcp\b/iu,
  /\bmkdir\b/iu,
  /\btouch\b/iu,
  /\bchmod\b/iu,
  /\bchown\b/iu,
  /\bchgrp\b/iu,
  /\bln\b/iu,
  /\btee\b/iu,
  /\btruncate\b/iu,
  /\bdd\b/iu,
  /\bshred\b/iu,
  /(^|[^<])>(?!>)/u,
  />>/u,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/iu,
  /\byarn\s+(add|remove|install|publish)/iu,
  /\bpnpm\s+(add|remove|install|publish)/iu,
  /\bpip\s+(install|uninstall)/iu,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/iu,
  /\bbrew\s+(install|uninstall|upgrade)/iu,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/iu,
  /\bsudo\b/iu,
  /\bsu\b/iu,
  /\bkill\b/iu,
  /\bpkill\b/iu,
  /\bkillall\b/iu,
  /\breboot\b/iu,
  /\bshutdown\b/iu,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/iu,
  /\bservice\s+\S+\s+(start|stop|restart)/iu,
  /\b(vim?|nano|emacs|code|subl)\b/iu,
];

const SAFE_PATTERNS = [
  /^\s*cat\b/u,
  /^\s*head\b/u,
  /^\s*tail\b/u,
  /^\s*less\b/u,
  /^\s*more\b/u,
  /^\s*grep\b/u,
  /^\s*find\b/u,
  /^\s*ls\b/u,
  /^\s*pwd\b/u,
  /^\s*echo\b/u,
  /^\s*printf\b/u,
  /^\s*wc\b/u,
  /^\s*sort\b/u,
  /^\s*uniq\b/u,
  /^\s*diff\b/u,
  /^\s*file\b/u,
  /^\s*stat\b/u,
  /^\s*du\b/u,
  /^\s*df\b/u,
  /^\s*tree\b/u,
  /^\s*which\b/u,
  /^\s*whereis\b/u,
  /^\s*type\b/u,
  /^\s*env\b/u,
  /^\s*printenv\b/u,
  /^\s*uname\b/u,
  /^\s*whoami\b/u,
  /^\s*id\b/u,
  /^\s*date\b/u,
  /^\s*cal\b/u,
  /^\s*uptime\b/u,
  /^\s*ps\b/u,
  /^\s*top\b/u,
  /^\s*htop\b/u,
  /^\s*free\b/u,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/iu,
  /^\s*git\s+ls-/iu,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/iu,
  /^\s*yarn\s+(list|info|why|audit)/iu,
  /^\s*node\s+--version/iu,
  /^\s*python\s+--version/iu,
  /^\s*curl\s/iu,
  /^\s*wget\s+-O\s*-/iu,
  /^\s*jq\b/u,
  /^\s*sed\s+-n/iu,
  /^\s*awk\b/u,
  /^\s*rg\b/u,
  /^\s*fd\b/u,
  /^\s*bat\b/u,
  /^\s*eza\b/u,
];

export function isSafeCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
  const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
  return !isDestructive && isSafe;
}

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
}

export function cleanStepText(text: string): string {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/iu,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  if (cleaned.length > 50) {
    cleaned = `${cleaned.slice(0, 47)}...`;
  }
  return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
  const items: TodoItem[] = [];
  const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/iu);
  if (headerMatch === null) return items;

  const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
  const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gmu;

  for (const [, , stepText] of planSection.matchAll(numberedPattern)) {
    if (stepText === undefined) continue;
    const text = stepText
      .trim()
      .replace(/\*{1,2}$/u, "")
      .trim();
    if (
      text.length > 5 &&
      !text.startsWith("`") &&
      !text.startsWith("/") &&
      !text.startsWith("-")
    ) {
      const cleaned = cleanStepText(text);
      if (cleaned.length > 3) {
        items.push({ completed: false, step: items.length + 1, text: cleaned });
      }
    }
  }
  return items;
}

export function extractDoneSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[DONE:(\d+)\]/giu)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) steps.push(step);
  }
  return steps;
}

function markCompletedStepsImpl(text: string, items: TodoItem[]): number {
  const doneSteps = extractDoneSteps(text);
  for (const step of doneSteps) {
    const item = items.find((t) => t.step === step);
    if (item !== undefined) item.completed = true;
  }
  return doneSteps.length;
}

export const markCompletedSteps: {
  (text: string, items: TodoItem[]): number;
  (items: TodoItem[]): (text: string) => number;
} = dual(2, markCompletedStepsImpl);
