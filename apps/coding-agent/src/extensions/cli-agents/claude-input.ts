import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import * as Effect from "effect/Effect";

import { awaited, awaitingWith } from "../../core/awaiting.ts";
import { callbackPromise } from "../../utils/interop.ts";

export class Input implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(content: ContentBlockParam[], priority?: SDKUserMessage["priority"]): void {
    this.queue.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      ...(priority === undefined ? {} : { priority }),
    });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () =>
        Effect.runPromise(
          awaitingWith(function* (this: Input) {
            while (true) {
              const next = this.queue.shift();
              if (next !== undefined) return { done: false as const, value: next };
              if (this.closed) return { done: true as const, value: undefined };
              yield* awaited(
                callbackPromise<void>((resolve) => {
                  this.wake = resolve;
                }),
              );
              this.wake = undefined;
            }
          }, this),
        ),
    };
  }
}
