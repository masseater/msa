import cliKit from "./index-kit/cli.ts";
import extensionsKit from "./index-kit/extensions.ts";
import modelsKit from "./index-kit/models.ts";
import resourcesKit from "./index-kit/resources.ts";
import sessionKit from "./index-kit/session.ts";
import settingsKit from "./index-kit/settings.ts";
import toolsKit from "./index-kit/tools.ts";
import uiKit from "./index-kit/ui.ts";
import utilsKit from "./index-kit/utils.ts";

const src: typeof sessionKit &
  typeof modelsKit &
  typeof settingsKit &
  typeof resourcesKit &
  typeof toolsKit &
  typeof extensionsKit &
  typeof uiKit &
  typeof cliKit &
  typeof utilsKit = {
  ...sessionKit,
  ...modelsKit,
  ...settingsKit,
  ...resourcesKit,
  ...toolsKit,
  ...extensionsKit,
  ...uiKit,
  ...cliKit,
  ...utilsKit,
};

export default src;
