import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import textModule from "@msa/ai/utils/text";
import type telemetryTypes from "@msa/telemetry/index.types";

import type { AgentSessionEvent } from "../agent-session.ts";
import { type OpenSpan, openSpan } from "./open-span.ts";

const { contentText } = textModule;

export type SessionTelemetryRole = "main" | "worker" | "reviewer";

export interface SessionTelemetryOptions {
  readonly context: telemetryTypes.TelemetryContext;
  readonly role: SessionTelemetryRole;
}

const ERROR_TEXT_LIMIT = 300;

function isAssistant(message: agentTypes.AgentMessage): message is compatTypes.AssistantMessage {
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

function requestOutcome(message: compatTypes.AssistantMessage): "ok" | "error" | "aborted" {
  if (message.stopReason === "aborted") return "aborted";
  return message.stopReason === "error" ? "error" : "ok";
}

interface PendingRequest {
  readonly span: OpenSpan;
  readonly startedAt: number;
}

export class SessionTelemetry {
  readonly #context: telemetryTypes.TelemetryContext;
  readonly #role: SessionTelemetryRole;
  #turn: OpenSpan | undefined;
  #turnIndex = 0;
  #request: PendingRequest | undefined;
  readonly #tools = new Map<string, OpenSpan>();
  #compaction: OpenSpan | undefined;

  constructor(context: telemetryTypes.TelemetryContext, role: SessionTelemetryRole) {
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
          attributes: { "msa.compaction.reason": event.reason },
          name: "msa.compaction",
        });
        break;
      case "compaction_end":
        this.#compaction?.end(
          event.errorMessage === undefined
            ? undefined
            : {
                error: { message: firstLines(event.errorMessage), name: "CompactionError" },
                status: "error",
              },
        );
        this.#compaction = undefined;
        break;
      case "auto_retry_start":
        (this.#turn?.span ?? this.#context).log({
          attributes: {
            "error.message": firstLines(event.errorMessage),
            "msa.retry.attempt": event.attempt,
            "msa.retry.max_attempts": event.maxAttempts,
          },
          body: "msa.llm.retry",
          severity: "warn",
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

  #parent(): telemetryTypes.TelemetryContext {
    return this.#turn?.span ?? this.#context;
  }

  #startTurn(): void {
    this.#endTurn();
    this.#turnIndex += 1;
    this.#turn = openSpan(this.#context, {
      attributes: { "msa.session.role": this.#role, "msa.turn.index": this.#turnIndex },
      name: "msa.turn",
    });
  }

  #endTurn(): void {
    this.#turn?.end();
    this.#turn = undefined;
  }

  #startRequest(message: compatTypes.AssistantMessage): void {
    this.#request?.span.end();
    this.#request = {
      span: openSpan(this.#parent(), {
        attributes: {
          "gen_ai.provider.name": message.provider,
          "gen_ai.request.model": message.model,
        },
        name: "msa.llm.request",
      }),
      startedAt: performance.now(),
    };
  }

  #endRequest(message: compatTypes.AssistantMessage): void {
    const request = this.#request ?? {
      span: openSpan(this.#parent(), { name: "msa.llm.request" }),
      startedAt: performance.now(),
    };
    this.#request = undefined;
    const { usage } = message;
    const outcome = requestOutcome(message);
    const model: telemetryTypes.SpanAttributes = {
      "gen_ai.provider.name": message.provider,
      "gen_ai.request.model": message.model,
    };
    request.span.span.setAttributes({
      ...model,
      "error.type": outcome === "ok" ? undefined : message.stopReason,
      "gen_ai.response.model": message.responseModel ?? message.model,
      "gen_ai.usage.input_tokens": usage.input,
      "gen_ai.usage.output_tokens": usage.output,
      "msa.cost.usd": usage.cost.total,
      "msa.stop_reason": message.stopReason,
      "msa.thinking_level": message.thinkingLevel,
      "msa.usage.cache_read_tokens": usage.cacheRead,
      "msa.usage.cache_write_tokens": usage.cacheWrite,
    });
    this.#turn?.span.setAttributes({ ...model, "msa.thinking_level": message.thinkingLevel });
    request.span.end(
      outcome === "ok"
        ? undefined
        : {
            error: { message: firstLines(message.errorMessage ?? ""), name: message.stopReason },
            status: "error",
          },
    );
    this.#recordRequestMetrics(message, model, outcome, request.startedAt);
  }

  #recordRequestMetrics(
    message: compatTypes.AssistantMessage,
    model: telemetryTypes.SpanAttributes,
    outcome: string,
    startedAt: number,
  ): void {
    const attributes = { ...model, "msa.session.role": this.#role };
    const tokens = {
      cache_read: message.usage.cacheRead,
      cache_write: message.usage.cacheWrite,
      input: message.usage.input,
      output: message.usage.output,
    };
    for (const [type, value] of Object.entries(tokens)) {
      if (value > 0) {
        this.#context.recordMetric({
          attributes: { ...attributes, "msa.token.type": type },
          description: "Tokens used by LLM requests",
          kind: "counter",
          name: "msa.llm.tokens",
          unit: "{token}",
          value,
        });
      }
    }
    if (message.usage.cost.total > 0) {
      this.#context.recordMetric({
        attributes,
        description: "Cost of LLM requests",
        kind: "counter",
        name: "msa.llm.cost",
        unit: "USD",
        value: message.usage.cost.total,
      });
    }
    this.#context.recordMetric({
      attributes: { ...attributes, "msa.outcome": outcome },
      description: "Time from the start of an LLM response to its end",
      kind: "histogram",
      name: "msa.llm.request.duration",
      unit: "s",
      value: (performance.now() - startedAt) / 1000,
    });
  }

  #startTool(toolCallId: string, toolName: string): void {
    this.#tools.get(toolCallId)?.end();
    this.#tools.set(
      toolCallId,
      openSpan(this.#parent(), {
        attributes: { "gen_ai.tool.call.id": toolCallId, "gen_ai.tool.name": toolName },
        name: "msa.tool.call",
      }),
    );
  }

  #endTool(toolCallId: string, toolName: string, isError: boolean, result: unknown): void {
    const span =
      this.#tools.get(toolCallId) ??
      openSpan(this.#parent(), {
        attributes: { "gen_ai.tool.call.id": toolCallId, "gen_ai.tool.name": toolName },
        name: "msa.tool.call",
      });
    this.#tools.delete(toolCallId);
    const outcome = isError ? "error" : "ok";
    this.#context.recordMetric({
      attributes: { "gen_ai.tool.name": toolName, "msa.outcome": outcome },
      description: "Tool calls by tool and outcome",
      kind: "counter",
      name: "msa.tool.calls",
      unit: "{call}",
      value: 1,
    });
    if (!isError) {
      span.end();
      return;
    }
    const message = toolErrorText(result);
    span.span.setAttributes({ "error.type": "tool_error" });
    span.span.log({
      attributes: { "error.message": message, "gen_ai.tool.name": toolName },
      body: "msa.tool.failed",
      severity: "warn",
    });
    span.end({ error: { message, name: "ToolError" }, status: "error" });
  }
}
