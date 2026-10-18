import type { AssistantMessage } from "@msa/ai";
import type { TextContent } from "@msa/ai/compat";
import { Container, Markdown, type MarkdownTheme, MouseRegion, Spacer, Text } from "@msa/tui";

import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export class AssistantMessageComponent extends Container {
  private contentContainer: Container;
  private hideThinkingBlock: boolean;
  private markdownTheme: MarkdownTheme;
  private hiddenThinkingLabel: string;
  private outputPad: number;
  private markdownTransformers: readonly MarkdownTransformer[];
  private lastMessage?: AssistantMessage;
  private hasToolCalls = false;
  private isStreaming = false;
  private thinkingVisibilityOverrides = new Map<number, boolean>();
  private splitThinking?: AssistantMessageComponent;

  constructor(
    message?: AssistantMessage,
    hideThinkingBlock = false,
    markdownTheme: MarkdownTheme = getMarkdownTheme(),
    hiddenThinkingLabel = "Thinking...",
    outputPad = 1,
    markdownTransformers: readonly MarkdownTransformer[] = [],
  ) {
    super();

    this.hideThinkingBlock = hideThinkingBlock;
    this.markdownTheme = markdownTheme;
    this.hiddenThinkingLabel = hiddenThinkingLabel;
    this.outputPad = outputPad;
    this.markdownTransformers = markdownTransformers;

    this.contentContainer = new Container();
    this.addChild(this.contentContainer);

    if (message !== undefined) {
      this.updateContent(message);
    }
  }

  override invalidate(): void {
    super.invalidate();
    if (this.lastMessage !== undefined) {
      this.updateContent(this.lastMessage);
    }
  }

  setHideThinkingBlock(hide: boolean): void {
    this.hideThinkingBlock = hide;
    this.thinkingVisibilityOverrides.clear();
    if (this.lastMessage !== undefined) {
      this.updateContent(this.lastMessage);
    }
  }

  setHiddenThinkingLabel(label: string): void {
    this.hiddenThinkingLabel = label;
    if (this.lastMessage !== undefined) {
      this.updateContent(this.lastMessage);
    }
  }

  setOutputPad(padding: number): void {
    this.outputPad = padding;
    if (this.lastMessage !== undefined) {
      this.updateContent(this.lastMessage);
    }
  }

  hasVisibleText(): boolean {
    const message = this.lastMessage;
    if (message === undefined) return false;
    return (
      message.stopReason === "length" ||
      message.content.some((c) => c.type === "text" && c.text.trim().length > 0)
    );
  }

  takeThinking(): AssistantMessageComponent | undefined {
    const message = this.lastMessage;
    if (this.splitThinking !== undefined || message === undefined || !this.hasVisibleText())
      return undefined;
    if (!message.content.some((c) => c.type === "thinking" && c.thinking.trim())) return undefined;
    this.splitThinking = new AssistantMessageComponent(
      undefined,
      this.hideThinkingBlock,
      this.markdownTheme,
      this.hiddenThinkingLabel,
      this.outputPad,
      this.markdownTransformers,
    );
    this.updateContent(message);
    return this.splitThinking;
  }

  get takenThinking(): AssistantMessageComponent | undefined {
    return this.splitThinking;
  }

  hasThinking(): boolean {
    return (
      this.lastMessage?.content.some((c) => c.type === "thinking" && c.thinking.trim()) ?? false
    );
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (this.hasToolCalls || lines.length === 0) {
      return lines;
    }

    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
    return lines;
  }

  updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
    this.lastMessage = message;
    this.isStreaming = isStreaming;

    this.splitThinking?.updateContent(
      {
        ...message,
        content: message.content.filter((c) => c.type === "thinking" || c.type === "toolCall"),
        stopReason: "toolUse",
      },
      isStreaming,
    );
    const contentBlocks =
      this.splitThinking === undefined
        ? message.content
        : message.content.filter((c) => c.type !== "thinking");

    this.contentContainer.clear();

    const hasVisibleContent = contentBlocks.some(
      (c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
    );

    if (hasVisibleContent) {
      this.contentContainer.addChild(new Spacer(1));
    }

    let thinkingRunIndex = 0;
    for (let i = 0; i < contentBlocks.length; i++) {
      const content = contentBlocks[i];
      if (content === undefined) continue;
      if (content.type === "text" && content.text.trim() !== "") {
        AssistantMessageComponent.updateContentPart2(this, content);
      } else if (content.type === "thinking") {
        const thinkingBlocks: string[] = [];
        for (; i < contentBlocks.length; i++) {
          const thinkingContent = contentBlocks[i];
          if (thinkingContent?.type !== "thinking") {
            break;
          }
          const thinking = thinkingContent.thinking.trim();
          if (thinking !== "") {
            thinkingBlocks.push(thinking);
          }
        }
        i--;

        if (thinkingBlocks.length === 0) {
          continue;
        }

        const hasVisibleContentAfter = contentBlocks
          .slice(i + 1)
          .some(
            (c) =>
              (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
          );

        const runIndex = thinkingRunIndex++;
        const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
        AssistantMessageComponent.updateContentPart3(
          this,
          hidden,
          thinkingBlocks,
          runIndex,
          hasVisibleContentAfter,
        );
      }
    }

    AssistantMessageComponent.updateContentPart4(this, message);
  }

  private static updateContentPart2(self: AssistantMessageComponent, content: TextContent): void {
    self.contentContainer.addChild(
      new Markdown(content.text.trim(), self.outputPad, 0, self.markdownTheme, undefined, {
        transform: createMarkdownTransform(
          "assistant",
          self.isStreaming,
          self.markdownTransformers,
        ),
      }),
    );
  }

  private static updateContentPart3(
    self: AssistantMessageComponent,
    hidden: boolean,
    thinkingBlocks: string[],
    runIndex: number,
    hasVisibleContentAfter: boolean,
  ): void {
    const thinkingComponent = hidden
      ? new Text(
          theme.italic(theme.fg("thinkingText", self.hiddenThinkingLabel)),
          self.outputPad,
          0,
        )
      : new Markdown(
          thinkingBlocks.join("\n\n"),
          self.outputPad,
          0,
          self.markdownTheme,
          {
            color: (text: string) => theme.fg("thinkingText", text),
            italic: true,
          },
          {
            transform: createMarkdownTransform(
              "assistant-thinking",
              self.isStreaming,
              self.markdownTransformers,
            ),
          },
        );
    self.contentContainer.addChild(
      new MouseRegion(thinkingComponent, (event) => {
        if (event.type !== "click" || event.button !== "left") return undefined;
        self.thinkingVisibilityOverrides.set(runIndex, !hidden);
        if (self.lastMessage !== undefined) self.updateContent(self.lastMessage);
        return { handled: true };
      }),
    );
    if (hasVisibleContentAfter) {
      self.contentContainer.addChild(new Spacer(1));
    }
  }

  private static updateContentPart4(
    self: AssistantMessageComponent,
    message: AssistantMessage,
  ): void {
    const hasToolCalls = message.content.some((c) => c.type === "toolCall");
    self.hasToolCalls = hasToolCalls;
    if (message.stopReason === "length") {
      self.contentContainer.addChild(new Spacer(1));
      self.contentContainer.addChild(
        new Text(theme.fg("error", "Response was truncated before completion."), self.outputPad, 0),
      );
    } else if (!hasToolCalls) {
      if (message.stopReason === "aborted") {
        const abortMessage =
          message.errorMessage !== undefined &&
          message.errorMessage !== "" &&
          message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        self.contentContainer.addChild(new Spacer(1));
        self.contentContainer.addChild(
          new Text(theme.fg("error", abortMessage), self.outputPad, 0),
        );
      } else if (message.stopReason === "error") {
        const errorMsg = message.errorMessage || "Unknown error";
        self.contentContainer.addChild(new Spacer(1));
        self.contentContainer.addChild(
          new Text(theme.fg("error", `Error: ${errorMsg}`), self.outputPad, 0),
        );
      }
    }
  }
}
