import { describe, expect, it } from "vite-plus/test";
import { chunkMarkdown } from "./chunk";

describe("chunkMarkdown", () => {
  it("splits at headings and keeps the heading with its section", () => {
    const chunks = chunkMarkdown("Intro text.\n\n## First\nOne.\n\n### Second\nTwo.");
    expect(chunks).toEqual([
      { heading: null, text: "Intro text." },
      { heading: "First", text: "One." },
      { heading: "Second", text: "Two." },
    ]);
  });

  it("ignores # lines inside code fences", () => {
    const chunks = chunkMarkdown("## Shell\n```bash\n# not a heading\necho hi\n```");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("# not a heading");
  });

  it("splits long sections at paragraphs without breaking code blocks", () => {
    const para = "word ".repeat(60).trim();
    const code = "```\nline one\n\nline two\n```";
    const chunks = chunkMarkdown(`## Long\n${para}\n\n${code}\n\n${para}`, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.heading === "Long")).toBe(true);
    expect(chunks.some((c) => c.text.includes("line one\n\nline two"))).toBe(true);
  });
});
