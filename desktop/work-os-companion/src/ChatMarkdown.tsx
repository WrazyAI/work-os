import { Fragment, type ReactNode } from "react";

const INLINE_TOKEN = /(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_TOKEN).filter(Boolean).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function isSpecialLine(line: string): boolean {
  return /^\s*(?:#{1,3}\s+|[-*+]\s+|\d+\.\s+|>\s?|```|\|)/.test(line);
}

function tableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/** Safe Markdown for assistant content. Raw HTML remains inert text. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const language = fence[1] || undefined;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre className="chat-markdown-code" key={`code-${index}`}><code data-language={language}>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4";
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2]!)}</Heading>);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      const headers = tableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        rows.push(tableRow(lines[index] ?? ""));
        index += 1;
      }
      blocks.push(
        <div className="chat-markdown-table-wrap" key={`table-${index}`}>
          <table className="chat-markdown-table">
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(ordered ? /^\s*\d+\. (.+)$/ : /^\s*[-*+] (.+)$/);
        if (!item) break;
        items.push(<li key={index}>{renderInline(item[1]!)}</li>);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={`list-${index}`}>{items}</List>);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((part, quoteIndex) => <p key={quoteIndex}>{renderInline(part)}</p>)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]?.trim() && !isSpecialLine(lines[index] ?? "")) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="chat-markdown">{blocks.length ? blocks : <p>{renderInline(text)}</p>}</div>;
}
