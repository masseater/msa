import type { AgentSession } from "../../core/agent-session.ts";
import {
  type PendingHandoff,
  pendingHandoffs,
  takeHandoff,
} from "../../core/orchestrator/handoff-files.ts";
import { formatDateTime } from "../../core/orchestrator/handoff-render.ts";
import type { ExtensionDialogs } from "./extension-dialogs.ts";

type Dialogs = Pick<ExtensionDialogs, "select" | "confirm">;

function describe(handoff: PendingHandoff): string {
  return `${handoff.name}（${formatDateTime(handoff.createdAt)}、タスク ${handoff.tasks} 本）`;
}

async function choose(
  pending: readonly PendingHandoff[],
  dialogs: Dialogs,
): Promise<PendingHandoff | undefined> {
  const [only, ...others] = pending;
  if (only === undefined) return undefined;
  if (others.length === 0) {
    const resume = await dialogs.confirm("引き継ぎ", `${describe(only)}を読んで再開しますか`);
    return resume ? only : undefined;
  }
  const lines = pending.map(describe);
  const picked = await dialogs.select("引き継ぎを読んで再開しますか（Esc で再開しない）", lines);
  return pending[lines.findIndex((line) => line === picked)];
}

export async function handoffResumePrompt(
  directory: string,
  dialogs: Dialogs,
): Promise<string | undefined> {
  const chosen = await choose(await pendingHandoffs(directory), dialogs);
  return chosen === undefined ? undefined : takeHandoff(directory, chosen.name);
}

export async function offerHandoff(session: AgentSession, dialogs: Dialogs): Promise<void> {
  if (session.orchestrator === undefined || session.messages.length > 0) return;
  const prompt = await handoffResumePrompt(session.settingsManager.getHandoffDirectory(), dialogs);
  if (prompt !== undefined) await session.prompt(prompt);
}
