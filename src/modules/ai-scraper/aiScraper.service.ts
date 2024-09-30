// ============ Other libs =================
import "dotenv/config";
import { Request, Response } from "express";
import { z } from "zod";
import { jsonSchemaToZod } from "json-schema-to-zod";
// ================= Langhchain libs ====================
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
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
} from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { FunctionDefinition } from "@langchain/core/language_models/base";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  JsonOutputFunctionsParser,
  StructuredOutputParser,
} from "langchain/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
// ================== Internal libs =====================
import { MongoDBChatMessageHistory } from "../../utils/memory/chatHistory.js";
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
import openAICallbackHandler from "../../utils/langchain/callbacks/llm/openAiCb.js";
import { AIOutputMessage } from "../../utils/langchain/message/ai.js";
import { SearchNestedWebContentTool } from "../../utils/langchain/tools/searchNestedWebContent.js";
import {
  batchAnswer,
  clearSchema,
  convertSchemaToPrompt,
  fixParser,
  getPaginationInfo,
  handleSchemaTypeAction,
  handleSchemaTypeNested,
  streamAIV2Response,
} from "../../utils/aiScraper.utils.js";
import { PaginateTool } from "../../utils/langchain/tools/paginate.js";

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
  apiKey: string,
  streaming: boolean = true,
) {
  try {
    let { task, userId, sessionId, scraperId } = payload;
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const { contentIdentifier, pagination } =
      await memory.getContentIdentifier();
    const { pageContent, webPage } = await memory.getPageContent();
    const countTokens = (usageMetadata: UsageMetadata) => {
      memory.addSessionUsageMetadata(usageMetadata);
    };
    const llmCallback = openAICallbackHandler(true, countTokens);
    const batchAnswers: string[] = [];
    const splitAnswer = async (
      markdown: string,
      url: string,
      question: string,
    ) =>
      await batchAnswer(
        { markdown, url, question, contentIdentifier },
        llmCallback,
        async (data: object, isFinal) => {
          console.log("Chunk Answer", data, isFinal);
          callback(data as unknown as AiScraperV2BodyResponse, isFinal);
          if (isFinal) {
            batchAnswers.push(JSON.stringify(data));
          }
        },
      );
    const tools = [
      SearchNestedWebContentTool(apiKey),
      PaginateTool(apiKey, splitAnswer),
      new SearchWebContentTool(pageContent),
    ];
    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      streaming,
      callbacks: [llmCallback],
    });
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are an AI Scraper Assistant developed by MR Scraper. Your task is to extract the data the user requests from available web content at ${webPage}. If the user asks for all data, provide every item and field, ensuring it matches the structure specified in ${contentIdentifier}. ensure you provide as much data as possible, with a minimum of 1 and a maximum of 100 items, ensuring each entry is unique and relevant to the request.

IMPORTANT: If the user requests data from paginated content, ${pagination && Array.isArray(pagination) && pagination.length > 0 ? "ensure you use the following pagination URLs: " + JSON.stringify(pagination) : "notify the user that no pagination was found"}. Otherwise, use the search-web-content-tool to gather information. 

You have access to the following tools:

${tools.map((tool) => `- ${tool.name}( ${tool.description} )`).join("\n")}

NOTE: You are currently in a beta phase, and your performance will improve over time as you continue learning to scrape data effectively.`,
      ],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"],
      [
        "system",
        `IMPORTANT!: DO NOT provide:
1. Information that is not included in the search results or chat history.
2. Repeated or duplicate JSON entries. Ensure all results are unique. 
If the data doesn't fully meet user expectations, inform them that ScrapeGPT is in beta and improvements are ongoing.

IMPORTANT!: Ensure you PROVIDE:
1. As much relevant information as possible, clearly explaining the results. If you cannot provide all available data, include a disclaimer that the data shown is a sample, and inform the user that they can request more by specifying the number of items they would like to get.
2. Unique, non-repeated entries in snake_case JSON format.
3. Relevant follow-up questions like: 'Would you like more details on this?' or 'Which specific data do you want to scrape?' If detailed pages are available, ask, 'Would you like to scrape the detail?'
4. A clear and structured response, with relevance to the user's input.

Begin! Reminder to ALWAYS respond with a valid json format {{desc: YOUR_ANSWER, json: STRING_JSON_RESULT }}. Use tools if necessary. Respond directly if appropriate.

`,
      ],
      new MessagesPlaceholder("agent_scratchpad"),
    ]);
    model.pipe(new JsonOutputFunctionsParser());

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
      onExitHistory: async (conversationId: number) => {
        if (batchAnswers.length > 0) {
          await memory.addBatchAnswer(batchAnswers, conversationId);
          // await memory.updateAiAnswer(
          //   JSON.stringify(batchAnswers),
          //   conversationId,
          // );
        }
      },
    });

    const config: RunnableConfig = {
      configurable: { sessionId: { id: sessionId, userId } },
    };

    if (streaming) {
      const streamCallback = async (
        data: AiScraperV2BodyResponse,
        isFinal: boolean,
        isFixed: boolean = false,
      ) => {
        if (isFinal && isFixed) {
          const id = (await memory.getMessagesLength()) + 1;
          await memory.updateAiAnswer(JSON.stringify(data), id);
        }
        return callback(data, isFinal);
      };
      const logStream = await withHistory.streamLog({ input: task }, config);
      await streamAIV2Response(
        logStream,
        streamCallback,
        userId,
        sessionId,
        scraperId,
        llmCallback,
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

export async function askAIAPI(req: Request, res: Response) {
  try {
    const { url, markdown, schema, min, max } =
      req.body as AiScraperApiBodyRequest;
    const apiKey = req.headers["x-api-key"] as string;
    console.log("API KEYYYYY", apiKey);
    const context = limitTokens(markdown, 125_000);
    const { cpSchema, otherSchema } = clearSchema(schema);
    const schemaPrompt = convertSchemaToPrompt(cpSchema, min, max);
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
      "!!IMPORTANT DO NOT TO GIVE: \n 1. Information that is not included in web content \n 2. If there's a lot of data, ensure no repeated JSON results. All entries must be unique. 3. Do not Halucinate \n\n !!IMPORTANT: \n PROVIDE: \n 1. Readable JSON format as given with unique entries (make sure there is no repeated data)",
    ];
    const finalResponseSchema = eval(jsonSchemaToZod(cpSchema));
    console.log(zodToJsonSchema(finalResponseSchema));
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

      result = await fixParser(parser, answer, llmCallback);
      console.log("Fixed Result", result);
    }
    const handleOtherSchema = async (
      apiKey: string,
      type: string,
      otherSchema: AIPropertiesSchema,
      prevResult: any,
    ) => {
      let otherSystemGuard: BaseMessagePromptTemplateLike;
      let otherSystemPrompt: ChatPromptTemplate;
      switch (type) {
        case "nested":
          otherSystemGuard = [
            "system",
            `IMPORTANT!! DO NOT TO GIVE: \n 1. Information that is not included in web content \n 2. If there's a lot of data, ensure no repeated JSON results. All entries must be unique. 3. Do not Halucinate \n\n !!IMPORTANT: \n PROVIDE: \n 1. Readable JSON format as given with unique entries (make sure there is no repeated data)\n\n\n `,
          ];

          otherSystemPrompt = ChatPromptTemplate.fromMessages([
            system1,
            user,
            otherSystemGuard,
            new MessagesPlaceholder("agent_scratchpad"),
          ]);

          return await handleSchemaTypeNested(
            otherSchema,
            schema,
            min,
            max,
            llmCallback,
            otherSystemPrompt,
            prevResult,
            apiKey,
          );

        case "action":
          otherSystemGuard = [
            "system",
            `IMPORTANT!! DO NOT TO GIVE: \n 1. Information that is not included in web content \n 2. If there's a lot of data, ensure no repeated JSON results. All entries must be unique. 3. Do not Halucinate \n\n !!IMPORTANT: \n PROVIDE: \n 1. Readable JSON format as given with unique entries (make sure there is no repeated data)\n\n\n `,
          ];

          otherSystemPrompt = ChatPromptTemplate.fromMessages([
            system1,
            user,
            otherSystemGuard,
            new MessagesPlaceholder("agent_scratchpad"),
          ]);

          return await handleSchemaTypeAction(
            otherSchema,
            schema,
            min,
            max,
            llmCallback,
            otherSystemPrompt,
            prevResult,
            apiKey,
          );

        default:
          break;
      }
    };
    if (otherSchema) {
      const types = Object.keys(otherSchema).map((type) => type);
      for (const type of types) {
        result = await handleOtherSchema(
          apiKey,
          type,
          otherSchema[type],
          result,
        );
      }
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

export async function identifyContent(req: Request, res: Response) {
  try {
    const {
      markdown,
      navContent,
      userId,
      url,
      screenshot,
      isError,
      httpStatus,
    } = req.body as AiIdentifierBodyRequest;
    console.log("Nav Content \n", navContent);
    const context = limitTokens(markdown, 125_000);
    let inputTokens = 0;
    let outputTokens = 0;
    let user:
      | ChatPromptTemplate<InputValues, string>
      | BaseMessagePromptTemplateLike = [
      "user",
      `URL: {url} 
Web Content:  
-----------
{input}
-----------
`,
    ];
    let system1: BaseMessagePromptTemplateLike = [
      "system",
      "You are an AI Scraper assistance build by MR Scraper, your task is to create the title for this web and tell user what data can be scraped from the web content given, please provide trully information what data can be scraped in readable format without any additional information that is no included in the web content user given. You should give an additional followup question to user at the end of exaplanation.",
    ];

    let systemGuard: BaseMessagePromptTemplateLike = [
      "system",
      `INSTRUCTIONS:
1. Provide clear, readable explanations in a well-formatted structure. 
2. At the end of the explanation, include a follow-up question to initiate further conversation. Example: 'Which data would you like to scrape next?' 
3. If applicable, explain how much data can be scraped from the current page not all pages!. 
4. If available, include a valid pagination URL. Ensure it is the full and correct URL. Do not include a pagination URL if it is not present in the web content user given.`,
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
              "explanation of what datexplanation of what data can be scraped without any additional information that is no included in the web content user given",
          },
          followup: {
            type: "string",
            description:
              "Follow-up questions to starting the conversation at the end of the explanation",
          },
          howMany: {
            type: "string",
            description:
              "Extra explanation & description how many data that can be scraped in current page",
          },
          pagination: {
            type: "array",
            description:
              "list of pagination-related url of the web content if available! Please pass empty array if not available",
            items: {
              type: "string",
              description: "pagination url",
            },
          },
        },
        required: ["title", "content"],
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

    const extractorSchemaZod = eval(
      jsonSchemaToZod(extractorSchema.parameters),
    );
    const parser = StructuredOutputParser.fromZodSchema(extractorSchemaZod);
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
    let answer = "";
    const llmOutput = (
      output: LLMResult,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ) => {
      console.log(
        "Output",
        output.generations[0][0].message?.additional_kwargs?.function_call
          ?.arguments,
      );
      answer =
        output.generations[0][0].message?.additional_kwargs?.function_call
          ?.arguments;
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
      functions: [extractorSchema],
      function_call: { name: "extractor" },
      callbacks: [llmCallback],
    });
    const llmChain = RunnableSequence.from([prompt, chatModel, parser]);
    let result;
    let content = "";
    try {
      if (!isError) {
        result = await llmChain.invoke({
          input: context,
          navContent: navContent,
          url,
          format_instructions: parser.getFormatInstructions(),
        });
        // @ts-ignore
        content = `#${result?.title}\n\n${result?.content}\n\n${result?.howMany}\n${result?.followup}`;
      } else {
        result = await llmChain.invoke({
          screenshot,
          httpStatus,
          format_instructions: parser.getFormatInstructions(),
        });
        // @ts-ignore
        content = `#${result.title}\n\n${result.problem}\n\n${result.solution}\n\n${result.howTo}\n\n${result.impact}`;
      }
    } catch (error: any) {
      console.error("Error parsing json result", error);
      console.log("Answer", answer);

      result = await fixParser(parser, answer, llmCallback);

      content = `#${result?.title}\n\n${result?.content}\n\n${result?.howMany}\n${result?.followup}`;
      console.log("Fixed Result", result);
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
      let pagination = result?.pagination;
      if (navContent) {
        pagination = await getPaginationInfo(navContent, countTokens);
      }
      const aiMessage: BaseMessage = new AIOutputMessage(
        JSON.stringify({
          data_that_can_be_scraped: content,
          pagination: pagination,
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
