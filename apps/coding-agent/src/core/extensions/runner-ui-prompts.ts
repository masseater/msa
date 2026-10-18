import type { RunnerEmitEvent } from "./runner-types.ts";
import type { ExtensionUIContext, UIPromptKind } from "./types.ts";

type UIPromptEvent = Extract<RunnerEmitEvent, { type: "ui_prompt_start" | "ui_prompt_end" }>;

export class UIPromptTracker {
  private depth = 0;
  private active: { kind: UIPromptKind; title?: string | undefined } | undefined;
  private readonly emitEvent: (event: UIPromptEvent) => void;

  constructor(emitEvent: (event: UIPromptEvent) => void) {
    this.emitEvent = emitEvent;
  }

  wrap(ui: ExtensionUIContext): ExtensionUIContext {
    return {
      ...ui,
      select: (title, options, opts) =>
        this.track("select", title, () => ui.select(title, options, opts)),
      confirm: (title, message, opts) =>
        this.track("confirm", title, () => ui.confirm(title, message, opts)),
      input: (title, placeholder, opts) =>
        this.track("input", title, () => ui.input(title, placeholder, opts)),
      editor: (title, prefill) => this.track("editor", title, () => ui.editor(title, prefill)),
      custom: (factory, options) =>
        this.track("custom", undefined, () => ui.custom(factory, options)),
    };
  }

  private track<T>(
    kind: UIPromptKind,
    title: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    if (this.depth++ === 0) {
      this.active = { kind, title };
      this.emitEvent({
        type: "ui_prompt_start",
        reason: "ui_prompt",
        kind,
        ...(title !== undefined && title !== "" ? { title } : {}),
      });
    }
    const finish = () => this.finish(kind, title);
    try {
      return run().finally(finish);
    } catch (err) {
      finish();
      throw err;
    }
  }

  private finish(kind: UIPromptKind, title: string | undefined): void {
    if (--this.depth > 0) return;
    this.depth = 0;
    const prompt = this.active ?? { kind, title };
    this.active = undefined;
    this.emitEvent({
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: prompt.kind,
      ...(prompt.title !== undefined && prompt.title !== "" ? { title: prompt.title } : {}),
    });
  }
}
