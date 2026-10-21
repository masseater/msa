import CancellableLoader from "../components/cancellable-loader.ts";
import Editor from "../components/editor.ts";
import image from "../components/image.ts";
import Input from "../components/input.ts";
import Loader from "../components/loader.ts";
import Markdown from "../components/markdown.ts";
import SelectList from "../components/select-list.ts";
import SettingsList from "../components/settings-list.ts";
import Text from "../components/text.ts";
import TruncatedText from "../components/truncated-text.ts";

const widgetsKit: {
  readonly CancellableLoader: typeof CancellableLoader;
  readonly Editor: typeof Editor;
  readonly Input: typeof Input;
  readonly Loader: typeof Loader;
  readonly Markdown: typeof Markdown;
  readonly SelectList: typeof SelectList;
  readonly SettingsList: typeof SettingsList;
  readonly Text: typeof Text;
  readonly TruncatedText: typeof TruncatedText;
  readonly image: typeof image;
} = {
  CancellableLoader,
  Editor,
  Input,
  Loader,
  Markdown,
  SelectList,
  SettingsList,
  Text,
  TruncatedText,
  image,
};

export default widgetsKit;
