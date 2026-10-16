import type { Component, Container, TUI } from "@msa/tui";

/** Builds a selector that replaces the editor. `done` puts the editor back. */
export type SelectorFactory = (done: () => void) => {
  component: Component;
  focus: Component;
  dispose?: () => void;
};

/**
 * The area below the transcript that holds the editor, or a dialog or selector shown in its place.
 * At most one selector is active; opening another disposes the previous one.
 */
export class EditorSlot {
  private readonly container: Container;
  private readonly ui: TUI;
  private readonly getEditor: () => Component;
  private activeSelectorToken: object | undefined;
  private activeSelectorDispose: (() => void) | undefined;

  constructor(container: Container, ui: TUI, getEditor: () => Component) {
    this.container = container;
    this.ui = ui;
    this.getEditor = getEditor;
  }

  /** Shows `component` in place of the editor and focuses `focus`. */
  show(component: Component, focus: Component = component): void {
    this.container.clear();
    this.container.addChild(component);
    this.ui.setFocus(focus);
    this.ui.requestRender();
  }

  restoreEditor(): void {
    this.show(this.getEditor());
  }

  showSelector(create: SelectorFactory): void {
    const token = {};
    let dispose: (() => void) | undefined;
    const done = () => {
      dispose?.();
      if (this.activeSelectorToken !== token) return;
      this.activeSelectorToken = undefined;
      this.activeSelectorDispose = undefined;
      this.restoreEditor();
    };
    const created = create(done);
    dispose = created.dispose;
    this.disposeActiveSelector();
    this.activeSelectorToken = token;
    this.activeSelectorDispose = dispose;
    this.show(created.component, created.focus);
  }

  disposeActiveSelector(): void {
    const dispose = this.activeSelectorDispose;
    this.activeSelectorToken = undefined;
    this.activeSelectorDispose = undefined;
    dispose?.();
  }
}
