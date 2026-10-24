import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import errors from "../../utils/errors.ts";
import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import command from "../platform/command.ts";
import platform from "../platform/index.ts";

const { isContextOverflow, providerUnusableReason } = compat;
const { awaited, awaitingWith, performed } = awaitingModule;
const { runCommand } = command;
const { formatLocalDateTime, nowMs } = platform;
const { toErrorMessage } = errors;

const PROVIDER_STALLED_MESSAGE_TYPE = "msa.provider.stalled";
const PROVIDER_RESUMED_MESSAGE_TYPE = "msa.provider.resumed";
const NOTIFY_FAILED_MESSAGE_TYPE = "msa.notify.failed";
const NOTIFY_COMMAND_TIMEOUT_MS = 30_000;

type Stalled = {
  at: number;
  model: string;
  errorMessage: string;
  reason: compatTypes.ProviderUnusableReason;
};

const reference = (provider: string, model: string): string => `${provider}/${model}`;

export default class SessionProviderFallback {
  private readonly session: AgentSession;

  private readonly failedProviders = new Set<string>();

  private stalledInternal: Stalled | undefined;

  private unrecoveredSince: number | undefined;

  constructor(session: AgentSession) {
    this.session = session;
  }

  get stalled(): Stalled | undefined {
    return this.stalledInternal;
  }

  afterResponse(message: compatTypes.AssistantMessage): Effect.Effect<boolean> {
    if (message.stopReason === "aborted") return Effect.succeed(false);
    if (message.stopReason !== "error") {
      this.recordSuccess(message);
      return Effect.succeed(false);
    }
    const reason = this.unusableReason(message);
    return reason === undefined ? Effect.succeed(false) : this.recover(message, reason);
  }

  private unusableReason(
    message: compatTypes.AssistantMessage,
  ): compatTypes.ProviderUnusableReason | undefined {
    const reason = providerUnusableReason(message);
    if (reason === undefined) return undefined;
    const model = this.session.models.selection.modelForMessage(message) ?? this.session.model;
    return isContextOverflow(message, model?.contextWindow ?? 0) ? undefined : reason;
  }

  private recover(
    message: compatTypes.AssistantMessage,
    reason: compatTypes.ProviderUnusableReason,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      this.failedProviders.add(message.provider);
      const errorMessage = message.errorMessage ?? "Unknown error";
      const next = yield* performed(
        this.session.models.selection.fallbackModel(this.failedProviders),
      );
      if (next === undefined) {
        this.stall(message, errorMessage, reason);
        return false;
      }
      this.session.run.retry.omitRecoveryAttempt(message);
      this.session.emit({
        errorMessage,
        from: reference(message.provider, message.model),
        to: reference(next.provider, next.id),
        type: "model_fallback",
      });
      return true;
    }, this);
  }

  private recordSuccess(message: compatTypes.AssistantMessage): void {
    this.failedProviders.clear();
    const since = this.unrecoveredSince;
    if (since === undefined) return;
    this.unrecoveredSince = undefined;
    this.stalledInternal = undefined;
    this.session.emit({
      model: reference(message.provider, message.model),
      since,
      type: "provider_recovered",
    });
  }

  resumeAfterModelChange(): void {
    const stalled = this.stalledInternal;
    const model = this.session.model;
    if (stalled === undefined || model === undefined || this.session.isStreaming) return;
    this.failedProviders.clear();
    this.stalledInternal = undefined;
    void this.session.run.prompting.sendCustomMessage(
      {
        content: `Switched to ${reference(model.provider, model.id)}. Continue from the stop at ${formatLocalDateTime(stalled.at)}, including every report that arrived since then.`,
        customType: PROVIDER_RESUMED_MESSAGE_TYPE,
        display: true,
      },
      { triggerTurn: true },
    );
  }

  private stall(
    message: compatTypes.AssistantMessage,
    errorMessage: string,
    reason: compatTypes.ProviderUnusableReason,
  ): void {
    if (this.stalledInternal !== undefined) return;
    const stalled = {
      at: nowMs(),
      errorMessage,
      model: reference(message.provider, message.model),
      reason,
    };
    this.stalledInternal = stalled;
    this.unrecoveredSince ??= stalled.at;
    this.session.emit({ ...stalled, type: "provider_stalled" });
    void this.session.run.prompting.sendCustomMessage(
      {
        content: `Model calls stopped at ${formatLocalDateTime(stalled.at)}: ${stalled.model} failed with "${errorMessage}" and no model in enabledModels could take over.`,
        customType: PROVIDER_STALLED_MESSAGE_TYPE,
        display: true,
      },
      { triggerTurn: false },
    );
    void Effect.runPromise(this.runNotifyCommand(`${stalled.model} stopped: ${errorMessage}`));
  }

  private runNotifyCommand(text: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const notifyCommand = this.session.settingsManager.terminal.getNotifyCommand();
      if (notifyCommand === undefined) return;
      const shell =
        process.platform === "win32"
          ? { args: ["/d", "/s", "/c", notifyCommand], file: "cmd.exe" }
          : { args: ["-c", notifyCommand], file: "/bin/sh" };
      let failure: string | undefined;
      try {
        const output = yield* awaited(
          runCommand({
            ...shell,
            env: { MSA_NOTIFY_MESSAGE: text },
            signal: AbortSignal.timeout(NOTIFY_COMMAND_TIMEOUT_MS),
          }),
        );
        const stderr = output.stderr.trim();
        if (output.exitCode !== 0)
          failure = `exited with ${output.exitCode}${stderr === "" ? "" : `: ${stderr}`}`;
      } catch (error) {
        failure = toErrorMessage(error);
      }
      if (failure === undefined) return;
      yield* awaited(
        this.session.run.prompting.sendCustomMessage(
          {
            content: `notifyCommand failed: ${failure}`,
            customType: NOTIFY_FAILED_MESSAGE_TYPE,
            display: true,
          },
          { triggerTurn: false },
        ),
      );
    }, this);
  }
}
