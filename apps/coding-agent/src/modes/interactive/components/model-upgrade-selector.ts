import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type { ModelUpgradeCandidate } from "../../../core/model-upgrade.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

const { Container, SelectList, Spacer, Text, getKeybindings } = tui;

const UPGRADE_SELECT_LIST_LAYOUT: tuiTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 72,
  minPrimaryColumnWidth: 40,
};

export interface ModelUpgradeCallbacks {
  onApply(candidate: ModelUpgradeCandidate): Promise<string>;
  onCancel: () => void;
  requestRender: () => void;
}

export class ModelUpgradeSelectorComponent extends Container implements tuiTypes.Focusable {
  private selectList: tuiTypes.SelectList;
  private selectListChildIndex: number;
  private statusText: tuiTypes.Text;
  private candidates: ModelUpgradeCandidate[];
  private callbacks: ModelUpgradeCallbacks;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  constructor(candidates: ModelUpgradeCandidate[], callbacks: ModelUpgradeCallbacks) {
    super();
    this.candidates = candidates;
    this.callbacks = callbacks;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("accent", theme.bold("Model Upgrades")), 0, 0));
    this.addChild(new Spacer(1));

    this.selectList = this.buildSelectList(candidates);
    this.selectListChildIndex = this.children.length;
    this.addChild(this.selectList);

    this.addChild(new Spacer(1));
    this.statusText = new Text("", 0, 0);
    this.addChild(this.statusText);
    this.addChild(
      new Text(
        theme.fg(
          "dim",
          `  ${keyDisplayText("tui.select.confirm")} apply · ${keyDisplayText("tui.select.cancel")} cancel`,
        ),
        0,
        0,
      ),
    );
    this.addChild(new DynamicBorder());
  }

  private buildSelectList(candidates: readonly ModelUpgradeCandidate[]): tuiTypes.SelectList {
    const items: tuiTypes.SelectItem[] = candidates.map((candidate) => ({
      description: `${candidate.from.provider} · ${candidate.reason}${candidate.confident ? "" : " · candidate"}`,
      label: `${candidate.from.id} → ${candidate.to.id}`,
      value: `${candidate.from.provider}/${candidate.from.id}`,
    }));
    const list = new SelectList(items, 10, getSelectListTheme(), UPGRADE_SELECT_LIST_LAYOUT);
    list.onSelect = (item) => void this.apply(item.value);
    list.onCancel = () => this.callbacks.onCancel();
    return list;
  }

  private async apply(reference: string): Promise<void> {
    const candidate = this.candidates.find(
      (entry) => `${entry.from.provider}/${entry.from.id}` === reference,
    );
    if (!candidate) return;
    if (!candidate.confident) {
      this.statusText.setText(
        theme.fg("warning", `  ${reference} needs a decision: ${candidate.reason}`),
      );
      this.callbacks.requestRender();
      return;
    }
    try {
      const message = await this.callbacks.onApply(candidate);
      this.candidates = this.candidates.filter((entry) => entry !== candidate);
      this.replaceList();
      this.statusText.setText(theme.fg("success", `  ${message}`));
    } catch (error) {
      this.statusText.setText(
        theme.fg("error", `  ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    this.callbacks.requestRender();
  }

  private replaceList(): void {
    this.selectList = this.buildSelectList(this.candidates);
    this.children[this.selectListChildIndex] = this.selectList;
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
      this.selectList.handleInput(keyData);
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm")) {
      this.selectList.handleInput(keyData);
      return;
    }
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.callbacks.onCancel();
    }
  }

  getSelectList(): tuiTypes.SelectList {
    return this.selectList;
  }
}
