// ============ Other libs =================
import "dotenv/config";
import { Request, Response } from "express";
import { z } from "zod";
import { jsonSchemaToZod } from "json-schema-to-zod";
// ================= Langhchain libs ====================
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { CohereRerank } from "@langchain/cohere";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentExecutor } from "langchain/agents";
import type { BaseMessagePromptTemplateLike } from "@langchain/core/prompts";
import type { InputValues } from "@langchain/core/utils/types";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  PromptTemplate,
} from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";
import { FunctionDefinition } from "@langchain/core/language_models/base";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  StructuredOutputParser,
  OutputFixingParser,
} from "langchain/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
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
  AIItemsSchema,
  AIOutputSchema,
  AIPropertiesSchema,
  AiScraperApiBodyRequest,
  AiScraperBodyRequest,
  AiScraperV2BodyRequest,
  AiScraperV2BodyResponse,
  AiScraperV2FinalAnswerBodyRequest,
  AiScraperV2GetChatHistoryBodyResponse,
  AiScraperV2GetChatHistoryParamsRequest,
  AiScraperV2GetSessionsBodyResponse,
  AiScraperV2GetSessionsParamsRequest,
  AiScraperV2MigrateChatHistoryBodyRequest,
  AiScraperV2TokenUsageBodyResponse,
} from "./types/interface.js";
import {
  LLMResult,
  UsageMetadata,
} from "../../utils/langchain/callbacks/llm/types/interfacte.js";
import { SearchWebContentTool } from "../../utils/langchain/tools/searchWebContent.js";
import { createReActAgent } from "../../utils/langchain/agent/createReActAgent.js";
import { ChainWithMessageHistory } from "../../utils/langchain/chain/chainWithHistory.js";
import openAICallbackHandler from "../../utils/langchain/callbacks/llm/openAiCb.js"; // NOTE: PIPELINE: ETL process -> vectorization -> similiarity search -> reranking -> chat ai -> output parser
import { AIOutputMessage } from "../../utils/langchain/message/ai.js";
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
export async function askAiV2(
  payload: AiScraperV2BodyRequest,
  callback: (response: AiScraperV2BodyResponse, isFinal: boolean) => void,
  streaming: boolean = true,
) {
  try {
    let { task, userId, sessionId, scraperId } = payload;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const { pageContent, webPage } = await memory.getPageContent();
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
        `You are an AI Scraper assistance build by MR Scraper. Your task is to provide what user want to scrape/get from available web content at ${webPage}, you can use available tools that will help you to answer. If you have to return the data in json format, please make sure you return it with pretty json. \n\n NOTE: Currently your in a beta version so you still in learning proccess to get better scraping data.`,
      ],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"],
      [
        "system",
        "!!IMPORTANT DO NOT TO GIVE: \n 1. Information that is not included in the search results or history.. \n 2. If there's a lot of data, ensure no repeated JSON results. All entries must be unique. You can tell the user the data may not meet their needs, or inform them that ScrapeGPT is still in beta version, and our developers are working hard to improve its performance. \n\n !!IMPORTANT: \n PROVIDE: \n 1. Efficient answers \n 2. Clear explanations \n 3. Extra descriptions \n 4. Readable JSON format with unique entries (make sure there is no repeated data) \n 5. Relevance to the input \n 6. Follow-up questions at the end of the explanation e.g 'Do you want to know more about this?' or  'Which data do you want to scrape?'",
      ],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);
    const tools = [new SearchWebContentTool(pageContent)];

    const finalResponseSchema = z.object({
      desc: z.string().describe("The explanation of scraped data"),
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

    if (streaming) {
      const logStream = await withHistory.streamLog({ input: task }, config);
      await streamAIV2Response(
        logStream,
        callback,
        userId,
        sessionId,
        scraperId,
      );
    } else {
      const result = await withHistory.invoke({ input: task }, config);
      console.log("Result", result);
      callback(
        { desc: result?.output?.desc, json: result?.output?.json },
        true,
      );
    }
  } catch (error: any) {
    console.error("Error", error);
    callback(
      {
        desc: "Ups, something went wrong.",
        json: `\`\`\`json {error: "${error?.message}" } \`\`\``,
      },
      true,
    );
  }
}

const convertPropertiesToCommaseparated = (
  properties: AIPropertiesSchema,
  min: number,
  max: number,
) => {
  let prompt = "";
  Object.keys(properties!).forEach((key, index) => {
    if (properties[key].type === "object") {
      prompt += convertPropertiesToCommaseparated(
        properties[key].properties!,
        min,
        max,
      );
    } else if (properties[key].type === "array") {
      prompt += `- ${key} with type ${properties[key].type} (${
        properties[key].description || ""
      })\n`;
      prompt += convertItemsToCommaseparated(properties[key].items!, min, max);
    } else {
      prompt += `- ${key} with type ${properties![key].type} (${
        properties![key].description || ""
      })\n`;
    }
  });
  return prompt;
};

const convertItemsToCommaseparated = (
  items: AIItemsSchema,
  min: number,
  max: number,
) => {
  let prompt = "";
  const type = `List ${items!.type == "object" ? "object" : ""}  (${
    items!.description
  }). Please provide the data with unique entries \nMINIMUM data: ${
    min ?? 1
  } \nMAXIMUM data: ${max ?? 1} \n`;
  let detail = "";
  if (items!.properties) {
    detail += "Object properties:\n";
    detail += convertPropertiesToCommaseparated(items!.properties!, min, max);
  } else if (items!.items) {
    prompt += convertItemsToCommaseparated(items!.items!, min, max);
  }

  prompt += `${type}\n${detail}\n`;

  return prompt;
};

const convertSchemaToCommaSeparated = (
  schema: AIOutputSchema,
  min: number,
  max: number,
) => {
  let prompt = "";
  if (schema.type === "object") {
    prompt += convertPropertiesToCommaseparated(schema.properties!, min, max);
  } else if (schema.type === "array") {
    prompt += ``;
    prompt += convertItemsToCommaseparated(schema.items!, min, max);
  } else {
    prompt += `${schema.description} with type ${schema.type}\n`;
  }

  return prompt;
};

export async function askAIAPI(req: Request, res: Response) {
  try {
    const { url, markdown, schema, min, max } =
      req.body as AiScraperApiBodyRequest;
    const context = limitTokens(markdown, 125_000);
    const schemaPrompt = convertSchemaToCommaSeparated(schema, min, max);
    console.log("Schema Prompt", schemaPrompt);
    let inputTokens = 0;
    let outputTokens = 0;
    let user:
      | ChatPromptTemplate<InputValues, string>
      | BaseMessagePromptTemplateLike = [
      "user",
      `I need: \n--------------\n{user_want}\n--------------\n from this Web Content as many as possible : \n--------------\n{input}\n--------------\n`,
    ];
    let system1: BaseMessagePromptTemplateLike = [
      "system",
      `You are an AI Scraper assistant created by MR Scraper. Your role is to extract all available data as many as possible from the web content at ${url} and provide it in a JSON format as per the user's request`,
    ];
    let systemGuard: BaseMessagePromptTemplateLike = [
      "system",
      "!!IMPORTANT DO NOT TO GIVE: \n 1. Information that is not included in web content \n 2. If there's a lot of data, ensure no repeated JSON results. All entries must be unique. \n\n !!IMPORTANT: \n PROVIDE: \n 1. Readable JSON format as given with unique entries (make sure there is no repeated data)",
    ];
    const finalResponseSchema = eval(jsonSchemaToZod(schema));
    console.log(zodToJsonSchema(finalResponseSchema));
    let extractorSchema: FunctionDefinition = {
      name: "extractor",
      description: "Extracts fields from the input.",
      parameters: zodToJsonSchema(finalResponseSchema),
    };
    console.log("Here the extracted schema", extractorSchema);
    const prompt = ChatPromptTemplate.fromMessages([
      system1,
      user,
      systemGuard,
    ]);
    const parser = StructuredOutputParser.fromZodSchema(finalResponseSchema);
    const countTokens = (usageMetadata: UsageMetadata) => {
      inputTokens += usageMetadata.input_tokens;
      outputTokens += usageMetadata.output_tokens;
    };
    let answer = "";
    const llmOutput = (
      output: LLMResult,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ) => {
      answer = output.generations[0][0].text;
    };
    const llmCallback = openAICallbackHandler(
      true,
      countTokens,
      () => {},
      llmOutput,
    );
    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    }).bind({
      callbacks: [llmCallback],
    });
    const llmChain = RunnableSequence.from([prompt, chatModel, parser]);
    let result;
    try {
      result = await llmChain.invoke({
        input: context,
        user_want: schemaPrompt,
        format_instructions: parser.getFormatInstructions(),
      });
    } catch (error: any) {
      console.error("Error parsing json result", error);
      console.log("Answer", answer);
      const fixParser = OutputFixingParser.fromLLM(
        new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" }),
        parser,
        {
          prompt: PromptTemplate.fromTemplate(
            "Instructions:\n--------------\n{instructions}\n--------------\nCompletion:\n--------------\n{completion}\n--------------\n\nAbove, the Completion did not satisfy the constraints given in the Instructions.\nError:\n--------------\n{error}\n--------------\n\nPlease try again. \n\n !IMPORTANT\n 1. Do not give data that not included in the completion (you can give an empty value with the same type laid out in the instructions) \n 2. Do Not Halucinate! \n 3. Only respond with an answer that satisfies the constraints laid out in the Instructions:",
          ),
        },
      );
      result = await fixParser.parse(answer);
      console.log("Fixed Result", result);
    }
    console.log("\nAnswer:\n", result);
    const output = result;
    console.log(`\n=======\nInput token usage: ${inputTokens}\n=======\n`);
    console.log(`\n=======\nOutput tokens usage: ${outputTokens}\n=======\n`);
    if (output) {
      return successResponse(
        res,
        "AI Scraper completed successfully",
        {
          result: output,
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

export async function getConversationTokenUsage(req: Request, res: Response) {
  try {
    const { userId, sessionId } =
      req.params as unknown as AiScraperV2GetChatHistoryParamsRequest;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const result: AiScraperV2TokenUsageBodyResponse =
      await memory.getConversationTokenUsage();
    return successResponse(res, "success", result, 200);
  } catch (error: any) {
    console.error("Error", error);
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}

export async function migrateChatHistory(req: Request, res: Response) {
  try {
    const { userId, sessionId } =
      req.params as unknown as AiScraperV2GetChatHistoryParamsRequest;
    const { newUserId } =
      req.body as unknown as AiScraperV2MigrateChatHistoryBodyRequest;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const result = await memory.updateSessionOwnership(newUserId);
    return successResponse(
      res,
      "Session migrated successfully",
      { isUpdated: result },
      200,
    );
  } catch (error: any) {
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
    const { markdown, userId, url, screenshot, isError, httpStatus } =
      req.body as AiIdentifierBodyRequest;
    const context = limitTokens(markdown, 125_000);
    let inputTokens = 0;
    let outputTokens = 0;
    let user:
      | ChatPromptTemplate<InputValues, string>
      | BaseMessagePromptTemplateLike = [
      "user",
      `URL: {url},  Web Content: {input}`,
    ];
    let system1: BaseMessagePromptTemplateLike = [
      "system",
      "You are an AI Scraper assistance build by MR Scraper, your task is to create the title for this web and tell user what data can be scraped from the web content given, please provide trully information what data can be scraped in readable format without any additional information that is no included in the web content user given. You should give an additional followup question to user at the end of exaplanation",
    ];
    let systemGuard: BaseMessagePromptTemplateLike = [
      "system",
      "!!IMPORTANT: \n PROVIDE: \n 1. Clear explanations with READABLE format!  \n  2. Follow-up questions to starting the conversation at the end of the explanation e.g 'Which data do you want to scrape? 3. Explanation How many data that can be scraped",
    ];
    let extractorSchema: FunctionDefinition = {
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
          followup: {
            type: "string",
            description:
              "Follow-up questions to starting the conversation at the end of the explanation",
          },
          howMany: {
            type: "string",
            description: "Explanation How many data that can be scraped",
          },
        },
      },
    };
    if (isError) {
      system1 = [
        "system",
        "You are an AI Scraper assistance build by MR Scraper, your task is to analyze user problem when do a scraping, you should provide the solution to the user problem from the image given",
      ];
      user = [
        "user",
        // @ts-ignore
        [
          {
            type: "text",
            text: "I have a problem with the scraping i got this http status code: {httpStatus}, and this my web look like:",
          },
          {
            type: "image_url",
            image_url: "data:image/jpeg;base64,{screenshot}",
          },
        ],
      ];
      systemGuard = [
        "system",
        `FORMAT INSTRUCTIONS! 
Analyze the image given by user, identify the problem as below:
1. Title for the problem (e.g. Proxy Error, Bot Detected, Auth Required)
2. What is the problem? (proxy_error, bot_detected, auth_required) with snake case (e.g. bot_detected)
3. What is the solution? 
  a. if the problem is proxy_error, the solution is to use a different proxy. (proxy)
  b. if the problem is bot_detected, the solution is to use a different proxy also, because the current proxy is detected as a bot. (proxy)
  c. if the problem is auth_required, the solution is to login to the website. (login)
4. How to solve the problem?  
  a. if the solution is to use a different proxy, suggest user to use user best custom proxy provider if available or try again the scraping (important to give step by step with Readable list format).
  b. if the solution is to login to the website, provide the step to login to the website (important to give step by step with Readable format).
5. What is the impact of the problem? (e.g. can't scrape data, can't login)`,
      ];
      extractorSchema = {
        name: "extractor",
        description: "Extracts fields from the input.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title for the problem",
            },
            problem: {
              type: "string",
              description: "The problem",
            },
            solution: {
              type: "string",
              description: "The solution for the problem",
            },
            howTo: {
              type: "string",
              description: "Step to solve the problem",
            },
            impact: {
              type: "string",
              description: "Explanation of the impact of the problem",
            },
          },
        },
      };
    }
    const prompt = ChatPromptTemplate.fromMessages([
      system1,
      user,
      systemGuard,
    ]);

    const parser = new JsonOutputFunctionsParser();
    let cost = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    const countTokens = (usageMetadata: UsageMetadata) => {
      cost = usageMetadata;
      inputTokens += usageMetadata.input_tokens;
      outputTokens += usageMetadata.output_tokens;
    };
    const llmCallback = openAICallbackHandler(true, countTokens);
    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    }).bind({
      functions: [extractorSchema],
      function_call: { name: "extractor" },
      callbacks: [llmCallback],
    });
    const llmChain = prompt.pipe(chatModel).pipe(parser);
    let content = "";
    let result;
    if (!isError) {
      result = await llmChain.invoke({ input: context, url });
      // @ts-ignore
      content = `#${result?.title}\n\n${result?.content}\n\n${result?.howMany}\n${result?.followup}`;
    } else {
      result = await llmChain.invoke({ screenshot, httpStatus });
      // @ts-ignore
      content = `#${result.title}\n\n${result.problem}\n\n${result.solution}\n\n${result.howTo}\n\n${result.impact}`;
    }
    console.log("\nAnswer:\n", result);
    const output = result;
    console.log(`\n=======\nInput token usage: ${inputTokens}\n=======\n`);
    console.log(`\n=======\nOutput tokens usage: ${outputTokens}\n=======\n`);
    if (output) {
      const memory = new MongoDBChatMessageHistory({ userId });
      const session = await memory.createSession(markdown, url);
      const humanMessage: BaseMessage = new HumanMessage(
        "Identify the web content",
      );
      const aiMessage: BaseMessage = new AIOutputMessage(
        JSON.stringify({
          data_that_can_be_scraped: content,
          usage_metadata: cost,
        }),
      );
      console.log("AI Message", aiMessage);
      await memory.addMessages([humanMessage, aiMessage]);
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
