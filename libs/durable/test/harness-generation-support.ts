import { fauxAssistantMessage, type Models } from "@msa/ai";
import {
  type CommitPublication,
  type Conversation,
  LiveDoc,
  type LiveState,
  type TaskId,
} from "@msa/durable";
import { Harness } from "@msa/durable/harness";

import { waitFor } from "./chat-support.ts";
import { context } from "./session-support.ts";

export const ERROR_503 = fauxAssistantMessage([], {
  stopReason: "error",
  errorMessage: "503 Service Unavailable",
});

export function live(
  harness: Harness,
  conversation: Conversation,
): Promise<Readonly<LiveState> | undefined> {
  return Promise.resolve(harness.snapshot(LiveDoc, conversation.id, context));
}

export async function runTask(harness: Harness, conversation: Conversation): Promise<TaskId> {
  let taskId: TaskId | undefined;
  await waitFor(async () => {
    taskId = (await live(harness, conversation))?.run?.taskId;
    return taskId !== undefined;
  });
  return taskId!;
}

// `models` with `streamSimple` replaced.
export function withStream(models: Models, streamSimple: Models["streamSimple"]): Models {
  return new Proxy(models, {
    get(target, property) {
      if (property === "streamSimple") return streamSimple;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function livePublications(harness: Harness): LiveState[] {
  const values: LiveState[] = [];
  harness.subscribeCommits((publication: CommitPublication) => {
    for (const change of publication.changes) {
      if (
        change.type === "document" &&
        change.record.kind === "msa.live" &&
        change.value !== null
      ) {
        values.push(change.value as LiveState);
      }
    }
  });
  return values;
}
