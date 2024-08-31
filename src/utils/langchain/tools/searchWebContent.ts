import "dotenv/config";
import { Tool, ToolParams } from "langchain/tools";
import { Document as ChainDoc } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { CohereRerank } from "@langchain/cohere";
import { customFormatMarkdownDocAsString } from "../../etl/markdown.js";
export class SearchWebContentTool extends Tool {
  data: ChainDoc[] = [];
  static lc_name() {
    return "SearchWebContentTool";
  }

  name = "search-web-content-tool";

  description =
    "Tool used when you need to search related web content to answer user question.";

  constructor(data: ChainDoc[], config?: ToolParams) {
    super(config);
    this.data = data;
  }

  async _call(query: string) {
    // Vectorization & Similarity Search
    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const vectorStore = await FaissStore.fromDocuments(this.data, embeddings);
    const results = await vectorStore.similaritySearch(query, 50);

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
      topN: 20,
    });
    const rerankResult = rerankedDocuments.map((r) => this.data[r.index]);
    console.log("Rerank", rerankResult);

    const context = customFormatMarkdownDocAsString(rerankResult);

    return context;
  }
}
