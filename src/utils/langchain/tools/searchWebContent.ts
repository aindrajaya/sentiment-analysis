import "dotenv/config";
import { Tool, ToolParams } from "langchain/tools";
import { Document as ChainDoc } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { CohereRerank } from "@langchain/cohere";
import {
  customFormatMarkdownDocAsString,
  markdownSplitter,
} from "../../etl/markdown.js";
import { countTokens } from "../../helper.util.js";
export class SearchWebContentTool extends Tool {
  data: ChainDoc[] | string = [];
  pageContent: string = "";
  limitToken = 125_000;
  static lc_name() {
    return "SearchWebContentTool";
  }

  name = "search-web-content-tool";

  description =
    "Tool used when you need to search related web content to answer user question from the current page.";

  constructor(data: string, config?: ToolParams) {
    super(config);
    this.pageContent = data;
  }

  async _call(query: string) {
    const tokenLength = countTokens(this.pageContent, "gpt-4o-mini");
    if (tokenLength > this.limitToken) {
      this.data = await markdownSplitter(this.pageContent);
      const embeddings = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
      });
      const vectorStore = await FaissStore.fromDocuments(this.data, embeddings);
      const results = await vectorStore.similaritySearch(query, 100);

      // Reranking for better results
      console.log("Reranking...");
      const cohereRerank = new CohereRerank({
        apiKey: process.env.COHERE_API_KEY, // Default
        model: "rerank-multilingual-v2.0",
      });
      // TODO: When the feature is ready to launch, we need to:
      //  1. Change the rerank model and provider to a free model and provider.
      //  2. Create a custom algorithm to handle the limitation.
      const rerankedDocuments = await cohereRerank.rerank(results, query, {
        topN: 50,
      });
      const rerankResult = rerankedDocuments.map((r) => this.data[r.index]);
      console.log("Reranked");

      const context = customFormatMarkdownDocAsString(
        rerankResult as ChainDoc[],
      );

      return context;
    } else {
      console.log("No need to split");
      this.data = this.pageContent;
      return this.data;
    }
    // Vectorization & Similarity Search
  }
}
