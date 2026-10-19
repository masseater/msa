import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai/compat";
import { contentText } from "@msa/ai/utils/text";
import type { SpanAttributes, TelemetryContext } from "@msa/telemetry";

import type { AgentSessionEvent } from "../agent-session.ts";
import { type OpenSpan, openSpan } from "./open-span.ts";

export type SessionTelemetryRole = "main" | "worker" | "reviewer";

export interface SessionTelemetryOptions {
  readonly context: TelemetryContext;
  readonly role: SessionTelemetryRole;
}

const ERROR_TEXT_LIMIT = 300;

function isAssistant(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant";
}

function firstLines(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > ERROR_TEXT_LIMIT ? `${trimmed.slice(0, ERROR_TEXT_LIMIT)}…` : trimmed;
}

function toolErrorText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result)) return "";
  const { content } = result;
  return Array.isArray(content) || typeof content === "string"
    ? firstLines(contentText(content, "\n"))
    : "";
}

function requestOutcome(message: AssistantMessage): "ok" | "error" | "aborted" {
  if (message.stopReason === "aborted") return "aborted";
  return message.stopReason === "error" ? "error" : "ok";
}

interface PendingRequest {
  readonly span: OpenSpan;
  readonly startedAt: number;
}

export class SessionTelemetry {
  readonly #context: TelemetryContext;
  readonly #role: SessionTelemetryRole;
  #turn: OpenSpan | undefined;
  #turnIndex = 0;
  #request: PendingRequest | undefined;
  readonly #tools = new Map<string, OpenSpan>();
  #compaction: OpenSpan | undefined;

  constructor(context: TelemetryContext, role: SessionTelemetryRole) {
    this.#context = context;
    this.#role = role;
  }

  handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case "turn_start":
        this.#startTurn();
        break;
      case "message_start":
        if (isAssistant(event.message)) this.#startRequest(event.message);
        break;
      case "message_end":
        if (isAssistant(event.message)) this.#endRequest(event.message);
        break;
      case "tool_execution_start":
        this.#startTool(event.toolCallId, event.toolName);
        break;
      case "tool_execution_end":
        this.#endTool(event.toolCallId, event.toolName, event.isError, event.result);
        break;
      case "turn_end":
        this.#endTurn();
        break;
      case "compaction_start":
        this.#compaction?.end();
        this.#compaction = openSpan(this.#context, {
          name: "msa.compaction",
          attributes: { "msa.compaction.reason": event.reason },
        });
        break;
      case "compaction_end":
        this.#compaction?.end(
          event.errorMessage === undefined
            ? undefined
            : {
                status: "error",
                error: { name: "CompactionError", message: firstLines(event.errorMessage) },
              },
        );
        this.#compaction = undefined;
        break;
      case "auto_retry_start":
        (this.#turn?.span ?? this.#context).log({
          severity: "warn",
          body: "msa.llm.retry",
          attributes: {
            "msa.retry.attempt": event.attempt,
            "msa.retry.max_attempts": event.maxAttempts,
            "error.message": firstLines(event.errorMessage),
          },
        });
        break;
      default:
        break;
    }
  }

  close(): void {
    for (const span of this.#tools.values()) span.end();
    this.#tools.clear();
    this.#request?.span.end();
    this.#request = undefined;
    this.#compaction?.end();
    this.#compaction = undefined;
    this.#endTurn();
  }

  #parent(): TelemetryContext {
    return this.#turn?.span ?? this.#context;
  }

  #startTurn(): void {
    this.#endTurn();
    this.#turnIndex += 1;
    this.#turn = openSpan(this.#context, {
      name: "msa.turn",
      attributes: { "msa.session.role": this.#role, "msa.turn.index": this.#turnIndex },
    });
  }

  #endTurn(): void {
    this.#turn?.end();
    this.#turn = undefined;
  }

  #startRequest(message: AssistantMessage): void {
    this.#request?.span.end();
    this.#request = {
      span: openSpan(this.#parent(), {
        name: "msa.llm.request",
        attributes: {
          "gen_ai.provider.name": message.provider,
          "gen_ai.request.model": message.model,
        },
      }),
      startedAt: performance.now(),
    };
  }

  #endRequest(message: AssistantMessage): void {
    const request = this.#request ?? {
      span: openSpan(this.#parent(), { name: "msa.llm.request" }),
      startedAt: performance.now(),
    };
    this.#request = undefined;
    const { usage } = message;
    const outcome = requestOutcome(message);
    const model: SpanAttributes = {
      "gen_ai.provider.name": message.provider,
      "gen_ai.request.model": message.model,
    };
    request.span.span.setAttributes({
      ...model,
      "gen_ai.response.model": message.responseModel ?? message.model,
      "msa.thinking_level": message.thinkingLevel,
      "msa.stop_reason": message.stopReason,
      "gen_ai.usage.input_tokens": usage.input,
      "gen_ai.usage.output_tokens": usage.output,
      "msa.usage.cache_read_tokens": usage.cacheRead,
      "msa.usage.cache_write_tokens": usage.cacheWrite,
      "msa.cost.usd": usage.cost.total,
      "error.type": outcome === "ok" ? undefined : message.stopReason,
    });
    this.#turn?.span.setAttributes({ ...model, "msa.thinking_level": message.thinkingLevel });
    request.span.end(
      outcome === "ok"
        ? undefined
        : {
            status: "error",
            error: { name: message.stopReason, message: firstLines(message.errorMessage ?? "") },
          },
    );
    this.#recordRequestMetrics(message, model, outcome, request.startedAt);
  }

  #recordRequestMetrics(
    message: AssistantMessage,
    model: SpanAttributes,
    outcome: string,
    startedAt: number,
  ): void {
    const attributes = { ...model, "msa.session.role": this.#role };
    const tokens = {
      input: message.usage.input,
      output: message.usage.output,
      cache_read: message.usage.cacheRead,
      cache_write: message.usage.cacheWrite,
    };
    for (const [type, value] of Object.entries(tokens)) {
      if (value > 0) {
        this.#context.recordMetric({
          kind: "counter",
          name: "msa.llm.tokens",
          value,
          unit: "{token}",
          description: "Tokens used by LLM requests",
          attributes: { ...attributes, "msa.token.type": type },
        });
      }
    }
    if (message.usage.cost.total > 0) {
      this.#context.recordMetric({
        kind: "counter",
        name: "msa.llm.cost",
        value: message.usage.cost.total,
        unit: "USD",
        description: "Cost of LLM requests",
        attributes,
      });
    }
    this.#context.recordMetric({
      kind: "histogram",
      name: "msa.llm.request.duration",
      value: (performance.now() - startedAt) / 1000,
      unit: "s",
      description: "Time from the start of an LLM response to its end",
      attributes: { ...attributes, "msa.outcome": outcome },
    });
  }

  #startTool(toolCallId: string, toolName: string): void {
    this.#tools.get(toolCallId)?.end();
    this.#tools.set(
      toolCallId,
      openSpan(this.#parent(), {
        name: "msa.tool.call",
        attributes: { "gen_ai.tool.name": toolName, "gen_ai.tool.call.id": toolCallId },
      }),
    );
  }

  #endTool(toolCallId: string, toolName: string, isError: boolean, result: unknown): void {
    const span =
      this.#tools.get(toolCallId) ??
      openSpan(this.#parent(), {
        name: "msa.tool.call",
        attributes: { "gen_ai.tool.name": toolName, "gen_ai.tool.call.id": toolCallId },
      });
    this.#tools.delete(toolCallId);
    const outcome = isError ? "error" : "ok";
    this.#context.recordMetric({
      kind: "counter",
      name: "msa.tool.calls",
      value: 1,
      unit: "{call}",
      description: "Tool calls by tool and outcome",
      attributes: { "gen_ai.tool.name": toolName, "msa.outcome": outcome },
    });
    if (!isError) {
      span.end();
      return;
    }
    const message = toolErrorText(result);
    span.span.setAttributes({ "error.type": "tool_error" });
    span.span.log({
      severity: "warn",
      body: "msa.tool.failed",
      attributes: { "gen_ai.tool.name": toolName, "error.message": message },
    });
    span.end({ status: "error", error: { name: "ToolError", message } });
  }
}
