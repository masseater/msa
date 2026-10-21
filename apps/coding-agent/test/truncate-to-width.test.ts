import tui from "@msa/tui";
import { describe, expect, it } from "vite-plus/test";

const { truncateToWidth, visibleWidth } = tui;

const shouldTruncateMessagesWithUnicodeCharactersCorrectly = () => {
  const message = '✔ script to run › dev $ concurrently "vite" "node --import tsx ./';
  const width = 67;
  const maxMsgWidth = width - 2;

  const truncated = truncateToWidth(message, maxMsgWidth);
  const truncatedWidth = visibleWidth(truncated);

  expect(truncatedWidth).toBeLessThanOrEqual(maxMsgWidth);
};

const shouldHandleEmojiCharacters = () => {
  const message = "🎉 Celebration! 🚀 Launch 📦 Package ready for deployment now";
  const width = 40;
  const maxMsgWidth = width - 2;

  const truncated = truncateToWidth(message, maxMsgWidth);
  const truncatedWidth = visibleWidth(truncated);

  expect(truncatedWidth).toBeLessThanOrEqual(maxMsgWidth);
};

const shouldHandleMixedAsciiAndWideCharacters = () => {
  const message = "Hello 世界 Test 你好 More text here that is long";
  const width = 30;
  const maxMsgWidth = width - 2;

  const truncated = truncateToWidth(message, maxMsgWidth);
  const truncatedWidth = visibleWidth(truncated);

  expect(truncatedWidth).toBeLessThanOrEqual(maxMsgWidth);
};

const shouldNotTruncateMessagesThatFit = () => {
  const message = "Short message";
  const width = 50;
  const maxMsgWidth = width - 2;

  const truncated = truncateToWidth(message, maxMsgWidth);

  expect(truncated).toBe(message);
  expect(visibleWidth(truncated)).toBeLessThanOrEqual(maxMsgWidth);
};

const shouldAddEllipsisWhenTruncating = () => {
  const message = "This is a very long message that needs to be truncated";
  const width = 30;
  const maxMsgWidth = width - 2;

  const truncated = truncateToWidth(message, maxMsgWidth);

  expect(truncated).toContain("...");
  expect(visibleWidth(truncated)).toBeLessThanOrEqual(maxMsgWidth);
};

const shouldHandleTheExactCrashCaseFrom = () => {
  const message = '✔ script to run › dev $ concurrently "vite" "node --import tsx ./server.ts"';
  const terminalWidth = 67;
  const cursorWidth = 2;
  const maxMsgWidth = terminalWidth - cursorWidth;

  const truncated = truncateToWidth(message, maxMsgWidth);
  const finalWidth = visibleWidth(truncated);

  expect(finalWidth + cursorWidth).toBeLessThanOrEqual(terminalWidth);
};

describe("truncateToWidth", () => {
  it(
    "should truncate messages with Unicode characters correctly",
    shouldTruncateMessagesWithUnicodeCharactersCorrectly,
  );

  it("should handle emoji characters", shouldHandleEmojiCharacters);

  it("should handle mixed ASCII and wide characters", shouldHandleMixedAsciiAndWideCharacters);

  it("should not truncate messages that fit", shouldNotTruncateMessagesThatFit);

  it("should add ellipsis when truncating", shouldAddEllipsisWhenTruncating);

  it("should handle the exact crash case from issue report", shouldHandleTheExactCrashCaseFrom);
});
