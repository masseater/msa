import type { AuthEvent, AuthPrompt } from "@msa/ai";
import type { Model } from "@msa/ai/compat";
import type { TUI } from "@msa/tui";
import { Effect } from "effect";

import { APP_NAME, getAuthPath } from "../../config.ts";
import type { AgentSession } from "../../core/agent-session.ts";
import { awaited, awaiting, awaitingWith, performed } from "../../core/awaiting.ts";
import { type ExternalService, findExternalService } from "../../core/external-services.ts";
import { defaultModelPerProvider } from "../../core/model-resolver.ts";
import { CredentialSynchronizationError } from "../../core/model-runtime.ts";
import { schedule } from "../../core/platform.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import { LoginDialogComponent } from "./components/login-dialog.ts";
import {
  type AuthSelectorProvider,
  formatAuthSelectorProviderType,
  OAuthSelectorComponent,
} from "./components/oauth-selector.ts";
import type { EditorSlot } from "./editor-slot.ts";
import type { ProgramStatusReporter } from "./program-status-reporter.ts";
import { theme } from "./theme/theme.ts";

const LOGIN_CANCELLED = "Login cancelled";
const CREDENTIAL_TIMEOUT_MS = 15_000;

const AUTH_TYPE_ORDER = { oauth: 0, api_key: 1 } satisfies Record<
  AuthSelectorProvider["authType"],
  number
>;

type AuthType = AuthSelectorProvider["authType"];

export type LoginProviderCompletionOption = {
  id: string;
  name: string;
  authTypes: AuthType[];
  subscription?: boolean | undefined;
};

export function getLoginProviderCompletionOptions(
  providerOptions: readonly AuthSelectorProvider[],
): LoginProviderCompletionOption[] {
  const byId = new Map<string, LoginProviderCompletionOption>();
  for (const provider of providerOptions) {
    const existing = byId.get(provider.id);
    if (existing !== undefined) {
      if (!existing.authTypes.includes(provider.authType)) {
        existing.authTypes.push(provider.authType);
        existing.authTypes.sort((a, b) => AUTH_TYPE_ORDER[a] - AUTH_TYPE_ORDER[b]);
      }
      continue;
    }
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name,
      authTypes: [provider.authType],
      subscription: provider.subscription,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getLoginProviderSearchText(provider: LoginProviderCompletionOption): string {
  const authTypes = provider.authTypes
    .map(
      (authType) =>
        `${authType} ${formatAuthSelectorProviderType(authType, provider.subscription)}`,
    )
    .join(" ");
  return `${provider.id} ${provider.name} ${authTypes}`;
}

export function formatLoginProviderCompletionDescription(
  provider: LoginProviderCompletionOption,
): string {
  const authTypes = provider.authTypes
    .map((authType) => formatAuthSelectorProviderType(authType, provider.subscription))
    .join("/");
  return provider.name === provider.id ? authTypes : `${provider.name} · ${authTypes}`;
}

function isUnknownModel(model: Model<any> | undefined): boolean {
  return (
    model !== undefined &&
    model.provider === "unknown" &&
    model.id === "unknown" &&
    model.api === "unknown"
  );
}

function hasDefaultModelProvider(
  providerId: string,
): providerId is keyof typeof defaultModelPerProvider {
  return providerId in defaultModelPerProvider;
}

function llamaCppPostLoginGuidance(actionLabel: string, loadedModelCount: number): string {
  return loadedModelCount === 0
    ? `${actionLabel}. No llama.cpp models are loaded. Use /llama to load a model, then /model to select it.`
    : `${actionLabel}. Use /model to select a loaded llama.cpp model, or /llama to manage models.`;
}

export interface LoginFlowHost {
  readonly ui: TUI;
  readonly session: AgentSession;
  readonly programStatus: ProgramStatusReporter;
  readonly editorSlot: EditorSlot;
  showStatus(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  refreshAuthState(): void;
}

export class LoginFlow {
  private readonly host: LoginFlowHost;

  constructor(host: LoginFlowHost) {
    this.host = host;
  }

  getProviderOptions(authType?: AuthType): AuthSelectorProvider[] {
    const { modelRuntime } = this.host.session;
    const options: AuthSelectorProvider[] = [];
    for (const provider of modelRuntime.getProviders()) {
      const authStatus = modelRuntime.getProviderAuthStatus(provider.id);
      const source = authStatus.configured ? (authStatus.label ?? authStatus.source) : undefined;
      const status = authStatus.configured
        ? {
            type: modelRuntime.isUsingOAuth(provider.id)
              ? ("oauth" as const)
              : ("api_key" as const),
            ...(source === undefined ? {} : { source }),
          }
        : undefined;
      const subscription = provider.auth.oauth?.isSubscription === true;
      if ((authType === undefined || authType === "oauth") && provider.auth.oauth !== undefined) {
        options.push({
          id: provider.id,
          name: provider.name,
          authType: "oauth",
          method: provider.auth.oauth,
          status,
          subscription,
        });
      }
      if (
        (authType === undefined || authType === "api_key") &&
        provider.auth.apiKey !== undefined
      ) {
        options.push({
          id: provider.id,
          name: provider.name,
          authType: "api_key",
          method: provider.auth.apiKey,
          status,
          subscription,
        });
      }
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }

  login(providerRef?: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const normalizedRef = providerRef?.trim().toLowerCase();
        if (normalizedRef === undefined || normalizedRef === "") {
          this.showAuthTypeSelector();
          return;
        }
        const service = findExternalService(this.host.session.getExternalServices(), normalizedRef);
        if (service !== undefined) {
          yield* performed(this.loginService(service));
          return;
        }

        const providerOptions = this.getProviderOptions().filter(
          (provider) =>
            provider.id.toLowerCase() === normalizedRef ||
            provider.name.toLowerCase() === normalizedRef,
        );
        if (providerOptions.length === 1) {
          yield* performed(this.startProviderLogin(providerOptions[0]!));
          return;
        }
        if (new Set(providerOptions.map((provider) => provider.id)).size === 1) {
          this.showAuthTypeSelector(providerOptions);
          return;
        }
        this.showProviderSelector(undefined, providerRef);
      }, this),
    );
  }

  logout(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { host } = this;
        let providerOptions: AuthSelectorProvider[];
        try {
          providerOptions = yield* performed(this.getLogoutProviderOptions());
        } catch (error) {
          host.showError(`Could not read stored credentials: ${toErrorMessage(error)}`);
          return;
        }
        const allServices = host.session.getExternalServices();
        const statuses = yield* awaited(
          Promise.all(allServices.map((service) => service.status().catch(() => undefined))),
        );
        const services = allServices.filter((_, index) => {
          const status = statuses[index];
          return status?.installed && status.signedIn;
        });
        providerOptions = [
          ...providerOptions,
          ...services.map((service) => ({
            id: service.id,
            name: service.name,
            authType: "oauth" as const,
            status: { type: "oauth" as const, source: `${service.name} sign-in` },
          })),
        ];
        if (providerOptions.length === 0) {
          host.showStatus(
            "No stored credentials to remove. /logout only removes credentials saved by /login; environment variables and models.json config are unchanged.",
          );
          return;
        }

        host.editorSlot.showSelector((done) => {
          const selector = new OAuthSelectorComponent(
            "logout",
            providerOptions,
            (providerId: string) =>
              Effect.runPromise(
                awaitingWith(function* () {
                  done();
                  const providerOption = providerOptions.find(
                    (provider) => provider.id === providerId,
                  );
                  if (providerOption === undefined) {
                    return;
                  }
                  const service = services.find((candidate) => candidate.id === providerId);
                  if (service !== undefined) {
                    yield* performed(this.logoutService(service));
                    return;
                  }
                  try {
                    yield* awaited(
                      host.session.modelRuntime.logout(providerOption.id, {
                        signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
                      }),
                    );
                    host.refreshAuthState();
                    host.showStatus(
                      providerOption.authType === "oauth"
                        ? `Logged out of ${providerOption.name}`
                        : `Removed stored API key for ${providerOption.name}. Environment variables and models.json config are unchanged.`,
                    );
                  } catch (error: unknown) {
                    host.showError(
                      error instanceof CredentialSynchronizationError
                        ? `Credentials removed for ${providerOption.name}, but local model state could not be synchronized: ${toErrorMessage(error)}`
                        : `Logout failed: ${toErrorMessage(error)}`,
                    );
                  }
                }, this),
              ),
            () => {
              done();
              host.ui.requestRender();
            },
          );
          return { component: selector, focus: selector };
        });
      }, this),
    );
  }

  private getLogoutProviderOptions(): Effect.Effect<AuthSelectorProvider[]> {
    return awaitingWith(function* () {
      const { modelRuntime } = this.host.session;
      const credentials = yield* awaited(
        modelRuntime.listCredentials({
          signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
        }),
      );
      return credentials
        .map(({ providerId, type }) => {
          const provider = modelRuntime.getProvider(providerId);
          return {
            id: providerId,
            name: provider?.name ?? providerId,
            authType: type,
            status: { type, source: "stored credential" },
            subscription: provider?.auth.oauth?.isSubscription === true,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }, this);
  }

  private startProviderLogin(
    providerOption: AuthSelectorProvider,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (providerOption.authType === "oauth") {
        yield* performed(
          this.runLoginDialog(providerOption.id, providerOption.name, "oauth", onBack),
        );
      } else if (providerOption.method?.login === undefined) {
        this.showAmbientAuthDialog(providerOption, onBack);
      } else {
        yield* performed(
          this.runLoginDialog(providerOption.id, providerOption.name, "api_key", onBack),
        );
      }
    }, this);
  }

  private showAuthTypeSelector(providerOptions?: AuthSelectorProvider[]): void {
    const { host } = this;
    const oauthProvider = providerOptions?.find((provider) => provider.authType === "oauth");
    const oauthLoginLabel =
      oauthProvider?.method !== undefined && "loginLabel" in oauthProvider.method
        ? oauthProvider.method.loginLabel
        : undefined;
    const subscriptionLabel = oauthLoginLabel ?? "Sign in with an account";
    const apiKeyLabel = "Sign in with an API key";
    const availableAuthTypes =
      providerOptions === undefined
        ? new Set<AuthType>(["oauth", "api_key"])
        : new Set(providerOptions.map((provider) => provider.authType));
    const serviceLabel =
      providerOptions === undefined && host.session.getExternalServices().length > 0
        ? "Sign in to a service"
        : undefined;
    const options: string[] = [];
    if (availableAuthTypes.has("oauth")) options.push(subscriptionLabel);
    if (availableAuthTypes.has("api_key")) options.push(apiKeyLabel);
    if (serviceLabel !== undefined) options.push(serviceLabel);

    if (options.length === 0) {
      host.showStatus("No login methods available.");
      return;
    }

    if (providerOptions !== undefined && options.length === 1) {
      const providerOption = providerOptions[0];
      if (providerOption !== undefined) {
        void Effect.runFork(this.startProviderLogin(providerOption));
      }
      return;
    }

    const title =
      providerOptions?.[0] === undefined
        ? "Select authentication method:"
        : `Select authentication method for ${providerOptions[0].name}:`;
    LoginFlow.showAuthTypeSelectorPart1(
      this,
      host,
      serviceLabel,
      subscriptionLabel,
      providerOptions,
      title,
      options,
    );
  }

  private static showAuthTypeSelectorPart1(
    self: LoginFlow,
    host: LoginFlowHost,
    serviceLabel: "Sign in to a service" | undefined,
    subscriptionLabel: string,
    providerOptions: AuthSelectorProvider[] | undefined,
    title: string,
    options: string[],
  ): void {
    host.editorSlot.showSelector((done) => {
      const onSelect = (option: string) => {
        done();
        if (option === serviceLabel) {
          void Effect.runFork(self.showServiceSelector());
          return;
        }
        const authType = option === subscriptionLabel ? "oauth" : "api_key";
        if (providerOptions === undefined) {
          self.showProviderSelector(authType);
          return;
        }
        const providerOption = providerOptions.find((provider) => provider.authType === authType);
        if (providerOption !== undefined) {
          void Effect.runFork(
            self.startProviderLogin(providerOption, () =>
              self.showAuthTypeSelector(providerOptions),
            ),
          );
        }
      };
      const onCancel = () => {
        done();
        host.ui.requestRender();
      };
      const selector = new ExtensionSelectorComponent(title, options, onSelect, onCancel);
      return { component: selector, focus: selector, dispose: () => selector.dispose() };
    });
  }

  private showServiceSelector(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      const services = host.session.getExternalServices();
      const statuses = yield* awaited(
        Promise.all(services.map((service) => service.status().catch(() => undefined))),
      );
      const entries = services.map((service, index) => {
        const status = statuses[index];
        const state =
          status === undefined
            ? ""
            : status.installed
              ? status.signedIn
                ? "signed in"
                : ""
              : "not installed";
        return {
          service,
          label: `${service.name} · ${service.purpose}${state === "" ? "" : ` (${state})`}`,
        };
      });
      host.editorSlot.showSelector((done) => {
        const selector = new ExtensionSelectorComponent(
          "Select a service to sign in to:",
          entries.map((entry) => entry.label),
          (option) => {
            done();
            const entry = entries.find((candidate) => candidate.label === option);
            if (entry !== undefined)
              void Effect.runFork(
                this.loginService(
                  entry.service,
                  () => void Effect.runFork(this.showServiceSelector()),
                ),
              );
          },
          () => {
            done();
            this.showAuthTypeSelector();
          },
        );
        return { component: selector, focus: selector };
      });
    }, this);
  }

  private select(title: string, options: string[], after?: LoginDialogComponent): Promise<string> {
    const { host } = this;
    return Effect.runPromise(
      Effect.callback<string>((resume) => {
        host.editorSlot.showSelector((done) => {
          const finish = () => {
            done();
            if (after !== undefined) host.editorSlot.show(after);
          };
          const selector = new ExtensionSelectorComponent(
            title,
            options,
            (option) => {
              finish();
              resume(Effect.succeed(option));
            },
            () => {
              finish();
              resume(Effect.die(new Error(LOGIN_CANCELLED)));
            },
          );
          return { component: selector, focus: selector };
        });
      }),
    );
  }

  private loginService(service: ExternalService, onBack?: () => void): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      const status = yield* awaited(service.status().catch(() => undefined));
      const dialog = new LoginDialogComponent(
        host.ui,
        service.id,
        () => {
          host.editorSlot.restoreEditor();
          onBack?.();
        },
        service.name,
      );
      host.editorSlot.show(dialog);
      if (status !== undefined && !status.installed) {
        dialog.showInfo(
          `${service.name} provides ${service.purpose}. Install it first, then run /login ${service.id}:`,
          [],
        );
        dialog.showDetails([theme.fg("accent", `  ${status.install}`)]);
        dialog.showInfo("", [], true);
        return;
      }
      dialog.showWaiting(`Signing in to ${service.name}…`);
      host.programStatus.setBlocked("login", {
        kind: "auth",
        message: `Log in to ${service.name}`,
      });
      try {
        yield* awaited(
          service.login(
            {
              showPage: (page) => {
                dialog.showDetails([theme.fg("text", "Open this page to sign in:")]);
                dialog.showInfo("", [{ url: page.url }]);
                if (page.code !== undefined && page.code !== "") {
                  dialog.showInfo(`The page shows this code; check it matches: ${page.code}`);
                }
                dialog.showWaiting("Waiting for you to approve the sign-in…");
              },
              prompt: (message, placeholder) => dialog.showPrompt(message, placeholder),
              select: (title, options) => this.select(title, options, dialog),
            },
            dialog.signal,
          ),
        );
        host.editorSlot.restoreEditor();
        host.session.refreshExternalServiceTools();
        host.showStatus(`Signed in to ${service.name}; ${service.purpose} is available.`);
      } catch (error: unknown) {
        host.editorSlot.restoreEditor();
        const message = toErrorMessage(error);
        if (dialog.signal.aborted || message === LOGIN_CANCELLED) onBack?.();
        else host.showError(`Failed to sign in to ${service.name}: ${message}`);
      } finally {
        host.programStatus.setBlocked("login", undefined);
      }
    }, this);
  }

  private logoutService(service: ExternalService): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      try {
        yield* awaited(service.logout({ select: (title, options) => this.select(title, options) }));
        host.showStatus(
          `Signed out of ${service.name}. Its tools stay registered until /reload or a new session.`,
        );
      } catch (error: unknown) {
        const message = toErrorMessage(error);
        if (message !== LOGIN_CANCELLED) {
          host.showError(`Failed to sign out of ${service.name}: ${message}`);
        }
      }
    }, this);
  }

  private showProviderSelector(authType?: AuthType, initialSearchInput?: string): void {
    const { host } = this;
    const providerOptions = this.getProviderOptions(authType);
    if (providerOptions.length === 0) {
      host.showStatus(
        authType === "oauth"
          ? "No account providers available."
          : authType === "api_key"
            ? "No API key providers available."
            : "No login providers available.",
      );
      return;
    }

    host.editorSlot.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        "login",
        providerOptions,
        (providerId, selectedAuthType) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              const providerOption = providerOptions.find(
                (provider) => provider.id === providerId && provider.authType === selectedAuthType,
              );
              if (providerOption === undefined) {
                return;
              }
              yield* performed(
                this.startProviderLogin(providerOption, () =>
                  this.showProviderSelector(authType, initialSearchInput),
                ),
              );
            }, this),
          ),
        () => {
          done();
          if (authType === undefined) {
            host.ui.requestRender();
          } else {
            this.showAuthTypeSelector();
          }
        },
        initialSearchInput,
      );
      return { component: selector, focus: selector };
    });
  }

  completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: AuthType,
    previousModel: Model<any> | undefined,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { host, actionLabel, deferSelection, session } =
          LoginFlow.completeProviderAuthenticationHost(
            this,
            authType,
            providerName,
            previousModel,
            providerId,
          );
        const finishAuthentication = () =>
          Effect.runPromise(
            awaiting(function* () {
              let selectedModel: Model<any> | undefined;
              let selectionError: string | undefined;
              if (isUnknownModel(previousModel)) {
                const providerModels = host.session.modelRuntime
                  .getAvailableSnapshot()
                  .filter((model) => model.provider === providerId);
                if (providerId === "llama.cpp") {
                  selectionError = llamaCppPostLoginGuidance(actionLabel, providerModels.length);
                } else if (!hasDefaultModelProvider(providerId)) {
                  selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
                } else if (providerModels.length === 0) {
                  selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
                } else {
                  const defaultModelId = defaultModelPerProvider[providerId];
                  selectedModel = providerModels.find((model) => model.id === defaultModelId);
                  if (selectedModel === undefined) {
                    selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
                  } else {
                    try {
                      yield* awaited(host.session.setModel(selectedModel, { persist: true }));
                    } catch (error: unknown) {
                      selectedModel = undefined;
                      selectionError = `${actionLabel}, but selecting its default model failed: ${toErrorMessage(error)}. Use /model to select a model.`;
                    }
                  }
                }
              }

              host.refreshAuthState();
              if (selectedModel === undefined) {
                host.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
                if (selectionError !== undefined && selectionError !== "") {
                  host.showError(selectionError);
                }
              } else {
                host.showStatus(
                  `${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`,
                );
              }
            }),
          );
        yield* performed(
          completeProviderAuthenticationPart2(
            deferSelection,
            host,
            actionLabel,
            finishAuthentication,
          ),
        );

        Effect.runFork(
          awaiting(function* () {
            const controller = new AbortController();
            const timeout = schedule(() => controller.abort(), CREDENTIAL_TIMEOUT_MS);
            try {
              const result = yield* awaited(
                session.modelRuntime.refresh({
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
      }, this),
    );
  }

  private static completeProviderAuthenticationHost(
    self: LoginFlow,
    authType: "oauth" | "api_key",
    providerName: string,
    previousModel: Model<any> | undefined,
    providerId: string,
  ): { host: LoginFlowHost; actionLabel: string; deferSelection: boolean; session: AgentSession } {
    const { host } = self;
    const actionLabel =
      authType === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;

    const session = host.session;
    const deferSelection =
      isUnknownModel(previousModel) &&
      hasDefaultModelProvider(providerId) &&
      !session.modelRuntime
        .getAvailableSnapshot()
        .some(
          (model) =>
            model.provider === providerId && model.id === defaultModelPerProvider[providerId],
        );
    return { host, actionLabel, deferSelection, session };
  }

  private showAmbientAuthDialog(providerOption: AuthSelectorProvider, onBack?: () => void): void {
    const { host } = this;
    const dialog = new LoginDialogComponent(
      host.ui,
      providerOption.id,
      () => {
        host.editorSlot.restoreEditor();
        onBack?.();
      },
      providerOption.name,
      `${providerOption.name} setup`,
    );
    dialog.showInfo(
      `${providerOption.method?.name ?? "Authentication"} is configured outside ${APP_NAME}.`,
      [],
      true,
    );
    host.editorSlot.show(dialog);
  }

  private runLoginDialog(
    providerId: string,
    providerName: string,
    method: AuthType,
    onBack?: () => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      const previousModel = host.session.model;
      const dialog = new LoginDialogComponent(host.ui, providerId, () => {}, providerName);
      host.editorSlot.show(dialog);

      const actionLabel =
        method === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;
      try {
        yield* performed(this.loginProvider(dialog, providerId, providerName, method));
        host.editorSlot.restoreEditor();
        yield* awaited(
          this.completeProviderAuthentication(providerId, providerName, method, previousModel),
        );
      } catch (error: unknown) {
        host.editorSlot.restoreEditor();
        const message = toErrorMessage(error);
        if (error instanceof CredentialSynchronizationError) {
          host.showError(
            `${actionLabel}, but local model state could not be synchronized: ${message}`,
          );
        } else if (dialog.signal.aborted || message === LOGIN_CANCELLED) {
          onBack?.();
        } else if (method === "oauth") {
          host.showError(`Failed to login to ${providerName}: ${message}`);
        } else {
          host.showError(`Failed to save API key for ${providerName}: ${message}`);
        }
      }
    }, this);
  }

  private loginProvider(
    dialog: LoginDialogComponent,
    providerId: string,
    providerName: string,
    method: AuthType,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { host } = this;
      host.programStatus.setBlocked("login", {
        kind: "auth",
        message: `Log in to ${providerName}`,
      });
      try {
        yield* awaited(
          host.session.modelRuntime.login(
            providerId,
            method,
            {
              signal: dialog.signal,
              prompt: (prompt) => Effect.runPromise(this.showAuthPrompt(dialog, prompt)),
              notify: (event) => notifyAuthDialog(dialog, event),
            },
            { getDeviceId: () => host.session.settingsManager.getOrCreateDeviceId() },
          ),
        );
      } finally {
        host.programStatus.setBlocked("login", undefined);
      }
    }, this);
  }

  private showAuthPrompt(dialog: LoginDialogComponent, prompt: AuthPrompt): Effect.Effect<string> {
    return awaitingWith(function* () {
      let response: Promise<string>;
      if (prompt.type === "select") {
        response = this.showAuthSelect(dialog, prompt);
      } else if (prompt.type === "manual_code") {
        response = dialog.showManualInput(prompt.message);
      } else {
        response = dialog.showPrompt(prompt.message, prompt.placeholder);
      }
      if (prompt.signal === undefined) return yield* awaited(response);
      if (prompt.signal.aborted) throw new Error(LOGIN_CANCELLED);
      const signal = prompt.signal;
      const aborted = Effect.callback<string>((resume) => {
        const onAbort = () => resume(Effect.die(new Error(LOGIN_CANCELLED)));
        signal.addEventListener("abort", onAbort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", onAbort));
      });
      return yield* performed(
        Effect.raceFirst(
          Effect.promise(() => response),
          aborted,
        ),
      );
    }, this);
  }

  private showAuthSelect(
    dialog: LoginDialogComponent,
    prompt: Extract<AuthPrompt, { type: "select" }>,
  ): Promise<string> {
    const { host } = this;
    return Effect.runPromise(
      Effect.callback<string>((resume) => {
        const selector = new ExtensionSelectorComponent(
          prompt.message,
          prompt.options.map((option) => option.label),
          (optionLabel) => {
            host.editorSlot.show(dialog);
            const id = prompt.options.find((option) => option.label === optionLabel)?.id;
            if (id !== undefined && id !== "") resume(Effect.succeed(id));
            else resume(Effect.die(new Error(LOGIN_CANCELLED)));
          },
          () => {
            host.editorSlot.show(dialog);
            resume(Effect.die(new Error(LOGIN_CANCELLED)));
          },
        );
        host.editorSlot.show(selector);
      }),
    );
  }
}

function completeProviderAuthenticationPart2(
  deferSelection: boolean,
  host: LoginFlowHost,
  actionLabel: string,
  finishAuthentication: () => Promise<void>,
): Effect.Effect<void> {
  return awaiting(function* () {
    if (deferSelection) {
      host.showStatus(
        `${actionLabel}. Credentials saved to ${getAuthPath()}. Refreshing model catalog…`,
      );
    } else {
      yield* awaited(finishAuthentication());
    }
  });
}

function notifyAuthDialog(dialog: LoginDialogComponent, event: AuthEvent): void {
  if (event.type === "auth_url") {
    dialog.showAuth(event.url, event.instructions);
  } else if (event.type === "device_code") {
    dialog.showDeviceCode(event);
    dialog.showWaiting("Waiting for authentication...");
  } else if (event.type === "info") {
    dialog.showInfo(event.message, event.links);
  } else {
    dialog.showProgress(event.message);
  }
}
