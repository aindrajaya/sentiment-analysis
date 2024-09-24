import * as marked from "marked";
import { Document } from "@langchain/core/documents";

import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

export function tidyMarkdown(markdown: string): string {
  // Step 1: Handle complex broken links with text and optional images spread across multiple lines
  let normalizedMarkdown = markdown.replace(
    /\[\s*([^\]\n]+?)\s*\]\s*\(\s*([^)]+)\s*\)/g,
    (match, text, url) => {
      // Remove internal new lines and excessive spaces within the text
      text = text.replace(/\s+/g, " ").trim();
      url = url.replace(/\s+/g, "").trim();
      return `[${text}](${url})`;
    },
  );

  normalizedMarkdown = normalizedMarkdown.replace(
    /\[\s*([^\]\n!]*?)\s*\n*(?:!\[([^\]]*)\]\((.*?)\))?\s*\n*\]\s*\(\s*([^)]+)\s*\)/g,
    (match, text, alt, imgUrl, linkUrl) => {
      // Normalize by removing excessive spaces and new lines
      text = text.replace(/\s+/g, " ").trim();
      alt = alt ? alt.replace(/\s+/g, " ").trim() : "";
      imgUrl = imgUrl ? imgUrl.replace(/\s+/g, "").trim() : "";
      linkUrl = linkUrl.replace(/\s+/g, "").trim();
      if (imgUrl) {
        return `[${text} ![${alt}](${imgUrl})](${linkUrl})`;
      } else {
        return `[${text}](${linkUrl})`;
      }
    },
  );

  // Step 2: Normalize regular links that may be broken across lines
  normalizedMarkdown = normalizedMarkdown.replace(
    /\[\s*([^\]]+)\]\s*\(\s*([^)]+)\)/g,
    (match, text, url) => {
      text = text.replace(/\s+/g, " ").trim();
      url = url.replace(/\s+/g, "").trim();
      return `[${text}](${url})`;
    },
  );

  // Step 3: Replace more than two consecutive empty lines with exactly two empty lines
  normalizedMarkdown = normalizedMarkdown.replace(/\n{3,}/g, "\n\n");

  // Step 4: Remove leading spaces from each line
  normalizedMarkdown = normalizedMarkdown.replace(/^[ \t]+/gm, "");

  return normalizedMarkdown.trim();
}

export function splitMarkdownByHeaders(
  markdown: string,
  headersToSplitOn: [string, string][],
) {
  const splits = [];
  let currentSplit = "";
  let currentMetadata: Record<string, string> = {};

  const tokens = marked.lexer(markdown);
  tokens.forEach((token) => {
    if (token.type === "heading") {
      const headerLevel = headersToSplitOn.find(
        (header) => header[0] === "#".repeat(token.depth),
      );
      if (headerLevel) {
        if (currentSplit) {
          const doc = new Document({
            pageContent: currentSplit.trim(),
            metadata: [{ ...currentMetadata }],
          });
          splits.push(doc);
        }
        currentSplit = token.raw;
        currentMetadata[headerLevel[1]] = token.text;
      } else {
        currentSplit += token.raw;
      }
    } else {
      currentSplit += token.raw;
    }
  });

  // Push the last split if any content remains
  if (currentSplit) {
    splits.push(
      new Document({
        pageContent: currentSplit.trim(),
        metadata: [{ ...currentMetadata }],
      }),
    );
  }

  return splits;
}

export function customFormatMarkdownDocAsString(docs: Document[]) {
  // result is a set to avoid duplicate content
  const result = new Set<string>();
  for (const doc of docs) {
    let final = "";
    if (doc.metadata) {
      const header = doc.metadata[0];
      final += Object.keys(header)
        .filter((key) => key.includes("Title"))
        .map((key) => {
          switch (key) {
            case "Super Title":
              return doc.pageContent.startsWith(`# ${header[key]}`)
                ? ""
                : `# ${header[key]}`;
            case "Title":
              return doc.pageContent.startsWith(`## ${header[key]}`)
                ? ""
                : `## ${header[key]}`;
            default:
              return doc.pageContent.startsWith(`### ${header[key]}`)
                ? ""
                : `### ${header[key]}`;
          }
        })
        .join("\n");
    }
    final += "\n\n" + doc.pageContent;
    result.add(final);
  }
  return Array.from(result).join("\n");
}

export interface MarkdownSplitterConfig {
  semanticSplitter: [string, string][];
  chunkSize: number;
  chunkOverlap: number;
}
export async function markdownSplitter(
  markdown: string,
  config: MarkdownSplitterConfig = {
    semanticSplitter: [
      ["#", "Super Title"],
      ["##", "Title"],
      ["###", "Sub Title"],
    ],
    chunkSize: 2000,
    chunkOverlap: 200,
  },
) {
  const splitMarkdown = splitMarkdownByHeaders(
    markdown,
    config.semanticSplitter,
  );
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });
  const docs = await splitter.splitDocuments(splitMarkdown);

  return docs;
}
