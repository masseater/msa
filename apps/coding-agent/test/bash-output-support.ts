function getTextOutput(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (
    result.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

const bashOutputSupport = {
  getTextOutput,
};

export default bashOutputSupport;
