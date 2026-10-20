import type tuiTypes from "@msa/tui/index.types";

export type SelectorFactory = (done: () => void) => {
  component: tuiTypes.Component;
  focus: tuiTypes.Component;
  dispose?: () => void;
};

export class EditorSlot {
  private readonly container: tuiTypes.Container;
  private readonly ui: tuiTypes.TUI;
  private readonly getEditor: () => tuiTypes.Component;
  private activeSelectorToken: object | undefined;
  private activeSelectorDispose: (() => void) | undefined;

  constructor(
    container: tuiTypes.Container,
    ui: tuiTypes.TUI,
    getEditor: () => tuiTypes.Component,
  ) {
    this.container = container;
    this.ui = ui;
    this.getEditor = getEditor;
  }

  show(component: tuiTypes.Component, focus: tuiTypes.Component = component): void {
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
