// ============ Other libs =================
import "dotenv/config";
import { Request, Response } from "express";
import { z } from "zod";
// ================= Langhchain libs ====================
import { CohereRerank } from "@langchain/cohere";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentExecutor } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Serialized } from "@langchain/core/load/serializable";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";
// ================== Internal libs =====================
import { MongoDBChatMessageHistory } from "../../utils/memory/chat_history.js";
import {
  countTokens,
  errorResponse,
  limitTokens,
  streamAIV2Response,
  successResponse,
} from "../../utils/helper.util.js";
import {
  customFormatMarkdownDocAsString,
  splitMarkdownByHeaders,
} from "../../utils/etl/markdown.js";
import { markdownSplitter } from "../../utils/etl/markdown.js";
import jsonParser from "../../utils/etl/jsonParser.js";

import {
  AiIdentifierBodyRequest,
  AiScraperBodyRequest,
  AiScraperV2BodyRequest,
  AiScraperV2BodyResponse,
  AiScraperV2FinalAnswerBodyRequest,
  AiScraperV2GetChatHistoryBodyResponse,
  AiScraperV2GetChatHistoryParamsRequest,
  AiScraperV2GetSessionsBodyResponse,
  AiScraperV2GetSessionsParamsRequest,
} from "./types/interface.js";
import {
  LLMResult,
  UsageMetadata,
} from "../../utils/langchain/callbacks/llm/types/interfacte.js";
import { SearchWebContentTool } from "../../utils/langchain/tools/searchWebContent.js";
import { createReActAgent } from "../../utils/langchain/agent/createReActAgent.js";
import { ChainWithMessageHistory } from "../../utils/langchain/chain/chainWithHistory.js";
import openAICallbackHandler from "../../utils/langchain/callbacks/llm/openAiCb.js";

// NOTE: PIPELINE: ETL process -> vectorization -> similiarity search -> reranking -> chat ai -> output parser
export async function askAi(req: Request, res: Response) {
  try {
    const { markdown, task } = req.body as AiScraperBodyRequest;
    // // STEP 1  [x]: ============== ETL Process===============

    // [x] Load into splitted Semantic Documents
    const splitMarkdown = splitMarkdownByHeaders(markdown, [
      ["#", "Super Title"],
      ["##", "Title"],
      ["###", "Sub Title"],
    ]);
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 200,
    });
    const docs = await splitter.splitDocuments(splitMarkdown);
    console.log("Split Markdown", docs);

    // STEP 2: [x] ============== Filtering ===============

    // Vectorization & Similarity Search
    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const vectorStore = await FaissStore.fromDocuments(docs, embeddings);
    const results = await vectorStore.similaritySearch(task, 50);

    // Reranking for better results
    console.log("Reranking...");
    const cohereRerank = new CohereRerank({
      apiKey: process.env.COHERE_API_KEY, // Default
      model: "rerank-multilingual-v2.0",
    });
    // TODO: When the feature is ready to launch, we need to:
    //  1. Change the rerank model and provider to a free model and provider.
    //  2. Create a custom algorithm to handle the limitation.
    const rerankedDocuments = await cohereRerank.rerank(results, task, {
      topN: 20,
    });
    const rerankResult = rerankedDocuments.map((r) => docs[r.index]);
    console.log("Rerank", rerankResult);

    // STEP 3: [x] ============== Chat AI ===============
    console.log("Chat AI...");
    const context = customFormatMarkdownDocAsString(rerankResult);
    const input = `Text:${context}\n\n\nI need ${task} from the above data".\n IMPORTANT!! return the answer with json format \n eg. \`\`\`json\n JSON_HERE \`\`\` and limit the use of token output to no more than 16000 tokens`;
    const inputTokens = countTokens(input);
    console.log(`\n=======\nInput token usage: ${inputTokens}\n=======\n`);

    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    }).bind({
      response_format: {
        type: "json_object",
      },
    });
    const result = await chatModel.invoke(input);
    console.log("\nAnswer:\n", result.content);

    // STEP 4: [x] ============== Output Parser ===============
    console.log("Parsing into JSON format...");
    const output = jsonParser(result.content.toString());
    const outputTokens = countTokens(result.content.toString());
    console.log(`\n=======\nOutput tokens usage: ${outputTokens}\n=======\n`);
    console.log("Output", output);
    if (output) {
      return successResponse(
        res,
        "AI Scraper completed successfully",
        {
          json: output,
          task,
          inputTokens,
          outputTokens,
        },
        200,
      );
    }
    return errorResponse(
      res,
      "Internal server error",
      "Error parsing output",
      500,
    );
  } catch (error: any) {
    console.error("Error", error);
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}

// HACK: Ask AI V2 is an improved version of the Ask AI function to make the result more accurate and improve user experience with the conversation.
// NOTE: PIPELINE: ETL process -> vectorization -> similiarity search -> reranking -> agent
// TODO: create an agent to handle the conversation with the user and stream the process.
// AGENT Type: ReAct (Reasoning and Action)
// AGENT PIPELINE: QUERY -> Thought -> Action -> Action Input -> Observation -> Repeat if needed -> Final Answer
// AGENT Description:
// the agent is responsible for handling the conversation with the user search/read/write memory, thought process, and decision making, agent will have some tools can use to give best answer for user.
// AGENT Tools:
// 1. Manage memory search/read/write memory data.
// 2. Summerize the conversation with the user.
// 3. Combinator for combine new similiar document with previous documents used in the conversation.
// 4. Search related documents with user query. (eg. in previous conversation ai answered a question about a specific topic, the user can ask the ai to provide more information about the topic)
//
//
// PIPELINE Starting Conversation +  Indetification + Starting conversation: lambda (loading...) -> scraper -> create session -> {userId, markdown, sessionId} mrscrper -> chat open ai -> indentifcation
// PIPELINE Conversation (Stream): mrscraper {task, userId, sessionId} <-> agent
//
// {desc: "a"}
// {desc: "a is"}
// {desc: "a is for", result: '```json {a: } ```'}
// {desc: "a is for apple", result '```json {a: apple } ```}
//
//
/** HACK: SOME DATA SCHEMA DETAILS:
    AI Answer Schema
    - descritption: "the answer"
    - result: "```json JSON_RESULT ```"
    Memory schema
    - userId: the user id
    - sessionId: unique id for the user session
    - chatHistory: chat history for the user session
    - - chatHistory schema
    - - - id: unique id for the chat message
    - - - query: the message sent by the user
    - - - aiAnswer: the answer from the ai {descritption: "the answer",result: "```json JSON_RESULT ```"}
    - - - documentUsed: the documents from chunk of pageContent used in the conversation
    - - - oToken: 
    - - - iToken:
    - aiFinalAnswer: ai answer that has confirmed by the user in json string format {descritption: "the answer",result: "```json JSON_RESULT ```"}
    - pageContent: the documents used in the conversation
    - documents: chunk of pageContent
    - totalInputToken: total token used in the conversation
    - totalOutputToken: total token used in the conversation
**/

/** HACK: Manage Memory Tool DETAILS:
 *   Ref: https://js.langchain.com/v0.1/docs/integrations/chat_memory/mongodb/
 *   PARAMS: userId, sessionId
 *   Functions:
 *   1. getMemory: get the memory for the user session if exists, if not exists create a new memory.
 *   2. saveMemory: save the memory for the user session.
 *   3. searchMemory: search top N chat history that related to the user query.
 **/

/** HACK: Search Tool DETAILS:
 *    Ref: previous approuch
 *   PARAMS: q, documents
 *   Functions:
 *   1. similiarySearch:  search top N similiar documents for the user query.
 *   2. rerank: rerank the search results for better results.
 **/

/** HACK: Combinator Tool DETAILS:
 *   Ref: https://js.langchain.com/v0.1/docs/modules/data_connection/document_loaders/custom/
 *   PARAMS: documents, newDocument
 *   Functions:
 *   1. combine: combine newDocument with documents and return the combined documents.
 *   2. combineAndSplit: combine newDocument with documents and split the combined documents into chunks.
 **/

// NOTE: the agent will stream the progress and the final answer to the user.
// FOR Streaming reference: https://js.langchain.com/v0.1/docs/modules/agents/how_to/streaming/
export async function askAiV2(
  payload: AiScraperV2BodyRequest,
  callback: (response: AiScraperV2BodyResponse) => void,
  streaming: boolean = true,
) {
  try {
    const { task, userId, sessionId, scraperId } = payload;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const markdown = await memory.getPageContent();
    const docs = await markdownSplitter(markdown);
    const countTokens = (usageMetadata: UsageMetadata) => {
      memory.addSessionUsageMetadata(usageMetadata);
    };
    const llmCallback = openAICallbackHandler(true, countTokens);
    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      streaming,
      callbacks: [llmCallback],
    });
    model.pipe(new JsonOutputParser());
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are an AI Scraper assistance build by MR Scraper. Your task is to provide what user want to scrape/get from available web content, you can use available tools that will help you to answer. If you have to return the data in json format, please make sure you return it with pretty json. \n !IMPORTANT Do not to give information that not included in the search result or history",
      ],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);
    const tools = [new SearchWebContentTool(docs)];

    const finalResponseSchema = z.object({
      desc: z
        .string()
        .describe(
          "The explanation of scraped data. \n !IMPORTANT: add extra description and clear explanation about data scraped. all answer must be efficient and easy to understand and related to input and you have to make sure data scraped is shown with your extra description with readable format not json format!.",
        ),
      json: z
        .string()
        .describe(
          "the json format of scraped data, !IMPORTANT should in json markdown format like ```json RESULT_HERE ```, make sure the json is in pretty with multiple line and readable.",
        ),
    });
    const agent = await createReActAgent({
      model,
      tools,
      prompt,
      finalResponseSchema,
      streamRunnable: streaming,
    });
    const runnable = new AgentExecutor({
      agent,
      tools,
      // verbose: true,
    });
    const withHistory = new ChainWithMessageHistory({
      runnable,
      getMessageHistory: (_sessionId) => memory,
      inputMessagesKey: "input",
      historyMessagesKey: "chat_history",
      outputMessagesKey: "output",
    });

    const config: RunnableConfig = {
      configurable: { sessionId: { id: sessionId, userId } },
    };

    if (streaming) {
      const logStream = await withHistory.streamLog({ input: task }, config);
      await streamAIV2Response(logStream, callback, userId, sessionId, scraperId);
    } else {
      const result = await withHistory.invoke({ input: task }, config);
      console.log("Result", result);
      callback({ desc: result?.output?.desc, json: result?.output?.json });
    }
  } catch (error: any) {
    console.error("Error", error);
    callback({
      desc: "Ups, something went wrong.",
      json: `\`\`\`json {error: "${error?.message}" } \`\`\``,
    });
  }
}

export async function getSessions(req: Request, res: Response) {
  try {
    const { userId } =
      req.params as unknown as AiScraperV2GetSessionsParamsRequest;
    const memory = new MongoDBChatMessageHistory({ userId });
    const result: AiScraperV2GetSessionsBodyResponse[] =
      await memory.getSessions();
    return successResponse(
      res,
      "Your sessions successfully netted",
      result,
      200,
    );
  } catch (error: any) {
    console.error("Error", error);
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}

export async function getChatHistory(req: Request, res: Response) {
  try {
    const { userId, sessionId } =
      req.params as unknown as AiScraperV2GetChatHistoryParamsRequest;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const result: AiScraperV2GetChatHistoryBodyResponse =
      await memory.getChatHistory();
    return successResponse(res, "Hi, welcome back!", result, 200);
  } catch (error: any) {
    console.error("Error", error);
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}

export async function saveFinalAnswer(req: Request, res: Response) {
  try {
    const { userId, sessionId } = req.body as AiScraperV2FinalAnswerBodyRequest;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const result = await memory.saveFinalAnswer();
    return successResponse(res, "Final data already netted", result, 200);
  } catch (error: any) {
    console.error("Error", error);
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}

export async function identifyContent(req: Request, res: Response) {
  try {
    const { markdown, userId, url } = req.body as AiIdentifierBodyRequest;
    const context = limitTokens(markdown, 125_000);
    let inputTokens = 0;
    let outputTokens = 0;
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are an AI Scraper assistance build by MR Scraper, your task is to create the title for this web and tell user what data can be scraped from the web content given, please provide trully information what data can be scraped without any additional information that is no included in the web content user given.",
      ],
      ["user", "URL: {url},  Web Content: {input}"],
    ]);

    const extractorSchema = {
      name: "extractor",
      description: "Extracts fields from the input.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The title of the web content",
          },
          content: {
            type: "string",
            description:
              "information what data can be scraped without any additional information that is no included in the web content user given",
          },
        },
      },
    };
    const parser = new JsonOutputFunctionsParser();
    const llmCallback = BaseCallbackHandler.fromMethods({
      handleLLMStart(
        llm: Serialized,
        prompts: string[],
        runId: string,
        parentRunId?: string,
        extraParams?: Record<string, unknown>,
        tags?: string[],
        metadata?: Record<string, unknown>,
        runName?: string,
      ) {
        console.log("handleLLMStart: LLM:", { llm });
        console.log("handleLLMStart: Prompt:", { prompts });
        console.log("handleLLMStart: Metadata:", { metadata });
      },
      handleLLMEnd(
        output: LLMResult,
        runId: string,
        parentRunId?: string,
        tags?: string[],
      ) {
        if (output) {
          console.log(
            "handleLLMEnd: Output:",
            JSON.stringify({ ...output.generations[0][0].message }, null, 2),
          );
          const usageMetadata =
            output.generations[0][0].message?.kwargs?.usage_metadata ||
            output.generations[0][0].message?.usage_metadata;
          if (usageMetadata) {
            console.log("handleLLMEnd: Usage Metadata:", { usageMetadata });
            const { input_tokens, output_tokens } = usageMetadata;
            inputTokens += input_tokens;
            outputTokens += output_tokens;
          }
        }
      },
      handleChainStart(chain) {
        console.log("handleChainStart: I'm the second handler!!", { chain });
      },
      handleAgentAction(action) {
        console.log("handleAgentAction", action);
      },
      handleToolStart(tool) {
        console.log("handleToolStart", { tool });
      },
    });
    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    }).bind({
      functions: [extractorSchema],
      function_call: { name: "extractor" },
      callbacks: [llmCallback],
    });
    const llmChain = prompt.pipe(chatModel).pipe(parser);
    const result = await llmChain.invoke({ input: context, url });
    console.log("\nAnswer:\n", result);
    const output = result;
    console.log(`\n=======\nInput token usage: ${inputTokens}\n=======\n`);
    console.log(`\n=======\nOutput tokens usage: ${outputTokens}\n=======\n`);
    if (output) {
      const memory = new MongoDBChatMessageHistory({ userId });
      const session = await memory.createSession(markdown, url);
      return successResponse(
        res,
        "AI Scraper completed successfully",
        {
          ...output,
          sesionId: session,
          inputTokens,
          outputTokens,
        },
        200,
      );
    }
  } catch (error: any) {
    console.error("Error", error);
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}
