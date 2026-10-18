import type { Tokens } from "marked";

import { wrapTextWithAnsi } from "../text-wrap.ts";
import { visibleWidth } from "../utils.ts";
import { MarkdownStyleContext } from "./markdown-style-context.ts";
import type { InlineStyleContext } from "./markdown-theme.ts";

const MAX_UNBROKEN_WORD_WIDTH = 30;

interface ColumnMetrics {
  natural: number;
  minWord: number;
}

interface ColumnWidth {
  natural: number;
  min: number;
}

interface WrappedCell {
  width: number;
  lines: string[];
}

export class MarkdownTableRenderer extends MarkdownStyleContext {
  protected getLongestWordWidth(text: string, maxWidth?: number): number {
    const words = text.split(/\s+/u).filter((word) => word.length > 0);
    let longest = 0;
    for (const word of words) {
      longest = Math.max(longest, visibleWidth(word));
    }
    if (maxWidth === undefined) {
      return longest;
    }
    return Math.min(longest, maxWidth);
  }

  protected wrapCellText(text: string, maxWidth: number, stylePrefix = ""): string[] {
    const lines = wrapTextWithAnsi(text, Math.max(1, maxWidth));
    return lines.map((line, index) => {
      const styleReset = index < lines.length - 1 ? "\x1b[22;23;24;25;27;28;29;39m" : "";
      return `${line}${styleReset}${stylePrefix}`;
    });
  }

  protected tableColumnMetrics(
    token: Tokens.Table,
    styleContext?: InlineStyleContext,
  ): ColumnMetrics[] {
    const columns: ColumnMetrics[] = [];
    for (const cells of [token.header, ...token.rows]) {
      for (const [i, cell] of cells.entries()) {
        const cellText = this.renderInlineTokens(cell.tokens || [], styleContext);
        const natural = visibleWidth(cellText);
        const minWord = this.getLongestWordWidth(cellText, MAX_UNBROKEN_WORD_WIDTH);
        const column = columns[i];
        if (column === undefined) {
          columns[i] = { natural, minWord: Math.max(1, minWord) };
        } else {
          column.natural = Math.max(column.natural, natural);
          column.minWord = Math.max(column.minWord, minWord);
        }
      }
    }
    return columns;
  }

  protected shrinkToMinimumWidths(
    columns: readonly ColumnMetrics[],
    availableForCells: number,
  ): ColumnWidth[] {
    const remaining = availableForCells - columns.length;
    if (remaining <= 0) {
      return columns.map((column) => ({ natural: column.natural, min: 1 }));
    }

    const totalWeight = columns.reduce(
      (total, column) => total + Math.max(0, column.minWord - 1),
      0,
    );
    const grown = columns.map((column) => {
      const weight = Math.max(0, column.minWord - 1);
      const growth = totalWeight > 0 ? Math.floor((weight / totalWeight) * remaining) : 0;
      return { natural: column.natural, growth };
    });

    let leftover = remaining - grown.reduce((total, column) => total + column.growth, 0);
    return grown.map((column) => {
      const extra = leftover > 0 ? 1 : 0;
      leftover -= extra;
      return { natural: column.natural, min: 1 + column.growth + extra };
    });
  }

  protected growToAvailableWidth(
    minColumns: readonly ColumnWidth[],
    availableForCells: number,
    minCellsWidth: number,
  ): number[] {
    const totalGrowPotential = minColumns.reduce(
      (total, column) => total + Math.max(0, column.natural - column.min),
      0,
    );
    const extraWidth = Math.max(0, availableForCells - minCellsWidth);
    const sized = minColumns.map((column) => {
      const minWidthDelta = Math.max(0, column.natural - column.min);
      const grow =
        totalGrowPotential > 0 ? Math.floor((minWidthDelta / totalGrowPotential) * extraWidth) : 0;
      return { natural: column.natural, width: column.min + grow };
    });

    let remaining = availableForCells - sized.reduce((total, column) => total + column.width, 0);
    while (remaining > 0) {
      let grew = false;
      for (const column of sized) {
        if (remaining <= 0) break;
        if (column.width < column.natural) {
          column.width++;
          remaining--;
          grew = true;
        }
      }
      if (!grew) break;
    }
    return sized.map((column) => column.width);
  }

  protected tableColumnWidths(
    token: Tokens.Table,
    availableWidth: number,
    styleContext?: InlineStyleContext,
  ): number[] {
    const columns = this.tableColumnMetrics(token, styleContext);
    const borderOverhead = 3 * token.header.length + 1;
    const availableForCells = availableWidth - borderOverhead;

    let minColumns: ColumnWidth[] = columns.map((column) => ({
      natural: column.natural,
      min: column.minWord,
    }));
    let minCellsWidth = minColumns.reduce((total, column) => total + column.min, 0);

    if (minCellsWidth > availableForCells) {
      minColumns = this.shrinkToMinimumWidths(columns, availableForCells);
      minCellsWidth = minColumns.reduce((total, column) => total + column.min, 0);
    }

    const totalNaturalWidth =
      columns.reduce((total, column) => total + column.natural, 0) + borderOverhead;
    return totalNaturalWidth <= availableWidth
      ? minColumns.map((column) => Math.max(column.natural, column.min))
      : this.growToAvailableWidth(minColumns, availableForCells, minCellsWidth);
  }

  protected wrapRowCells(
    cells: readonly Tokens.TableCell[],
    columnWidths: readonly number[],
    styleContext?: InlineStyleContext,
  ): WrappedCell[] {
    return cells.map((cell, i) => {
      const width = columnWidths[i];
      if (width === undefined) {
        throw new Error(`Table cell ${i} has no column width`);
      }
      const text = this.renderInlineTokens(cell.tokens || [], styleContext);
      return { width, lines: this.wrapCellText(text, width, styleContext?.stylePrefix) };
    });
  }

  protected renderRowLines(cells: readonly WrappedCell[], bold: boolean): string[] {
    const lineCount = Math.max(...cells.map((cell) => cell.lines.length));
    const lines: string[] = [];
    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      const rowParts = cells.map(({ width, lines: cellLines }) => {
        const text = cellLines[lineIdx] || "";
        const padded = text + " ".repeat(Math.max(0, width - visibleWidth(text)));
        return bold ? this.theme.bold(padded) : padded;
      });
      lines.push(`│ ${rowParts.join(" │ ")} │`);
    }
    return lines;
  }

  protected renderTable(
    token: Tokens.Table,
    availableWidth: number,
    nextTokenType?: string,
    styleContext?: InlineStyleContext,
  ): string[] {
    const numCols = token.header.length;
    if (numCols === 0) {
      return [];
    }

    if (availableWidth - (3 * numCols + 1) < numCols) {
      const fallbackLines = token.raw === "" ? [] : wrapTextWithAnsi(token.raw, availableWidth);
      return this.addTrailingBlank(fallbackLines, nextTokenType);
    }

    const columnWidths = this.tableColumnWidths(token, availableWidth, styleContext);
    const borderCells = columnWidths.map((w) => "─".repeat(w));
    const separatorLine = `├─${borderCells.join("─┼─")}─┤`;

    const lines = [`┌─${borderCells.join("─┬─")}─┐`];
    lines.push(
      ...this.renderRowLines(this.wrapRowCells(token.header, columnWidths, styleContext), true),
    );
    lines.push(separatorLine);

    for (const [rowIndex, row] of token.rows.entries()) {
      lines.push(...this.renderRowLines(this.wrapRowCells(row, columnWidths, styleContext), false));
      if (rowIndex < token.rows.length - 1) {
        lines.push(separatorLine);
      }
    }

    lines.push(`└─${borderCells.join("─┴─")}─┘`);
    return this.addTrailingBlank(lines, nextTokenType);
  }
}
