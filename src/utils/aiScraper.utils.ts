import { StructuredOutputParser } from "langchain/output_parsers";
import {
  AIItemsSchema,
  AIOutputSchema,
  AIPropertiesSchema,
  AiScraperV2BodyResponse,
} from "../modules/ai-scraper/types/interface.js";
import { ChatOpenAI } from "@langchain/openai";
import {
  PromptTemplate,
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import openAICallbackHandler, {
  OpenAICallbackHandlerReturn,
} from "./langchain/callbacks/llm/openAiCb.js";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { SearchNestedWebContentTool } from "./langchain/tools/searchNestedWebContent.js";
import { z } from "zod";
import { createReActAgent } from "./langchain/agent/createReActAgent.js";
import { AgentExecutor } from "langchain/agents";
import { RunLogPatch } from "@langchain/core/tracers/log_stream";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";
import axios from "axios";
import { MongoDBChatMessageHistory } from "./memory/chatHistory.js";
import {
  platformApiUrl,
  platformWebhookSecret,
} from "../configs/general.config.js";
import { OutputFixingParser } from "./langchain/parser/outputFixingParser.js";
import type { BaseMessagePromptTemplateLike } from "@langchain/core/prompts";
import type { InputValues } from "@langchain/core/utils/types";
import { FunctionDefinition } from "@langchain/core/language_models/base";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";
import { limitTokens } from "./helper.util.js";
import {
  LLMResult,
  UsageMetadata,
} from "./langchain/callbacks/llm/types/interfacte.js";
import { RunnableSequence } from "@langchain/core/runnables";
import { GetActionableWebContentTool } from "./langchain/tools/getWebContent.js";

export async function getPaginationInfo(
  markdown: string,
  tokenUsageCb: (usageMetadata: UsageMetadata) => void,
) {
  try {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        "You are an AI assistant designed by MrScraper and have a task to extract all pagination URLs from markdown content and output them as JSON. Your task is to parse the markdown, find every pagination URL, and return them in a structured JSON format",
      ],
      ["user", "Markdown content:\n-----------\n{input}\n-----------\n"],
      new MessagesPlaceholder("format_instructions"),
      [
        "system",
        `IMPORTANT!: DO NOT provide:
1. Information that is not included in the search results or chat history.
2. Repeated or duplicate JSON entries. Ensure all results are unique. 

IMPORTANT!: Ensure you PROVIDE:
1. Only give the data if it available, include a valid pagination URL. Ensure it is the full and correct URL. Do not include a pagination URL if it is not present in the markdown content user given.
`,
      ],
    ]);
    let extractorSchema: FunctionDefinition = {
      name: "extractor",
      description: "Extracts fields from the input.",
      parameters: {
        type: "object",
        properties: {
          pagination: {
            type: "array",
            description:
              "list of pagination-related url of the web content if available! Please pass empty array if not available",
            items: {
              type: "object",
              description: "pagination information",
              properties: {
                text: {
                  type: "string",
                  description: "text associated with the pagination url",
                },
                url: {
                  type: "string",
                  description: "the url of the pagination",
                },
              },
            },
          },
        },
        required: ["title", "content"],
      },
    };

    const extractorSchemaZod = eval(
      jsonSchemaToZod(extractorSchema.parameters),
    );
    const parser = StructuredOutputParser.fromZodSchema(extractorSchemaZod);

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
      tokenUsageCb,
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
      result = await llmChain.invoke({
        input: markdown,
        format_instructions: parser.getFormatInstructions(),
      });
      // @ts-ignore
      content = `#${result?.title}\n\n${result?.content}\n\n${result?.howMany}\n${result?.followup}`;
    } catch (error: any) {
      console.error("Error parsing json result", error);
      console.log("Answer", answer);

      result = await fixParser(parser, answer, llmCallback);

      content = `#${result?.title}\n\n${result?.content}\n\n${result?.howMany}\n${result?.followup}`;
      console.log("Fixed Result", result);
    }
    console.log("\nAnswer:\n", result);
    const output = result;
    if (output) {
      return output;
    }
  } catch (error: any) {
    console.error("Error while extracting pagination urls", error);
    return undefined;
  }
}

export async function batchAnswer(
  fields: {
    markdown: string;
    url: string;
    question: string;
    contentIdentifier: string;
  },
  llmCallback: OpenAICallbackHandlerReturn,
  responseCallback: (data: object, isFinal: boolean) => void,
) {
  const { markdown, url, question, contentIdentifier } = fields;
  try {
    const context = limitTokens(markdown, 125_000);
    let user:
      | ChatPromptTemplate<InputValues, string>
      | BaseMessagePromptTemplateLike = [
      "user",
      `I need: {q} \nFrom this web content as many as possible: \n-----------\n{input}\n-----------\n`,
    ];
    let system1: BaseMessagePromptTemplateLike = [
      "system",
      `You are an AI Scraper Assistant developed by MR Scraper. Your task is to extract the data the user requests from available web content at ${url}. If the user asks for all data, provide every item and field, ensuring it matches the structure specified in ${contentIdentifier}. ensure you provide as much data as possible, with a minimum of 1 and a maximum of 100 items, ensuring each entry is unique and relevant to the request.`,
    ];
    let systemGuard: BaseMessagePromptTemplateLike = [
      "system",
      `!!IMPORTANT: DO NOT provide:
1. Information that is not included in the web content 
2. Repeated or duplicate JSON entries. Ensure all results are unique. 


!!IMPORTANT: Ensure you PROVIDE:
1. All information as many as possible 
2. Readable JSON format with unique entries (make sure there is no repeated data) and snake_case key format
3. Make sure you give the data as many as posible MINIMUM: 1, MAXIMUM: 100 
`,
    ];
    let extractorSchema: FunctionDefinition = {
      name: "response",
      description: "Batch Response",
      parameters: {
        type: "object",
        properties: {
          metadata: {
            type: "object",
            description:
              "metadata of the extracted data, it can be the url, title, page number, etc.",
            properties: {
              url: {
                type: "string",
                description: "the url of the page",
              },
              title: {
                type: "string",
                description: "the title of the page",
              },
              page_number: {
                type: "number",
                description: "the page number of the page",
              },
            },
          },
          json: {
            type: "string",
            description:
              "the json format of scraped data, !IMPORTANT should in json markdown format like ```json RESULT_HERE ```, make sure the json is in pretty with multiple line and readable.",
          },
        },
      },
    };

    const prompt = ChatPromptTemplate.fromMessages([
      system1,
      user,
      systemGuard,
    ]);

    const parser = new JsonOutputFunctionsParser();
    const chatModel = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
    }).bind({
      callbacks: [llmCallback],
      functions: [extractorSchema],
      function_call: { name: "response" },
    });
    const llmChain = prompt.pipe(chatModel).pipe(parser);
    let result;
    result = await llmChain.stream({
      q: question,
      input: context,
    });
    let finalAnswer;
    for await (const chunk of result) {
      responseCallback(chunk, false);
      finalAnswer = chunk;
    }
    responseCallback(finalAnswer!, true);
  } catch (e) {
    console.error(e);
  }
}

export async function streamAIV2Response(
  logStream: AsyncGenerator<RunLogPatch>,
  callback: (
    data: AiScraperV2BodyResponse,
    isFinal: boolean,
    isFixed?: boolean,
  ) => void,
  userId: string,
  sessionId: string,
  scraperId: string,
  llmCallback?: OpenAICallbackHandlerReturn,
) {
  let finalState;
  let currentDesc = "";
  let currentJson = "";
  let currentStream = "";
  let isDescDone = false;
  for await (const chunk of logStream) {
    if (!finalState) {
      finalState = chunk;
    } else {
      finalState = finalState.concat(chunk);
    }
    // console.log("Agent Chunk:", JSON.stringify(chunk, null, 2));
    if (
      chunk.ops.length > 1 &&
      chunk.ops[1].op == "add" &&
      (chunk.ops[1].path == "/logs/ChatOpenAI:2/streamed_output/-" ||
        chunk.ops[1].path == "/logs/ChatOpenAI/streamed_output/-")
    ) {
      const addOp = chunk.ops[1];
      if (addOp.value instanceof ChatGenerationChunk) {
        let content: string | undefined;
        if (addOp.value.text != "") {
          content = addOp.value.text;
        } else if (addOp.value.message instanceof AIMessageChunk) {
          content =
            addOp.value.message.additional_kwargs.function_call?.arguments;
        }

        const data: AiScraperV2BodyResponse = {
          desc: "",
          json: "",
        };
        if (typeof content == "string") {
          if (content.includes("desc") && !isDescDone) {
            currentStream = "desc";
            isDescDone = true;
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
              // console.log("current json", currentJson);
              if (currentJson.includes(`json":"`)) {
                const jsonContentMatch = currentJson.match(/json":"(.*)"/);
                if (!jsonContentMatch) {
                  const startIndex = currentJson.indexOf(`json":"`);
                  data.json =
                    "```json \n" +
                    currentJson.substring(startIndex + 8) +
                    "```";
                } else {
                  data.json =
                    "```json" +
                    jsonContentMatch[1]
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, "\\") +
                    "```";
                }
              }
            }
          }
          callback(data, false);
        }
      }
    } else if (
      chunk.ops.length > 0 &&
      chunk.ops[0].op == "replace" &&
      chunk.ops[0].path == "/final_output"
    ) {
      const replaceOp = chunk.ops[0];
      const content = replaceOp.value?.output;
      let isFixed = false;

      if (content) {
        console.log("content", content);
        let result = { desc: "", json: "" };
        try {
          let { desc, json } =
            typeof content == "string" ? JSON.parse(content) : content;
          result.desc = desc;
          json = json.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          const jsonContentMatch = json.match(/```json([\s\S]*?)```/);
          if (!jsonContentMatch) {
            json = "```json" + json + "```";
          }
          result.json = json;
        } catch (error) {
          if (typeof content == "string") {
            if (content.includes("```json")) {
              const parser =
                StructuredOutputParser.fromZodSchema(conversationSchema);
              result = await fixParser(parser, content as string, llmCallback!);
              isFixed = true;
            } else {
              result.desc = content;
            }
          }
        }
        await callMrScraperTokenWebhook(userId, sessionId, scraperId);
        callback(result, true, isFixed);
      }
    }
  }
}

export async function callMrScraperTokenWebhook(
  userId: string,
  sessionId: string,
  scraperId: string,
) {
  try {
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const finalAnswer = await memory.saveFinalAnswer();
    await axios.post(`${platformApiUrl}/scrape-gpt/token`, {
      scraper_id: +scraperId,
      input_token: finalAnswer.inputToken,
      output_token: finalAnswer.outputToken,
      secret: platformWebhookSecret,
    });
  } catch (error) {
    console.error("Error", error);
  }
}

export const conversationSchema = z.object({
  desc: z.string().describe("The explanation of scraped data"),
  json: z
    .string()
    .describe(
      "the json format of scraped data, !IMPORTANT should in json markdown format like ```json RESULT_HERE ```, make sure the json is in pretty with multiple line and readable.",
    ),
});

export const convertPropertiesToCommaseparated = (
  properties: AIPropertiesSchema,
  min?: number,
  max?: number,
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

export const convertItemsToCommaseparated = (
  items: AIItemsSchema,
  min?: number,
  max?: number,
) => {
  let prompt = "";
  const type = `List ${items!.type == "object" ? "object" : ""}  (${
    items!.description
  }). Please provide the data with unique entries \n${min !== undefined ? "MINIMUM data: " + min : ""} \n${max !== undefined ? "MAXIMUM data: " + max : ""} \n`;
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

export const convertSchemaToPrompt = (
  schema: AIOutputSchema,
  min?: number,
  max?: number,
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

export const detectOtherSchema = (
  props: AIPropertiesSchema,
  originalProps: AIPropertiesSchema,
): { [key: string]: AIPropertiesSchema } | undefined => {
  let otherSchema: { [key: string]: AIPropertiesSchema } | undefined =
    undefined;
  const keys = Object.keys(props).map((key) => key);
  for (const key of keys) {
    console.log("Key", key);
    if (props[key].type === "nested") {
      if (!otherSchema?.nested) {
        otherSchema = {
          nested: {},
        };
      }
      otherSchema.nested[key] = props[key];
      console.log("ada nested nih", otherSchema.nested[key]);
      // @ts-ignore
      originalProps![key] = props[key].schema!;
      console.log(originalProps[key]);
      delete props[key];
      props[`${key}_url`] = {
        type: "string",
        description: `URL for nested ${key}`,
      };
    } else if (props[key].type === "action") {
      if (!otherSchema?.action) {
        otherSchema = {
          action: {},
        };
      }
      otherSchema.action[key] = props[key];
      console.log("ada browser action nih", otherSchema.action);
      // @ts-ignore
      originalProps![key] = props[key].schema!;
      console.log(originalProps[key]);
      props[`${key}_javascript_href`] = {
        type: "string",
        description: `Selector to ${props[key].action!}able content for the ${key}, currently it must be a javascript href/link of ${key}`,
      };
      delete props[key];
    } else if (props![key].type === "object") {
      return detectOtherSchema(
        props[key].properties!,
        originalProps[key].properties!,
      );
    } else if (props![key].type === "array") {
      if (props![key].items!.type === "object") {
        return detectOtherSchema(
          props![key].items!.properties!,
          originalProps[key].items?.properties!,
        );
      }
    }
  }
  return otherSchema;
};

export const clearSchema = (schema: AIOutputSchema) => {
  const cpSchema = structuredClone(schema);
  if (cpSchema.type === "object") {
    const otherSchema = detectOtherSchema(
      cpSchema.properties!,
      schema.properties!,
    );
    return { cpSchema, otherSchema };
  } else if (cpSchema.type === "array" && cpSchema.items!.type == "object") {
    const otherSchema = detectOtherSchema(
      cpSchema.items!.properties!,
      schema.items!.properties!,
    );
    return { cpSchema, otherSchema };
  }
  return { cpSchema, otherSchema: undefined };
};

export const fixParser = async (
  parser: StructuredOutputParser<any>,
  badOutput: string,
  llmCallback: OpenAICallbackHandlerReturn,
  maxRetry: number = 3,
) => {
  let retryCount = 0;
  let isError = true;
  while (isError) {
    try {
      const fixParser = OutputFixingParser.fromLLM(
        new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" }),
        parser,
        {
          prompt: PromptTemplate.fromTemplate(
            "Instructions:\n--------------\n{instructions}\n !IMPORTANT Do not return the answer wrapped in ```json FIXED_ANSWER ```, just return the answer directly!\n--------------\nCompletion:\n--------------\n{completion}\n--------------\n\nAbove, the Completion did not satisfy the constraints given in the Instructions.\nError:\n--------------\n{error}\n--------------\n\nPlease try again. \n\n !IMPORTANT\n 1. Do not give data that not included in the completion (you can give an empty value with the same type laid out in the instructions) \n 2. Do Not Halucinate! \n 3. Only respond with an answer that satisfies the constraints laid out in the Instructions:",
          ),
        },
      ).bind({
        callbacks: [llmCallback],
      });
      const fixed = await fixParser.invoke(badOutput);

      isError = false;
      return fixed;
    } catch (error: any) {
      console.error("Fixed Error: ", error);
      badOutput = error.message;
      if (retryCount >= maxRetry) {
        throw new Error("Failed to fix parser");
      }
      retryCount++;
    }
  }
};

export const handleSchemaTypeNested = async (
  nestedSchema: AIPropertiesSchema,
  schema: AIOutputSchema,
  min: number,
  max: number,
  llmCallback: OpenAICallbackHandlerReturn,
  prompt: PromptTemplate | ChatPromptTemplate,
  parentResult: any,
  apiKey: string,
) => {
  const test = z.object({ data: z.any() });
  console.log(nestedSchema);
  const originalSchema = eval(jsonSchemaToZod(schema));
  const originalParser = StructuredOutputParser.fromZodSchema(originalSchema);
  const keys = Object.keys(nestedSchema).map((key) => (key += "_url"));
  console.log("Keys", keys);
  let nestedResult = [];
  for (const key of keys) {
    const originalKey = key.split("_url")[0];
    const items: AIItemsSchema = {
      type: nestedSchema[originalKey].schema!.type,
      description: nestedSchema[originalKey].schema!.description,
    };
    if (nestedSchema[originalKey].schema!.properties) {
      items.properties = {
        key: {
          type: "string",
          description: `can be a name/id/index for the relation to the web content`,
        },
        ...nestedSchema[originalKey].schema!.properties,
      };
    } else if (nestedSchema[originalKey].schema!.items) {
      items.items = {
        type: "object",
        description: `List of ${originalKey}`,
        // @ts-ignore
        properties: {
          key: {
            type: "string",
            description: `can be a name/id/index for the relation to the web content`,
          },
          [`${originalKey}`]: nestedSchema[originalKey].schema!.items,
        },
      };
    }

    const currentSchema: AIOutputSchema = {
      type: "object",
      description: `Final response for ${originalKey}`,
      properties: {
        data: {
          type: "array",
          description: `List of ${originalKey}`,
          items,
        },
      },
    };
    // const currentSchema = nestedSchema[originalKey].schema!;
    const schemaPrompt = convertSchemaToPrompt(currentSchema);

    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      callbacks: [llmCallback],
    });
    console.log(currentSchema);
    const finalResponseSchema = eval(jsonSchemaToZod(currentSchema));
    model.pipe(new JsonOutputParser());
    const tools = [SearchNestedWebContentTool(apiKey)];
    const agent = await createReActAgent({
      model,
      tools,
      prompt: prompt,
      finalResponseSchema,
      streamRunnable: false,
      outputKey: "data",
    });
    const runnable = new AgentExecutor({
      agent,
      tools,
      verbose: true,
    });

    nestedResult.push(
      runnable.invoke({
        input: `${JSON.stringify(parentResult)}`,
        user_want: `${originalKey}(${schemaPrompt}) for each data from nested web content in each ${key}, then combine it with the web content given`,
      }),
    );
  }
  nestedResult = await Promise.all(nestedResult);
  let index = 0;
  for (const nested of nestedResult) {
    const key = keys[index].split("_url")[0];
    let finalResult = nested.output?.data;

    parentResult = await fixParser(
      originalParser,
      `${JSON.stringify(parentResult)}\n\n ${key}: ${JSON.stringify(finalResult.data ?? finalResult)}`,
      llmCallback,
    );
    index++;
  }

  return parentResult;
};

export const handleSchemaTypeAction = async (
  actionSchema: AIPropertiesSchema,
  schema: AIOutputSchema,
  min: number,
  max: number,
  llmCallback: OpenAICallbackHandlerReturn,
  prompt: PromptTemplate | ChatPromptTemplate,
  parentResult: any,
  apiKey: string,
) => {
  const test = z.object({ data: z.any() });
  console.log(actionSchema);
  const originalSchema = eval(jsonSchemaToZod(schema));
  const originalParser = StructuredOutputParser.fromZodSchema(originalSchema);
  const keys = Object.keys(actionSchema).map(
    (key) => (key += "_javascript_href"),
  );
  console.log("Keys", keys);
  let actionResult = [];
  for (const key of keys) {
    const originalKey = key.split("_javascript_href")[0];
    const items: AIItemsSchema = {
      type: actionSchema[originalKey].schema!.type,
      description: actionSchema[originalKey].schema!.description,
    };
    if (actionSchema[originalKey].schema!.properties) {
      items.properties = {
        key: {
          type: "string",
          description: `can be a name/id/index for the relation to the web content`,
        },
        ...actionSchema[originalKey].schema!.properties,
      };
    } else if (actionSchema[originalKey].schema!.items) {
      items.items = {
        type: "object",
        description: `List of ${originalKey}`,
        // @ts-ignore
        properties: {
          key: {
            type: "string",
            description: `can be a name/id/index for the relation to the web content`,
          },
          [`${originalKey}`]: actionSchema[originalKey].schema!.items,
        },
      };
    }

    const currentSchema: AIOutputSchema = {
      type: "object",
      description: `Final response for ${originalKey}`,
      properties: {
        data: {
          type: "array",
          description: `List of ${originalKey}`,
          items,
        },
      },
    };
    // const currentSchema = nestedSchema[originalKey].schema!;
    const schemaPrompt = convertSchemaToPrompt(currentSchema);

    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      callbacks: [llmCallback],
    });
    console.log(currentSchema);
    const finalResponseSchema = eval(jsonSchemaToZod(currentSchema));
    model.pipe(new JsonOutputParser());
    const tools = [
      GetActionableWebContentTool(apiKey, actionSchema[originalKey].action!),
    ];
    const agent = await createReActAgent({
      model,
      tools,
      prompt: prompt,
      finalResponseSchema,
      streamRunnable: false,
      outputKey: "data",
    });
    const runnable = new AgentExecutor({
      agent,
      tools,
      verbose: true,
    });

    actionResult.push(
      runnable.invoke({
        input: `${JSON.stringify(parentResult)}`,
        user_want: `${originalKey}(${schemaPrompt}) for each data from nested web content in each ${key}, then combine it with the web content given`,
      }),
    );
  }
  actionResult = await Promise.all(actionResult);
  let index = 0;
  for (const action of actionResult) {
    const key = keys[index].split("_javascript_href")[0];
    let finalResult = action.output?.data;

    parentResult = await fixParser(
      originalParser,
      `${JSON.stringify(parentResult)}\n\n ${key}: ${JSON.stringify(finalResult.data ?? finalResult)}`,
      llmCallback,
    );
    index++;
  }

  return parentResult;
};
