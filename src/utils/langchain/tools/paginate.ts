import { DynamicStructuredTool, Tool, ToolParams } from "langchain/tools";
import { z } from "zod";
import { countTokens, limitTokens } from "../../helper.util.js";
import {
  customFormatMarkdownDocAsString,
  markdownSplitter,
} from "../../etl/markdown.js";
import { Document as ChainDoc } from "@langchain/core/documents";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { CohereRerank } from "@langchain/cohere";
import extractMarkdown from "../../etl/mrscraper.js";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import type { BaseMessagePromptTemplateLike } from "@langchain/core/prompts";
import type { InputValues } from "@langchain/core/utils/types";
import { FunctionDefinition } from "@langchain/core/language_models/base";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { StructuredOutputParser } from "langchain/output_parsers";
import { LLMResult, UsageMetadata } from "../callbacks/llm/types/interfacte.js";
import openAICallbackHandler from "../callbacks/llm/openAiCb.js";
import { RunnableSequence } from "@langchain/core/runnables";
import { fixParser } from "../../aiScraper.utils.js";

export async function shortenMarkdown(markdown: string, question: string) {
  try {
    const context = limitTokens(markdown, 125_000);
    let inputTokens = 0;
    let outputTokens = 0;
    let user:
      | ChatPromptTemplate<InputValues, string>
      | BaseMessagePromptTemplateLike = [
      "user",
      `Question: {q} \nMarkdown Content:  \n-----------\n{input}\n-----------\n`,
    ];
    let system1: BaseMessagePromptTemplateLike = [
      "system",
      "You are an AI Scraper assistant created by MR Scraper, your job is to get relevant markdowns to user questions.",
    ];
    let systemGuard: BaseMessagePromptTemplateLike = [
      "system",
      "!!IMPORTANT: \n PROVIDE: \n 1. Get relevant markdown content for the user's question! Make sure it is part of the original markdown and not something else or without additional markdown that is not included in the original markdown content.",
    ];
    let extractorSchema: FunctionDefinition = {
      name: "extractor",
      description: "Extracts fields from the input.",
      parameters: {
        type: "object",
        properties: {
          relatedMarkdown: {
            type: "string",
            description: "related markdown content",
          },
        },
      },
    };

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
      callbacks: [llmCallback],
    });
    const llmChain = prompt.pipe(chatModel);
    let result;
    try {
      result = await llmChain.invoke({
        q: question,
        input: context,
      });
      console.log("Result ", result);
      // @ts-ignore
    } catch (error: any) {
      console.error("Error parsing json result", error);
      console.log("Answer", answer);

      result = await fixParser(parser, answer, llmCallback);

      console.log("Fixed Result", result);
    }
    console.log("\nAnswer:\n", result.content);
    const output = result.content;
    console.log(`\n=======\nInput token usage: ${inputTokens}\n=======\n`);
    console.log(`\n=======\nOutput tokens usage: ${outputTokens}\n=======\n`);
    if (output) {
      return output;
    }
  } catch (error: any) {
    console.error("Error", error);
    return markdown;
  }
}

export const PaginateTool = (apiKey: string) =>
  new DynamicStructuredTool({
    name: "paginate-tool",
    description:
      "Tool used when you need to get web content from multiple pages",
    schema: z.object({
      urls: z.array(z.string()),
      question: z.string(),
    }),
    func: async ({ urls, question }) => {
      console.log("urls", urls);
      console.log("question", question);
      let markdown: Promise<string[]> | any = [];
      for (const url of urls) {
        markdown.push(extractMarkdown(url, apiKey));
      }

      markdown = await Promise.all(markdown);

      console.log(
        `=======================\n Markdown All: \n ${JSON.stringify(
          markdown,
        )} \n=======================`,
      );

      const tokenLength = countTokens(JSON.stringify(markdown));
      if (tokenLength > 125_000) {
        let splittedMarkdown = [];
        for (const md of markdown) {
          splittedMarkdown.push(await shortenMarkdown(md, question));
        }

        splittedMarkdown = await Promise.all(splittedMarkdown);

        return JSON.stringify(splittedMarkdown);
      }

      return JSON.stringify(markdown);
    },
  });
