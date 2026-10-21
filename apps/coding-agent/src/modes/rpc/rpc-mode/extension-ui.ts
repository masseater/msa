import { Effect, Option } from "effect";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import platform from "../../../core/platform/index.ts";
import themeModule from "../../interactive/theme/theme.ts";
import type themeTypes from "../../interactive/theme/theme.types.ts";
import type rpcTypesTypes from "../rpc-types.ts";
import rpcOutput from "./rpc-output.ts";

const { randomUuid } = platform;
const { theme } = themeModule;
const { output } = rpcOutput;

type UiContext = extensionsTypes.ExtensionUIContext;
type Response = rpcTypesTypes.RpcExtensionUIResponse;
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

const request = (fields: Record<string, unknown>): void => {
  output({ type: "extension_ui_request", ...fields } as rpcTypesTypes.RpcExtensionUIRequest);
};

const valueOf = (response: Response): string | undefined =>
  "cancelled" in response && response.cancelled
    ? undefined
    : "value" in response
      ? response.value
      : undefined;

const unsupported = {
  addAutocompleteProvider(): void {},
  custom() {
    return undefined as never;
  },
  getAllThemes() {
    return [];
  },
  getEditorComponent() {
    return undefined;
  },
  getEditorText(): string {
    return "";
  },
  getTheme(_name: string) {
    return undefined;
  },
  getToolsExpanded() {
    return false;
  },
  onTerminalInput(): () => void {
    return () => {};
  },
  setEditorComponent(): void {},
  setFooter(_factory: unknown): void {},
  setHeader(_factory: unknown): void {},
  setHiddenThinkingLabel(_label?: string): void {},
  setTheme(_theme: string | themeTypes.Theme) {
    return { error: "Theme switching not supported in RPC mode", success: false };
  },
  setToolsExpanded(_expanded: boolean) {},
  setWorkingIndicator(_options?: extensionsTypes.WorkingIndicatorOptions): void {},
  setWorkingMessage(_message?: string): void {},
  setWorkingVisible(_visible: boolean): void {},
} satisfies Partial<UiContext>;

const notifications = {
  notify(message: string, type?: "info" | "warning" | "error"): void {
    request({ id: randomUuid(), message, method: "notify", notifyType: type });
  },
  pasteToEditor(this: UiContext, text: string): void {
    this.setEditorText(text);
  },
  setEditorText(text: string): void {
    request({ id: randomUuid(), method: "set_editor_text", text });
  },
  setStatus(key: string, text: string | undefined): void {
    request({ id: randomUuid(), method: "setStatus", statusKey: key, statusText: text });
  },
  setTitle(title: string): void {
    request({ id: randomUuid(), method: "setTitle", title });
  },
  setWidget(key: string, content: unknown, options?: extensionsTypes.ExtensionWidgetOptions): void {
    if (content === undefined || Array.isArray(content)) {
      request({
        id: randomUuid(),
        method: "setWidget",
        widgetKey: key,
        widgetLines: content as string[] | undefined,
        widgetPlacement: options?.placement,
      });
    }
  },
} satisfies Partial<UiContext>;

export default class RpcExtensionUi {
  private readonly pending = new Map<string, Pending>();

  resolve(response: Response): void {
    const pending = this.pending.get(response.id);
    if (pending === undefined) return;
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  context(): UiContext {
    return {
      ...unsupported,
      ...notifications,
      ...this.dialogs(),
      get theme() {
        return theme;
      },
    };
  }

  private dialogs(): Pick<UiContext, "confirm" | "editor" | "input" | "select"> {
    return {
      confirm: (title, message, opts) =>
        this.dialog(
          opts,
          false,
          { message, method: "confirm", timeout: opts?.timeout, title },
          (r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
        ),
      editor: (title, prefill) => this.editor(title, prefill),
      input: (title, placeholder, opts) =>
        this.dialog(
          opts,
          undefined,
          { method: "input", placeholder, timeout: opts?.timeout, title },
          valueOf,
        ),
      select: (title, options, opts) =>
        this.dialog(
          opts,
          undefined,
          { method: "select", options, timeout: opts?.timeout, title },
          valueOf,
        ),
    };
  }

  private dialog<T>(
    opts: extensionsTypes.ExtensionUIDialogOptions | undefined,
    defaultValue: T,
    fields: Record<string, unknown>,
    parseResponse: (response: Response) => T,
  ): Promise<T> {
    if (opts?.signal?.aborted === true) return Promise.resolve(defaultValue);
    const id = randomUuid();
    const response = Effect.callback<T, Error>((resume) => {
      const onAbort = () => resume(Effect.succeed(defaultValue));
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        reject: (failure: Error) => resume(Effect.fail(failure)),
        resolve: (extensionResponse: Response) =>
          resume(Effect.succeed(parseResponse(extensionResponse))),
      });
      request({ id, ...fields });
      return Effect.sync(() => {
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
      });
    });
    const timeoutMs = opts?.timeout;
    const bounded: Effect.Effect<T, Error> =
      timeoutMs === undefined || timeoutMs === 0
        ? response
        : response.pipe(
            Effect.timeoutOption(timeoutMs),
            Effect.map(Option.getOrElse(() => defaultValue)),
          );
    return Effect.runPromise(bounded);
  }

  private editor(title: string, prefill: string | undefined): Promise<string | undefined> {
    const id = randomUuid();
    return Effect.runPromise(
      Effect.callback<string | undefined, Error>((resume) => {
        this.pending.set(id, {
          reject: (failure: Error) => resume(Effect.fail(failure)),
          resolve: (response: Response) => {
            const text =
              "value" in response && !("cancelled" in response && response.cancelled === true)
                ? response.value
                : undefined;
            resume(Effect.succeed(text));
          },
        });
        request({ id, method: "editor", prefill, title });
      }),
    );
  }
}
