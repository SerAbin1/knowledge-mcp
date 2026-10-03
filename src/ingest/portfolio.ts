import { deleteMissing, upsertDocument, type DocumentInput } from "../store";
import { chunkMarkdown } from "./chunk";

// Shape of serabin1.github.io/content.json (src/pages/content.json.ts there).
type PortfolioContent = {
  site: string;
  posts: { url: string; title: string; description: string; date: string; body: string }[];
  projects: { title: string; description: string[]; technologies: string[]; github?: string; demo?: string; url: string }[];
  experience: {
    title: string;
    company: string;
    period: string;
    location: string;
    description: string[];
    technologies: string[];
    url: string;
  }[];
};

const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export function portfolioDocuments(content: PortfolioContent): { doc: DocumentInput; markdown: string }[] {
  const source = new URL(content.site).host;
  const posts = content.posts.map((p) => ({
    doc: { kind: "blog" as const, source, url: p.url, title: p.title, summary: p.description, body: p.body, publishedAt: p.date },
    markdown: `${p.description}\n\n${p.body}`,
  }));
  const projects = content.projects.map((p) => {
    const body = [
      ...p.description.map((d) => `- ${d}`),
      `\nTechnologies: ${p.technologies.join(", ")}`,
      p.github ? `Code: ${p.github}` : "",
      p.demo ? `Live: ${p.demo}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      doc: { kind: "project" as const, source, url: `${p.url}#${slug(p.title)}`, title: `Project: ${p.title}`, summary: p.description[0] ?? null, body, publishedAt: null },
      markdown: body,
    };
  });
  const experience = content.experience.map((e) => {
    const title = `${e.title} at ${e.company}`;
    const body = [
      `${e.period} · ${e.location}`,
      ...e.description.map((d) => `- ${d}`),
      `\nTechnologies: ${e.technologies.join(", ")}`,
    ].join("\n");
    return {
      doc: { kind: "experience" as const, source, url: `${e.url}#${slug(`${e.company}-${e.title}`)}`, title, summary: e.description[0] ?? null, body, publishedAt: null },
      markdown: body,
    };
  });
  return [...posts, ...projects, ...experience];
}

export async function ingestPortfolio(db: D1Database, contentUrl: string) {
  const res = await fetch(contentUrl);
  if (!res.ok) throw new Error(`portfolio: GET ${contentUrl} → ${res.status}`);
  const items = portfolioDocuments(await res.json());

  let changed = 0;
  for (const { doc, markdown } of items) {
    if (await upsertDocument(db, doc, chunkMarkdown(markdown))) changed++;
  }
  const removed = await deleteMissing(db, ["blog", "project", "experience"], items.map((i) => i.doc.url));
  return { total: items.length, changed, removed };
}
