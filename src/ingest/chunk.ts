export type Chunk = { heading: string | null; text: string };

// Splits markdown into search-sized pieces: first at headings (a section is
// the natural unit of meaning), then, for sections longer than `maxChars`, at
// paragraph breaks. Headings inside fenced code blocks are not headings.
export function chunkMarkdown(markdown: string, maxChars = 1500): Chunk[] {
  const sections: Chunk[] = [];
  let heading: string | null = null;
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) sections.push({ heading, text });
    lines = [];
  };

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      flush();
      heading = h[1];
    } else {
      lines.push(line);
    }
  }
  flush();

  return sections.flatMap((s) => splitLong(s, maxChars));
}

function splitLong(section: Chunk, maxChars: number): Chunk[] {
  if (section.text.length <= maxChars) return [section];
  const out: Chunk[] = [];
  let current = "";
  for (const para of paragraphs(section.text)) {
    if (current && current.length + para.length + 2 > maxChars) {
      out.push({ heading: section.heading, text: current });
      current = "";
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) out.push({ heading: section.heading, text: current });
  return out;
}

// Paragraphs separated by blank lines, keeping a fenced code block whole even
// if it contains blank lines.
function paragraphs(text: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (buf.length) out.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}
