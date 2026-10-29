import darwinArm64Platform from "@msa/tui/native/darwin/prebuilds/darwin-arm64/darwin-platform.node" with { type: "file" };
import darwinX64Platform from "@msa/tui/native/darwin/prebuilds/darwin-x64/darwin-platform.node" with { type: "file" };
import linuxArm64Platform from "@msa/tui/native/linux/prebuilds/linux-arm64/linux-platform-x11.node" with { type: "file" };
import linuxX64Platform from "@msa/tui/native/linux/prebuilds/linux-x64/linux-platform-x11.node" with { type: "file" };
import win32Arm64Platform from "@msa/tui/native/win32/prebuilds/win32-arm64/win32-platform.node" with { type: "file" };
import win32X64Platform from "@msa/tui/native/win32/prebuilds/win32-x64/win32-platform.node" with { type: "file" };

const embeddedNativeModules: Readonly<Record<string, string>> = {
  "native/darwin/prebuilds/darwin-arm64/darwin-platform.node": darwinArm64Platform,
  "native/darwin/prebuilds/darwin-x64/darwin-platform.node": darwinX64Platform,
  "native/linux/prebuilds/linux-arm64/linux-platform-x11.node": linuxArm64Platform,
  "native/linux/prebuilds/linux-x64/linux-platform-x11.node": linuxX64Platform,
  "native/win32/prebuilds/win32-arm64/win32-platform.node": win32Arm64Platform,
  "native/win32/prebuilds/win32-x64/win32-platform.node": win32X64Platform,
};

export default embeddedNativeModules;
