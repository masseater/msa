import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { Cause } from "effect";
import { Effect, Queue, Stream } from "effect";

export default class Input implements AsyncIterable<SDKUserMessage> {
  private readonly queue = Effect.runSync(Queue.unbounded<SDKUserMessage, Cause.Done>());

  private readonly messages = Stream.toAsyncIterable(Stream.fromQueue(this.queue));

  push(content: ContentBlockParam[], priority?: SDKUserMessage["priority"]): void {
    Queue.offerUnsafe(this.queue, {
      message: { content, role: "user" },
      parent_tool_use_id: null,
      type: "user",
      ...(priority === undefined ? {} : { priority }),
    });
  }

  close(): void {
    Queue.endUnsafe(this.queue);
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return this.messages[Symbol.asyncIterator]();
  }
}
