import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import type AgentSession from "../../core/agent-session.ts";
import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform.ts";
import errorsModule from "../../utils/errors.ts";
import loginFlowHelpers from "./login-flow-helpers.ts";
import LoginFlowLayer5 from "./login-flow-layer-5.ts";
import LoginFlow from "./login-flow.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { awaited, awaiting, awaitingWith } = awaitingModule;
const { schedule } = platform;
const { toErrorMessage } = errorsModule;
const { CREDENTIAL_TIMEOUT_MS } = loginFlowHelpers;

export default abstract class LoginFlowLayer6 extends LoginFlowLayer5 {
  completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: loginFlowTypes.AuthType,
    previousModel: compatTypes.Model<any> | undefined,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(
        function* () {
          const { host, actionLabel, deferSelection, session } =
            LoginFlow.completeProviderAuthenticationHost(
              this as unknown as LoginFlow,
              authType,
              providerName,
              previousModel,
              providerId,
            );
          yield* this.completeProviderAuthenticationPart6(
            previousModel,
            host,
            providerId,
            actionLabel,
            deferSelection,
            session,
          );
        },
        this as unknown as LoginFlow,
      ),
    );
  }

  protected *completeProviderAuthenticationPart6(
    previousModel: compatTypes.Model<any> | undefined,
    host: loginFlowTypes.LoginFlowHost,
    providerId: string,
    actionLabel: string,
    deferSelection: boolean,
    session: AgentSession,
  ) {
    const finishAuthentication = yield* this.completeProviderAuthenticationPart5(
      previousModel,
      host,
      providerId,
      actionLabel,
      deferSelection,
    );

    Effect.runFork(
      awaiting(function* () {
        const controller = new AbortController();
        const timeout = schedule(() => controller.abort(), CREDENTIAL_TIMEOUT_MS);
        try {
          const result = yield* awaited(
            session.models.selection.modelRuntime.refresh({
              providers: [providerId],
              signal: controller.signal,
            }),
          );
          if (result.aborted) {
            host.showWarning(
              `${actionLabel}, but its model catalog refresh timed out; using cached models.`,
            );
          } else if (result.errors.size > 0) {
            host.showWarning(
              `${actionLabel}, but its model catalog could not be refreshed; using cached models.`,
            );
          }
          if (deferSelection && host.session === session && session.model === previousModel) {
            yield* awaited(finishAuthentication());
          }
          host.refreshAuthState();
        } catch (error: unknown) {
          host.showWarning(
            `${actionLabel}, but its model catalog could not be refreshed: ${toErrorMessage(error)}`,
          );
        } finally {
          timeout.cancel();
        }
      }),
    );
  }
}
