import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import SelectSubmenu from "./select-submenu.ts";
import type settingsSubmenuTypes from "./settings-submenu.types.ts";

interface SteppedSubmenuOptions {
  startAtStep?: number;
  initialContext?: Record<string, string>;
  loop?: boolean;
}
export default class SteppedSubmenu extends tui.Container {
  private readonly steps: settingsSubmenuTypes.SteppedSubmenuStep[];
  private readonly onComplete: (context: Record<string, string>) => void;
  private readonly onCancel: () => void;
  private readonly opts: SteppedSubmenuOptions;
  private activeComponent: tuiTypes.Component;
  private context: Record<string, string>;

  constructor(
    steps: settingsSubmenuTypes.SteppedSubmenuStep[],
    onComplete: (context: Record<string, string>) => void,
    onCancel: () => void,
    opts: SteppedSubmenuOptions = {},
  ) {
    super();
    this.steps = steps;
    this.onComplete = onComplete;
    this.onCancel = onCancel;
    this.opts = opts;
    this.context = { ...(opts.initialContext ?? {}) };
    this.activeComponent = this.buildStep(opts.startAtStep ?? 0);
  }

  private buildStep(stepIndex: number): tuiTypes.Component {
    const step = this.steps[stepIndex];
    if (step === undefined) throw new Error(`Step ${stepIndex} does not exist`);
    const total = this.steps.length;
    const stepLabel = total > 1 ? `Step ${stepIndex + 1}/${total} \u00b7 ` : "";

    const title = typeof step.title === "function" ? step.title(this.context) : step.title;
    const desc =
      typeof step.description === "function" ? step.description(this.context) : step.description;
    const items = step.options(this.context);
    const preselect = step.preselect?.(this.context) ?? "";

    return new SelectSubmenu(
      title,
      `${stepLabel}${desc}`,
      items,
      preselect,
      (value) => {
        this.context = { ...this.context, [step.key]: value };

        if (stepIndex < total - 1) {
          this.activeComponent = this.buildStep(stepIndex + 1);
        } else {
          this.onComplete({ ...this.context });

          if (this.opts.loop === true) {
            this.context = {};
            this.activeComponent = this.buildStep(0);
          } else {
            this.onCancel();
          }
        }
      },
      () => {
        if (stepIndex > 0) {
          this.context = Object.fromEntries(
            Object.entries(this.context).filter(([key]) => key !== step.key),
          );
          this.activeComponent = this.buildStep(stepIndex - 1);
        } else {
          this.onCancel();
        }
      },
      undefined,
      step.searchable === true || step.layout !== undefined
        ? { layout: step.layout, searchable: step.searchable }
        : undefined,
    );
  }

  override render(width: number): string[] {
    return this.activeComponent.render(width);
  }

  handleInput(data: string): void {
    this.activeComponent.handleInput?.(data);
  }

  override invalidate(): void {
    this.activeComponent.invalidate?.();
  }
}
