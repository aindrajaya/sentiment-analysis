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

export const GetActionableWebContentTool = (apiKey: string, action: string) =>
  new DynamicStructuredTool({
    name: "get-actionable-web-content",
    description: `Tool used when you need to get/search related web content from ${action}able web content. Please make sure the urls are valid href/link and not a halucinate!`,
    schema: z.object({
      webUrl: z.string(),
      urls: z.array(z.string()),
      question: z.string(),
    }),
    func: async ({ webUrl, urls, question }) => {
      console.log("javascripts", urls);
      console.log("question", question);
      let markdown: Promise<string[]> | any = [];
      for (const javascript of urls) {
        if (!javascript.startsWith("javascript:")) {
          return "Invalid URL, please make sure the urls are start with 'javascript:' and not other";
        }
      }
      markdown.push(extractMarkdown("click", webUrl, apiKey, urls));

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
