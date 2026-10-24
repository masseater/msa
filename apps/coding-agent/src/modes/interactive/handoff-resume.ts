import { Effect } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import handoffFiles from "../../core/orchestrator/handoff-files.ts";
import type handoffFilesTypes from "../../core/orchestrator/handoff-files.types.ts";
import platform from "../../core/platform/index.ts";
import type extensionDialogsTypes from "./extension-dialogs.types.ts";

const { awaited, awaiting } = awaitingModule;

const { pendingHandoffs, takeHandoff } = handoffFiles;
const { formatLocalDateTime } = platform;

type Dialogs = Pick<extensionDialogsTypes.ExtensionDialogs, "select" | "confirm">;

function describe(handoff: handoffFilesTypes.PendingHandoff): string {
  return `${handoff.name}（${formatLocalDateTime(handoff.createdAt)}、タスク ${handoff.tasks} 本）`;
}

function choose(
  pending: readonly handoffFilesTypes.PendingHandoff[],
  dialogs: Dialogs,
): Promise<handoffFilesTypes.PendingHandoff | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const [only, ...others] = pending;
      if (only === undefined) return yield* awaited(undefined);
      if (others.length === 0) {
        const resume = yield* awaited(
          dialogs.confirm("引き継ぎ", `${describe(only)}を読んで再開しますか`),
        );
        return yield* awaited(resume ? only : undefined);
      }
      const lines = pending.map(describe);
      const picked = yield* awaited(
        dialogs.select("引き継ぎを読んで再開しますか（Esc で再開しない）", lines),
      );
      return yield* awaited(pending[lines.findIndex((line) => line === picked)]);
    }),
  );
}

function handoffResumePrompt(directory: string, dialogs: Dialogs): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const chosen = yield* awaited(choose(yield* awaited(pendingHandoffs(directory)), dialogs));
      return yield* awaited(chosen === undefined ? undefined : takeHandoff(directory, chosen.name));
    }),
  );
}

function offerHandoff(session: agentSessionTypes.AgentSession, dialogs: Dialogs): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      if (
        session.integrations.orchestration.orchestrator === undefined ||
        session.messages.length > 0
      )
        return;
      const prompt = yield* awaited(
        handoffResumePrompt(
          session.settingsManager.session.getHandoffDirectory(session.agentDir),
          dialogs,
        ),
      );
      if (prompt !== undefined) yield* awaited(session.run.prompting.prompt(prompt));
    }),
  );
}

const handoffResume = {
  handoffResumePrompt,
  offerHandoff,
};

export default handoffResume;
