import { DynamicStructuredTool, Tool, ToolParams } from "langchain/tools";
import { z } from "zod";
import { countTokens } from "../../helper.util.js";
import {
  customFormatMarkdownDocAsString,
  markdownSplitter,
} from "../../etl/markdown.js";
import { Document as ChainDoc } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { CohereRerank } from "@langchain/cohere";
import extractMarkdown from "../../etl/mrscraper.js";

export const SearchNestedWebContentTool = (apiKey: string) =>
  new DynamicStructuredTool({
    name: "search-nested-web-content",
    description:
      "Tool used when you need to search related web content from nested web content like details of the data etc. Please make sure the url are valid with complete url not just the endpoint",
    schema: z.object({ urls: z.array(z.string()), question: z.string() }),
    func: async ({ urls, question }) => {
      console.log("urls", urls);
      console.log("question", question);
      let markdown: Promise<string[]> | any = [];
      for (const url of urls) {
        markdown.push(extractMarkdown(url, apiKey));
      }

      markdown = await Promise.all(markdown);

      const tokenLength = countTokens(JSON.stringify(markdown));
      console.log(
        `\n=======================\n Markdown Tokens Usage: \n ${JSON.stringify(tokenLength)} \n=======================\n`,
      );
      if (tokenLength > 125_000) {
        const splittedMarkdown = [];
        for (const md of markdown) {
          const docs = await markdownSplitter(md, {
            semanticSplitter: [
              ["#", "Super Title"],
              ["##", "Title"],
              ["###", "Sub Title"],
            ],
            chunkSize: 2000,
            chunkOverlap: 200,
          });
          console.log("========\n Docs \n", docs, "\n========");
          const embeddings = new OpenAIEmbeddings({
            apiKey: process.env.OPENAI_API_KEY,
          });
          const vectorStore = await FaissStore.fromDocuments(docs, embeddings);
          const results = await vectorStore.similaritySearch(question, 50);

          // Reranking for better results
          console.log("Reranking...");
          const cohereRerank = new CohereRerank({
            apiKey: process.env.COHERE_API_KEY, // Default
            model: "rerank-multilingual-v2.0",
          });
          // TODO: When the feature is ready to launch, we need to:
          //  1. Change the rerank model and provider to a free model and provider.
          //  2. Create a custom algorithm to handle the limitation.
          const rerankedDocuments = await cohereRerank.rerank(
            results,
            question,
            {
              topN: 20,
            },
          );
          const rerankResult = rerankedDocuments.map((r) => docs[r.index]);
          console.log("Reranked");

          const context = customFormatMarkdownDocAsString(
            rerankResult as ChainDoc[],
          );

          splittedMarkdown.push(context);
        }

        return JSON.stringify(splittedMarkdown);
      }

      return JSON.stringify(markdown);
    },
  });
