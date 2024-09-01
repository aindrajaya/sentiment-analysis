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
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
// ================== Internal libs =====================
import { MongoDBChatMessageHistory } from "../../utils/memory/chat_history.js";
import {
  countTokens,
  errorResponse,
  limitTokens,
  successResponse,
} from "../../utils/helper.util.js";
import {
  customFormatMarkdownDocAsString,
  splitMarkdownByHeaders,
} from "../../utils/etl/markdown.js";
import jsonParser from "../../utils/etl/jsonParser.js";

import {
  AiIdentifierBodyRequest,
  AiScraperBodyRequest,
  AiScraperV2BodyRequest,
  AiScraperV2BodyResponse,
} from "./types/interface.js";
import { SearchWebContentTool } from "../../utils/langchain/tools/searchWebContent.js";
import { createReActAgent } from "../../utils/langchain/agent/createReActAgent.js";
import { ChainWithMessageHistory } from "../../utils/langchain/chain/chainWithHistory.js";

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
) {
  try {
    const { task, userId, sessionId } = payload;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const markdown = await memory.getPageContent();
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

    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      streaming: true,
    });
    model.pipe(new JsonOutputParser());
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are an AI Scraper assistance build by MR Scraper. Your task is to provide what user want to scrape from available web content, you can use available tools that will help you to answer",
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
          "The explanation of scraped data. \n !IMPORTANT: add extra description and clear explanation about data scraped. all answer must be efficient and easy to understand and related to input and you have to make sure data scraped is shown with your extra description.",
        ),
      json: z
        .string()
        .describe(
          "the json format of scraped data, !IMPORTANT should in json markdown format like ```json RESULT_HERE ```",
        ),
    });
    const agent = await createReActAgent({
      model,
      tools,
      prompt,
      finalResponseSchema,
      streamRunnable: true,
    });
    const runnable = new AgentExecutor({
      agent,
      tools,
      verbose: true,
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

    const logStream = await withHistory.streamLog({ input: task }, config);
    let finalState;
    let currentDesc = "";
    let currentJson = "";
    let currentStream = "";
    for await (const chunk of logStream) {
      if (!finalState) {
        finalState = chunk;
      } else {
        finalState = finalState.concat(chunk);
      }
      console.log("Agent Chunk:", JSON.stringify(chunk, null, 2));
      if (
        chunk.ops.length > 1 &&
        chunk.ops[1].op == "add" &&
        (chunk.ops[1].path == "/logs/ChatOpenAI:2/streamed_output/-" ||
          chunk.ops[1].path == "/logs/ChatOpenAI/streamed_output/-")
      ) {
        const addOp = chunk.ops[1];
        if (
          addOp.value instanceof ChatGenerationChunk &&
          addOp.value.message instanceof AIMessageChunk
        ) {
          const content =
            addOp.value.message.additional_kwargs.function_call?.arguments;
          const data: AiScraperV2BodyResponse = {
            desc: "",
            json: "",
          };
          if (typeof content == "string") {
            if (content.includes("desc")) {
              currentStream = "desc";
            } else if (content.includes("json")) {
              currentStream = "json";
            }

            if (currentStream == "desc") {
              currentDesc += content;
              currentDesc = currentDesc
                .replace("desc", "")
                .replace(`desc":"`, "")
                .replace(`":"`, "")
                .replace(`"`, "")
                .replace(`:`, "")
                .replace(`","`, "")
                .replace(`,"`, "");
              data.desc = currentDesc;
            } else if (currentStream == "json") {
              currentJson += content;
              data.desc = currentDesc;
              if (currentJson.includes("```json")) {
                const jsonContentMatch =
                  currentJson.match(/```json([\s\S]*?)```/);
                if (!jsonContentMatch) {
                  const startIndex = currentJson.indexOf("```json");
                  data.json = currentJson.substring(startIndex);
                } else {
                  data.json = "```json" + jsonContentMatch[1] + "```";
                }
              } else {
                console.log("current json", currentJson);
                if (currentJson.includes(`json":"`)) {
                  const jsonContentMatch =
                    currentJson.match(/json": "([\s\S]*?)"/);
                  if (!jsonContentMatch) {
                    const startIndex = currentJson.indexOf(`json": "`);
                    data.json =
                      "```json \n" +
                      currentJson.substring(startIndex + 8) +
                      "```";
                  } else {
                    data.json = "```json" + jsonContentMatch[1] + "```";
                  }
                }
              }
            }
            callback(data);
          }
        }
      } else if (
        chunk.ops.length > 0 &&
        chunk.ops[0].op == "replace" &&
        chunk.ops[0].path == "/final_output"
      ) {
        const replaceOp = chunk.ops[0];
        const content = replaceOp.value.output;

        if (content) {
          callback(content);
        }
      }
    }
  } catch (error: any) {
    console.error("Error", error);
    callback({
      desc: "Ups, something went wrong.",
      json: `\`\`\`json {error: "${error?.message}" } \`\`\``,
    });
  }
}

export async function identifyContent(req: Request, res: Response) {
  try {
    const { markdown, userId } = req.body as AiIdentifierBodyRequest;
    const context = limitTokens(markdown, 125_000);
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are an AI Scraper assistance build by MR Scraper, your task is to tell user what data can be scraped from the web content given, please provide trully information what data can bet scraped without any additional information that is no included in the web content user given.",
      ],
      ["user", "Web Content: {input}"],
    ]);
    const input = `Web Content:${context}`;
    const inputTokens = countTokens(input);
    console.log(`\n=======\nInput token usage: ${inputTokens}\n=======\n`);

    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    });
    const outputParser = new StringOutputParser();
    const llmChain = prompt.pipe(chatModel).pipe(outputParser);
    const result = await llmChain.invoke({ input: context });
    console.log("\nAnswer:\n", result);
    const output = result;
    const outputTokens = countTokens(output);
    console.log(`\n=======\nOutput tokens usage: ${outputTokens}\n=======\n`);
    if (output) {
      const memory = new MongoDBChatMessageHistory({ userId });
      const session = await memory.createSession(markdown);
      return successResponse(
        res,
        "AI Scraper completed successfully",
        {
          content: output,
          sesionId: session,
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
