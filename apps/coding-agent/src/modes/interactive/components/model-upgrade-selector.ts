import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type modelUpgradeTypes from "../../../core/model-upgrade.types.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import type modelUpgradeSelectorTypes from "./model-upgrade-selector.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { getSelectListTheme, theme } = themeModule;
const { keyDisplayText } = keybindingHints;

const { SelectList, Spacer, Text, getKeybindings } = tui;

const UPGRADE_SELECT_LIST_LAYOUT: tuiTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 72,
  minPrimaryColumnWidth: 40,
};

export default class ModelUpgradeSelectorComponent
  extends tui.Container
  implements tuiTypes.Focusable
{
  private selectList: tuiTypes.SelectList;
  private selectListChildIndex: number;
  private statusText: tuiTypes.Text;
  private candidates: modelUpgradeTypes.ModelUpgradeCandidate[];
  private callbacks: modelUpgradeSelectorTypes.ModelUpgradeCallbacks;
  private focusedState = false;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
  }

  constructor(
    candidates: modelUpgradeTypes.ModelUpgradeCandidate[],
    callbacks: modelUpgradeSelectorTypes.ModelUpgradeCallbacks,
  ) {
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

  private buildSelectList(
    candidates: readonly modelUpgradeTypes.ModelUpgradeCandidate[],
  ): tuiTypes.SelectList {
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

  private apply(reference: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const candidate = this.candidates.find(
          (entry) => `${entry.from.provider}/${entry.from.id}` === reference,
        );
        if (candidate === undefined) return;
        if (!candidate.confident) {
          this.statusText.setText(
            theme.fg("warning", `  ${reference} needs a decision: ${candidate.reason}`),
          );
          this.callbacks.requestRender();
          return;
        }
        try {
          const message = yield* awaited(this.callbacks.onApply(candidate));
          this.candidates = this.candidates.filter((entry) => entry !== candidate);
          this.replaceList();
          this.statusText.setText(theme.fg("success", `  ${message}`));
        } catch (error) {
          this.statusText.setText(
            theme.fg("error", `  ${error instanceof Error ? error.message : String(error)}`),
          );
        }
        this.callbacks.requestRender();
      }, this),
    );
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
