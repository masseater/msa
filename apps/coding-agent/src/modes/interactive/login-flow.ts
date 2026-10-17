import * as path from "node:path";

import type { AuthEvent, AuthPrompt } from "@msa/ai";
import type { Model } from "@msa/ai/compat";
import type { TUI } from "@msa/tui";

import { APP_NAME, getAgentDir, getAuthPath, getDocsPath } from "../../config.ts";
import type { AgentSession } from "../../core/agent-session.ts";
import { type ExternalService, findExternalService } from "../../core/external-services.ts";
import type { McpHttpServerConfig } from "../../core/mcp-servers.ts";
import { defaultModelPerProvider } from "../../core/model-resolver.ts";
import { CredentialSynchronizationError } from "../../core/model-runtime.ts";
import { RADIUS_MCP_URL, RADIUS_PROVIDER_ID } from "../../core/radius.ts";
import { addMcpServerConfig, loadMcpConfig } from "../../extensions/mcp/config.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import { LoginDialogComponent } from "./components/login-dialog.ts";
import {
  type AuthSelectorProvider,
  formatAuthSelectorProviderStatus,
  formatAuthSelectorProviderType,
  OAuthSelectorComponent,
} from "./components/oauth-selector.ts";
import { createLoginMenuSelector } from "./components/radius-login-selector.ts";
import type { EditorSlot } from "./editor-slot.ts";
import type { ProgramStatusReporter } from "./program-status-reporter.ts";
import { theme } from "./theme/theme.ts";

const RADIUS_LOGIN_INTRO =
  "Radius is a service crafted for msa by the builders of msa, Earendil Works";

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
  subscription?: boolean;
};

/** Collapses per-auth-type provider options into one completion entry per provider. */
export function getLoginProviderCompletionOptions(
  providerOptions: readonly AuthSelectorProvider[],
): LoginProviderCompletionOption[] {
  const byId = new Map<string, LoginProviderCompletionOption>();
  for (const provider of providerOptions) {
    const existing = byId.get(provider.id);
    if (existing) {
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
    !!model && model.provider === "unknown" && model.id === "unknown" && model.api === "unknown"
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

/** What the login flow needs from the interactive mode that hosts it. */
export interface LoginFlowHost {
  readonly ui: TUI;
  readonly session: AgentSession;
  readonly programStatus: ProgramStatusReporter;
  readonly editorSlot: EditorSlot;
  showStatus(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  /** Refreshes the UI that depends on which providers have credentials. */
  refreshAuthState(): void;
  reload(): Promise<void>;
}

/** The `/login` and `/logout` dialogs: provider selection, credential prompts, and post-login model selection. */
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
      const status = authStatus.configured
        ? {
            type: modelRuntime.isUsingOAuth(provider.id)
              ? ("oauth" as const)
              : ("api_key" as const),
            source: authStatus.label ?? authStatus.source,
          }
        : undefined;
      const subscription = provider.auth.oauth?.isSubscription === true;
      if ((!authType || authType === "oauth") && provider.auth.oauth) {
        options.push({
          id: provider.id,
          name: provider.name,
          authType: "oauth",
          method: provider.auth.oauth,
          status,
          subscription,
        });
      }
      if ((!authType || authType === "api_key") && provider.auth.apiKey) {
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

  /** Starts `/login`, optionally for a provider named by id or display name. */
  async login(providerRef?: string): Promise<void> {
    const normalizedRef = providerRef?.trim().toLowerCase();
    if (!normalizedRef) {
      this.showAuthTypeSelector();
      return;
    }
    const service = findExternalService(this.host.session.getExternalServices(), normalizedRef);
    if (service) {
      await this.loginService(service);
      return;
    }

    const providerOptions = this.getProviderOptions().filter(
      (provider) =>
        provider.id.toLowerCase() === normalizedRef ||
        provider.name.toLowerCase() === normalizedRef,
    );
    if (providerOptions.length === 1) {
      await this.startProviderLogin(providerOptions[0]!);
      return;
    }
    if (new Set(providerOptions.map((provider) => provider.id)).size === 1) {
      this.showAuthTypeSelector(providerOptions);
      return;
    }
    this.showProviderSelector(undefined, providerRef);
  }

  async logout(): Promise<void> {
    const { host } = this;
    let providerOptions: AuthSelectorProvider[];
    try {
      providerOptions = await this.getLogoutProviderOptions();
    } catch (error) {
      host.showError(`Could not read stored credentials: ${toErrorMessage(error)}`);
      return;
    }
    const allServices = host.session.getExternalServices();
    const statuses = await Promise.all(
      allServices.map((service) => service.status().catch(() => undefined)),
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
        async (providerId: string) => {
          done();
          const providerOption = providerOptions.find((provider) => provider.id === providerId);
          if (!providerOption) {
            return;
          }
          const service = services.find((candidate) => candidate.id === providerId);
          if (service) {
            await this.logoutService(service);
            return;
          }
          try {
            await host.session.modelRuntime.logout(providerOption.id, {
              signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
            });
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
        },
        () => {
          done();
          host.ui.requestRender();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private async getLogoutProviderOptions(): Promise<AuthSelectorProvider[]> {
    const { modelRuntime } = this.host.session;
    const credentials = await modelRuntime.listCredentials({
      signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
    });
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
  }

  /** `onBack` reopens the selector the login was started from when the user cancels it. */
  private async startProviderLogin(
    providerOption: AuthSelectorProvider,
    onBack?: () => void,
  ): Promise<void> {
    if (providerOption.authType === "oauth") {
      await this.runLoginDialog(providerOption.id, providerOption.name, "oauth", onBack);
    } else if (providerOption.method?.login) {
      await this.runLoginDialog(providerOption.id, providerOption.name, "api_key", onBack);
    } else {
      this.showAmbientAuthDialog(providerOption, onBack);
    }
  }

  private showAuthTypeSelector(providerOptions?: AuthSelectorProvider[]): void {
    const { host } = this;
    // The top-level selector offers Radius directly, as its last option.
    const radiusOption = providerOptions
      ? undefined
      : this.getProviderOptions("oauth").find((provider) => provider.id === RADIUS_PROVIDER_ID);
    const radiusText = radiusOption ? `Sign in with ${radiusOption.name}` : undefined;
    const radiusLabel = radiusOption
      ? `${radiusText}${formatAuthSelectorProviderStatus(radiusOption)}`
      : undefined;
    const oauthProvider = providerOptions?.find((provider) => provider.authType === "oauth");
    const oauthLoginLabel =
      oauthProvider?.method && "loginLabel" in oauthProvider.method
        ? oauthProvider.method.loginLabel
        : undefined;
    const subscriptionLabel = oauthLoginLabel ?? "Sign in with an account";
    const apiKeyLabel = "Sign in with an API key";
    const availableAuthTypes = providerOptions
      ? new Set(providerOptions.map((provider) => provider.authType))
      : new Set<AuthType>(["oauth", "api_key"]);
    const serviceLabel =
      !providerOptions && host.session.getExternalServices().length > 0
        ? "Sign in to a service"
        : undefined;
    const options: string[] = [];
    if (availableAuthTypes.has("oauth")) options.push(subscriptionLabel);
    if (availableAuthTypes.has("api_key")) options.push(apiKeyLabel);
    if (serviceLabel) options.push(serviceLabel);
    if (radiusLabel) options.push(radiusLabel);

    if (options.length === 0) {
      host.showStatus("No login methods available.");
      return;
    }

    if (providerOptions && options.length === 1) {
      const providerOption = providerOptions[0];
      if (providerOption) {
        void this.startProviderLogin(providerOption);
      }
      return;
    }

    const title = providerOptions?.[0]
      ? `Select authentication method for ${providerOptions[0].name}:`
      : "Select authentication method:";
    host.editorSlot.showSelector((done) => {
      const onSelect = (option: string) => {
        done();
        if (option === serviceLabel) {
          void this.showServiceSelector();
          return;
        }
        if (radiusOption && option === radiusLabel) {
          void this.startProviderLogin(radiusOption, () => this.showAuthTypeSelector());
          return;
        }
        const authType = option === subscriptionLabel ? "oauth" : "api_key";
        if (!providerOptions) {
          this.showProviderSelector(authType);
          return;
        }
        const providerOption = providerOptions.find((provider) => provider.authType === authType);
        if (providerOption) {
          void this.startProviderLogin(providerOption, () =>
            this.showAuthTypeSelector(providerOptions),
          );
        }
      };
      const onCancel = () => {
        done();
        host.ui.requestRender();
      };
      const selector =
        radiusLabel && radiusText
          ? createLoginMenuSelector(
              host.ui,
              title,
              options,
              { label: radiusLabel, text: radiusText },
              onSelect,
              onCancel,
            )
          : new ExtensionSelectorComponent(title, options, onSelect, onCancel);
      return { component: selector, focus: selector, dispose: () => selector.dispose() };
    });
  }

  private async showServiceSelector(): Promise<void> {
    const { host } = this;
    const services = host.session.getExternalServices();
    const statuses = await Promise.all(
      services.map((service) => service.status().catch(() => undefined)),
    );
    const entries = services.map((service, index) => {
      const status = statuses[index];
      const state = !status
        ? ""
        : !status.installed
          ? "not installed"
          : status.signedIn
            ? "signed in"
            : "";
      return {
        service,
        label: `${service.name} · ${service.purpose}${state ? ` (${state})` : ""}`,
      };
    });
    host.editorSlot.showSelector((done) => {
      const selector = new ExtensionSelectorComponent(
        "Select a service to sign in to:",
        entries.map((entry) => entry.label),
        (option) => {
          done();
          const entry = entries.find((candidate) => candidate.label === option);
          if (entry) void this.loginService(entry.service, () => void this.showServiceSelector());
        },
        () => {
          done();
          this.showAuthTypeSelector();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  /** Asks the user to pick an option in the editor slot, then shows `after` again if given. */
  private select(title: string, options: string[], after?: LoginDialogComponent): Promise<string> {
    const { host } = this;
    return new Promise((resolve, reject) => {
      host.editorSlot.showSelector((done) => {
        const finish = () => {
          done();
          if (after) host.editorSlot.show(after);
        };
        const selector = new ExtensionSelectorComponent(
          title,
          options,
          (option) => {
            finish();
            resolve(option);
          },
          () => {
            finish();
            reject(new Error(LOGIN_CANCELLED));
          },
        );
        return { component: selector, focus: selector };
      });
    });
  }

  /** Signs in to an external service through its own sign-in, then registers the tools it brings. */
  private async loginService(service: ExternalService, onBack?: () => void): Promise<void> {
    const { host } = this;
    const status = await service.status().catch(() => undefined);
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
    if (status && !status.installed) {
      dialog.showInfo(
        `${service.name} provides ${service.purpose}. Install it first, then run /login ${service.id}:`,
        [],
      );
      dialog.showDetails([theme.fg("accent", `  ${status.install}`)]);
      dialog.showInfo("", [], true);
      return;
    }
    dialog.showWaiting(`Signing in to ${service.name}…`);
    host.programStatus.setBlocked("login", { kind: "auth", message: `Log in to ${service.name}` });
    try {
      await service.login(
        {
          showPage: (page) => {
            dialog.showDetails([theme.fg("text", "Open this page to sign in:")]);
            dialog.showInfo("", [{ url: page.url }]);
            if (page.code) {
              dialog.showInfo(`The page shows this code; check it matches: ${page.code}`);
            }
            dialog.showWaiting("Waiting for you to approve the sign-in…");
          },
          prompt: (message, placeholder) => dialog.showPrompt(message, placeholder),
          select: (title, options) => this.select(title, options, dialog),
        },
        dialog.signal,
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
  }

  private async logoutService(service: ExternalService): Promise<void> {
    const { host } = this;
    try {
      await service.logout({ select: (title, options) => this.select(title, options) });
      host.showStatus(
        `Signed out of ${service.name}. Its tools stay registered until /reload or a new session.`,
      );
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      if (message !== LOGIN_CANCELLED) {
        host.showError(`Failed to sign out of ${service.name}: ${message}`);
      }
    }
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
        async (providerId, selectedAuthType) => {
          done();
          const providerOption = providerOptions.find(
            (provider) => provider.id === providerId && provider.authType === selectedAuthType,
          );
          if (!providerOption) {
            return;
          }
          await this.startProviderLogin(providerOption, () =>
            this.showProviderSelector(authType, initialSearchInput),
          );
        },
        () => {
          done();
          if (authType) {
            this.showAuthTypeSelector();
          } else {
            host.ui.requestRender();
          }
        },
        initialSearchInput,
      );
      return { component: selector, focus: selector };
    });
  }

  /**
   * Reports the saved credentials and, when the session has no real model yet, selects the provider's
   * default model. Dynamic catalogs may be empty until the first authenticated refresh, so selection
   * then waits for the bounded background refresh.
   */
  async completeProviderAuthentication(
    providerId: string,
    providerName: string,
    authType: AuthType,
    previousModel: Model<any> | undefined,
  ): Promise<void> {
    const { host } = this;
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
    const finishAuthentication = async () => {
      let selectedModel: Model<any> | undefined;
      let selectionError: string | undefined;
      if (isUnknownModel(previousModel)) {
        const providerModels = host.session.modelRuntime
          .getAvailableSnapshot()
          .filter((model) => model.provider === providerId);
        // Matches LLAMA_PROVIDER_ID from extensions/llama/provider.ts; kept inline to avoid coupling interactive mode to the built-in extension.
        if (providerId === "llama.cpp") {
          selectionError = llamaCppPostLoginGuidance(actionLabel, providerModels.length);
        } else if (!hasDefaultModelProvider(providerId)) {
          selectionError = `${actionLabel}, but no default model is configured for provider "${providerId}". Use /model to select a model.`;
        } else if (providerModels.length === 0) {
          selectionError = `${actionLabel}, but no models are available for that provider. Use /model to select a model.`;
        } else {
          const defaultModelId = defaultModelPerProvider[providerId];
          // Radius catalogs vary by account; prefer balanced, then use catalog order.
          selectedModel =
            providerModels.find((model) => model.id === defaultModelId) ??
            (providerId === "radius" ? providerModels[0] : undefined);
          if (!selectedModel) {
            selectionError = `${actionLabel}, but its default model "${defaultModelId}" is not available. Use /model to select a model.`;
          } else {
            try {
              await host.session.setModel(selectedModel, { persist: true });
            } catch (error: unknown) {
              selectedModel = undefined;
              selectionError = `${actionLabel}, but selecting its default model failed: ${toErrorMessage(error)}. Use /model to select a model.`;
            }
          }
        }
      }

      host.refreshAuthState();
      if (selectedModel) {
        host.showStatus(
          `${actionLabel}. Selected ${selectedModel.id}. Credentials saved to ${getAuthPath()}`,
        );
      } else {
        host.showStatus(`${actionLabel}. Credentials saved to ${getAuthPath()}`);
        if (selectionError) {
          host.showError(selectionError);
        }
      }
    };
    if (deferSelection) {
      host.showStatus(
        `${actionLabel}. Credentials saved to ${getAuthPath()}. Refreshing model catalog…`,
      );
    } else {
      await finishAuthentication();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CREDENTIAL_TIMEOUT_MS);
    void session.modelRuntime
      .refresh({ providers: [providerId], signal: controller.signal })
      .then(async (result) => {
        if (result.aborted) {
          host.showWarning(
            `${actionLabel}, but its model catalog refresh timed out; using cached models.`,
          );
        } else if (result.errors.size > 0) {
          host.showWarning(
            `${actionLabel}, but its model catalog could not be refreshed; using cached models.`,
          );
        }
        // Do not replace a model or session selected while the refresh was running.
        if (deferSelection && host.session === session && session.model === previousModel) {
          await finishAuthentication();
        }
        host.refreshAuthState();
      })
      .catch((error: unknown) => {
        host.showWarning(
          `${actionLabel}, but its model catalog could not be refreshed: ${toErrorMessage(error)}`,
        );
      })
      .finally(() => clearTimeout(timeout));
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

  private async runLoginDialog(
    providerId: string,
    providerName: string,
    method: AuthType,
    onBack?: () => void,
  ): Promise<void> {
    const { host } = this;
    const previousModel = host.session.model;
    const dialog = new LoginDialogComponent(host.ui, providerId, () => {}, providerName);
    if (method === "api_key" && providerId === "amazon-bedrock") {
      dialog.showDetails([
        theme.fg("text", "You can also use an AWS profile, IAM keys, or role-based credentials."),
        theme.fg("muted", "See:"),
        theme.fg("accent", `  ${path.join(getDocsPath(), "providers.md")}`),
      ]);
    }
    host.editorSlot.show(dialog);

    const actionLabel =
      method === "oauth" ? `Logged in to ${providerName}` : `Saved API key for ${providerName}`;
    try {
      await this.loginProvider(dialog, providerId, providerName, method);
      host.editorSlot.restoreEditor();
      await this.completeProviderAuthentication(providerId, providerName, method, previousModel);
      if (method === "oauth" && providerId === RADIUS_PROVIDER_ID) {
        this.offerRadiusMcpServer(providerId, providerName);
      }
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
  }

  private async loginProvider(
    dialog: LoginDialogComponent,
    providerId: string,
    providerName: string,
    method: AuthType,
  ): Promise<void> {
    const { host } = this;
    host.programStatus.setBlocked("login", { kind: "auth", message: `Log in to ${providerName}` });
    try {
      await host.session.modelRuntime.login(
        providerId,
        method,
        {
          signal: dialog.signal,
          prompt: (prompt) => this.showAuthPrompt(dialog, prompt, providerId),
          notify: (event) => notifyAuthDialog(dialog, event),
        },
        { getDeviceId: () => host.session.settingsManager.getOrCreateDeviceId() },
      );
    } finally {
      host.programStatus.setBlocked("login", undefined);
    }
  }

  private async showAuthPrompt(
    dialog: LoginDialogComponent,
    prompt: AuthPrompt,
    providerId: string,
  ): Promise<string> {
    let response: Promise<string>;
    if (prompt.type === "select") {
      response = this.showAuthSelect(dialog, prompt, providerId);
    } else if (prompt.type === "manual_code") {
      response = dialog.showManualInput(prompt.message);
    } else {
      response = dialog.showPrompt(prompt.message, prompt.placeholder);
    }
    if (!prompt.signal) return response;
    if (prompt.signal.aborted) throw new Error(LOGIN_CANCELLED);
    const signal = prompt.signal;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<string>((_resolve, reject) => {
      onAbort = () => reject(new Error(LOGIN_CANCELLED));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([response, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private showAuthSelect(
    dialog: LoginDialogComponent,
    prompt: Extract<AuthPrompt, { type: "select" }>,
    providerId: string,
  ): Promise<string> {
    const { host } = this;
    return new Promise((resolve, reject) => {
      const selector = new ExtensionSelectorComponent(
        prompt.message,
        prompt.options.map((option) => option.label),
        (optionLabel) => {
          host.editorSlot.show(dialog);
          const id = prompt.options.find((option) => option.label === optionLabel)?.id;
          if (id) resolve(id);
          else reject(new Error(LOGIN_CANCELLED));
        },
        () => {
          host.editorSlot.show(dialog);
          reject(new Error(LOGIN_CANCELLED));
        },
        { description: providerId === RADIUS_PROVIDER_ID ? RADIUS_LOGIN_INTRO : undefined },
      );
      host.editorSlot.show(selector);
    });
  }

  /**
   * Offer to point the Radius MCP server in the global mcp.json at the Radius login, adding the server
   * when missing. Nothing is asked when a global server already uses this login.
   */
  private offerRadiusMcpServer(providerId: string, providerName: string): void {
    const { host } = this;
    const mcpPath = path.join(getAgentDir(), "mcp.json");
    const normalizeUrl = (url: string) => url.replace(/\/+$/u, "");
    const { servers } = loadMcpConfig({
      agentDir: getAgentDir(),
      cwd: host.session.sessionManager.getCwd(),
      projectTrusted: false,
    });
    const existing = servers.find(
      (server) =>
        "url" in server.config && normalizeUrl(server.config.url) === normalizeUrl(RADIUS_MCP_URL),
    );
    if (existing && "url" in existing.config && existing.config.auth?.provider === providerId)
      return;

    let name = existing?.name ?? "radius";
    if (!existing && servers.some((server) => server.name === name)) name = "radius-mcp";
    const config: McpHttpServerConfig =
      existing && "url" in existing.config
        ? { ...existing.config, auth: { provider: providerId } }
        : { url: RADIUS_MCP_URL, auth: { provider: providerId } };
    // `auth` replaces the MCP OAuth sign-in.
    delete config.oauth;

    host.editorSlot.showSelector((done) => {
      const selector = new ExtensionSelectorComponent(
        `Configure ${providerName} MCP in ${mcpPath}?`,
        ["Yes", "No"],
        (option) => {
          done();
          if (option !== "Yes") return;
          try {
            addMcpServerConfig(mcpPath, name, config);
          } catch (error: unknown) {
            host.showError(`Could not update ${mcpPath}: ${toErrorMessage(error)}`);
            return;
          }
          // The MCP extension reads mcp.json when the session starts.
          void host.reload();
        },
        () => {
          done();
          host.ui.requestRender();
        },
      );
      return { component: selector, focus: selector };
    });
  }
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
