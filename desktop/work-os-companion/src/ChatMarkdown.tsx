import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Safe, deliberately small Markdown subset for assistant chat: headings, lists,
 * emphasis, and code. Raw HTML stays text because no HTML parser is used. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    const list = line.match(/^\s*[-*]\s+(.+)$/);
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (list) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index]?.match(/^\s*[-*]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={index}>{inline(item[1]!)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (heading) {
      blocks.push(<strong className="chat-markdown-heading" key={index}>{inline(heading[1]!)}</strong>);
    } else if (line.trim()) {
      blocks.push(<p key={index}>{inline(line)}</p>);
    }
    index += 1;
  }
  return <div className="chat-markdown">{blocks.length ? blocks : <p>{text}</p>}</div>;
}
