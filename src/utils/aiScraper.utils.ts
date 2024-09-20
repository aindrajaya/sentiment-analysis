import {
  OutputFixingParser,
  StructuredOutputParser,
} from "langchain/output_parsers";
import {
  AIItemsSchema,
  AIOutputSchema,
  AIPropertiesSchema,
} from "../modules/ai-scraper/types/interface.js";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate, ChatPromptTemplate } from "@langchain/core/prompts";
import { OpenAICallbackHandlerReturn } from "./langchain/callbacks/llm/openAiCb.js";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { SearchNestedWebContentTool } from "./langchain/tools/SearchNestedWebContent.js";
import { createReActAgent } from "./langchain/agent/createReActAgent.js";
import { AgentExecutor } from "langchain/agents";

export const convertPropertiesToCommaseparated = (
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

export const convertItemsToCommaseparated = (
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

export const convertSchemaToPrompt = (
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

export const isNested = (
  props: AIPropertiesSchema,
  originalProps: AIPropertiesSchema,
): AIPropertiesSchema | undefined => {
  let nestedSchema: AIPropertiesSchema | undefined = undefined;
  const keys = Object.keys(props).map((key) => key);
  for (const key of keys) {
    console.log("Key", key);
    if (props[key].type === "nested") {
      if (!nestedSchema) {
        nestedSchema = {};
      }
      nestedSchema[key] = props[key];
      console.log("ada nested nih", nestedSchema);
      // @ts-ignore
      originalProps![key] = props[key].schema!;
      console.log(originalProps[key]);
      delete props[key];
      props[`${key}_url`] = {
        type: "string",
        description: `URL for nested ${key}`,
      };
    } else if (props![key].type === "object") {
      return isNested(props[key].properties!, originalProps[key].properties!);
    } else if (props![key].type === "array") {
      if (props![key].items!.type === "object") {
        return isNested(
          props![key].items!.properties!,
          originalProps[key].items?.properties!,
        );
      }
    }
  }
  return nestedSchema;
};

export const clearSchema = (schema: AIOutputSchema) => {
  const cpSchema = structuredClone(schema);
  if (cpSchema.type === "object") {
    console.log("masuk");
    const nestedSchema = isNested(cpSchema.properties!, schema.properties!);
    console.log("Nested Schema clear schema layer", nestedSchema);
    return { cpSchema, nestedSchema };
  }
  return { cpSchema, nestedSchema: undefined };
};

export const fixParser = async (
  parser: StructuredOutputParser<any>,
  badOutput: string,
  llmCallback: OpenAICallbackHandlerReturn,
) => {
  const fixParser = OutputFixingParser.fromLLM(
    new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" }),
    parser,
    {
      prompt: PromptTemplate.fromTemplate(
        "Instructions:\n--------------\n{instructions}\n--------------\nCompletion:\n--------------\n{completion}\n--------------\n\nAbove, the Completion did not satisfy the constraints given in the Instructions.\nError:\n--------------\n{error}\n--------------\n\nPlease try again. \n\n !IMPORTANT\n 1. Do not give data that not included in the completion (you can give an empty value with the same type laid out in the instructions) \n 2. Do Not Halucinate! \n 3. Only respond with an answer that satisfies the constraints laid out in the Instructions:",
      ),
    },
  ).bind({
    callbacks: [llmCallback],
  });
  const fixed = await fixParser.invoke(badOutput);

  return fixed;
};

export const handleSchemaTypeNested = async (
  nestedSchema: AIPropertiesSchema,
  schema: AIOutputSchema,
  min: number,
  max: number,
  llmCallback: OpenAICallbackHandlerReturn,
  prompt: PromptTemplate | ChatPromptTemplate,
  parentResult: any,
) => {
  const originalSchema = eval(jsonSchemaToZod(schema));
  const originalParser = StructuredOutputParser.fromZodSchema(originalSchema);
  const keys = Object.keys(nestedSchema).map((key) => (key += "_url"));
  let nestedResult = [];
  for (const key of keys) {
    const originalKey = key.split("_url")[0];
    const schemaPrompt = convertSchemaToPrompt(
      nestedSchema[originalKey].schema!,
      min,
      max,
    );

    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      callbacks: [llmCallback],
    });
    const finalResponseSchema = eval(
      jsonSchemaToZod(nestedSchema[key].schema!),
    );
    model.pipe(new JsonOutputParser());
    const tools = [SearchNestedWebContentTool];
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
        input: JSON.stringify(parentResult[key]),
        user_want: `${originalKey} for each data from nested web content in each ${key} then ${schemaPrompt}`,
      }),
    );
  }
  nestedResult = await Promise.all(nestedResult);
  let index = 0;
  for (const nested of nestedResult) {
    const key = keys[index].split("_url")[0];
    let finalResult = nested.output?.data;

    if (typeof finalResult === "object") {
      finalResult = finalResult[Object.keys(finalResult)[0]];
    }
    parentResult = await fixParser(
      originalParser,
      `${JSON.stringify(parentResult)}\n\n ${key}: ${JSON.stringify(finalResult)}`,
      llmCallback,
    );
    index++;
  }

  return parentResult;
};
