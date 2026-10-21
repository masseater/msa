import type InteractiveMode from "../interactive-mode.ts";
import type interactiveModeTypes from "../interactive-mode.types.ts";
import InteractiveThemeController from "../theme/interactive-theme-controller.ts";
import type themeControllerTypes from "../theme/theme-controller.types.ts";
import themeModule from "../theme/theme.ts";

const { setRegisteredThemes } = themeModule;

export default class ModeTheme {
  themeController!: themeControllerTypes.InteractiveThemeController;

  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  start(
    initialThemeSetting: interactiveModeTypes.InteractiveModeOptions["initialThemeSetting"],
  ): void {
    const { mode } = this;
    setRegisteredThemes(mode.session.resourceLoader.getThemes().themes);
    this.themeController = new InteractiveThemeController(mode.ui, {
      getSettingsManager: () => mode.settingsManager,
      initialThemeSetting,
      onChanged: () => mode.input.keys.updateEditorBorderColor(),
      showError: (message) => mode.display.status.showError(message),
    });
  }
}
