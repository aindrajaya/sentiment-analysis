import {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ToolInterface } from "@langchain/core/tools";
import { OpenAIClient } from "@langchain/openai";
import { BasePromptTemplate } from "@langchain/core/prompts";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodSchema, z } from "zod";
import { type AgentFinish, type AgentStep } from "langchain/agents";
import { AgentRunnableSequence } from "./libs/agent.js";
import {
  AIMessage,
  FunctionMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { FunctionsAgentAction } from "langchain/agents/openai/output_parser";
import { convertToOpenAIFunction } from "@langchain/core/utils/function_calling";
import { RunnablePassthrough } from "@langchain/core/runnables";
import { Tool } from "langchain/tools";

export const defaultResponseSchema = z.object({
  answer: z.string().describe("The final answer to return to the user"),
});

export type CreateReActAgentParams = {
  /** Model to use for the agent. */
  model: BaseChatModel<
    BaseChatModelCallOptions & {
      tools?:
        | StructuredToolInterface[]
        | OpenAIClient.ChatCompletionTool[]
        | any[];
    }
  >;
  /** Tools this agent has access to. */
  tools: ToolInterface[];
  /**
   * The prompt to use. Must have input keys for
   * `tools`, `tool_names`, and `agent_scratchpad`.
   */
  prompt: BasePromptTemplate;
  /**
   * Whether to invoke the underlying model in streaming mode,
   * allowing streaming of intermediate steps. Defaults to true.
   */
  streamRunnable?: boolean;

  /**
   *
   */
  finalResponseSchema?: ZodSchema<any>;

  /**
   * The key to use for the output of the agent. Defaults to `destructured_output`.
   */
  outputKey?: string;
};
export async function createReActAgent({
  model,
  tools,
  prompt,
  streamRunnable,
  finalResponseSchema,
  outputKey = "destructured_output",
}: CreateReActAgentParams) {
  let responseSchema;
  if (finalResponseSchema) {
    responseSchema = finalResponseSchema;
  } else {
    responseSchema = defaultResponseSchema;
  }

  const responseOpenAIFunction = {
    name: "response",
    description: "Return the response to the user",
    parameters: zodToJsonSchema(responseSchema),
  };

  const structuredOutputParser = (
    message: AIMessage,
  ): FunctionsAgentAction | AgentFinish => {
    if (message.content && typeof message.content !== "string") {
      throw new Error("This agent cannot parse non-string model responses.");
    }
    if (message.additional_kwargs.function_call) {
      const { function_call } = message.additional_kwargs;
      try {
        let toolInput = {};
        try {
          toolInput = function_call.arguments
            ? JSON.parse(function_call.arguments)
            : {};
        } catch (error) {
          const args = function_call.arguments ?? {};
          toolInput = "";
          Object.keys(args).forEach((key: any) => {
            if (typeof args[key] === "string") {
              toolInput += args[key];
            }
          });
          console.error("Error parsing function call arguments", error);
        }
        // If the function call name is `response` then we know it's used our final
        // response function and can return an instance of `AgentFinish`
        if (function_call.name === "response") {
          if (typeof toolInput === "string") {
            return {
              returnValues: { output: { desc: toolInput } },
              log: toolInput,
            };
          }
          let output = {};
          if (outputKey === "destructured_output") {
            output = { ...toolInput };
          } else {
            output = { [outputKey]: toolInput };
          }
          return {
            returnValues: {
              output: { ...output, usage_metadata: message.usage_metadata },
            },
            log: message.content,
          };
        }
        return {
          tool: function_call.name,
          toolInput,
          log: `Invoking "${function_call.name}" with ${
            function_call.arguments ?? "{}"
          }\n${message.content}`,
          messageLog: [message],
        };
      } catch (error) {
        console.error("Error parsing function call", error);
        return {
          returnValues: { output: message.content },
          log: message.content,
        };
      }
    } else {
      return {
        returnValues: { output: message.content },
        log: message.content,
      };
    }
  };

  const formatAgentSteps = (steps: AgentStep[]): BaseMessage[] =>
    steps.flatMap(({ action, observation }) => {
      if ("messageLog" in action && action.messageLog !== undefined) {
        const log = action.messageLog as BaseMessage[];
        return log.concat(new FunctionMessage(observation, action.tool));
      } else {
        return [new AIMessage(action.log)];
      }
    });

  const openAiFunctions = tools.map((tool) => {
    const openAIFunction = convertToOpenAIFunction(tool);
    console.log(openAIFunction);
    return openAIFunction;
  });

  const llmWithTools = model.bind({
    // @ts-ignore
    functions: openAiFunctions.concat([responseOpenAIFunction]),
  });
  /** Create the runnable */
  const agent = AgentRunnableSequence.fromRunnables(
    [
      RunnablePassthrough.assign({
        agent_scratchpad: (i: {
          input: string;
          tools: Tool[];
          steps: AgentStep[];
        }) => formatAgentSteps(i.steps),
      }),
      prompt,
      llmWithTools,
      structuredOutputParser,
    ],
    {
      name: "ReactAgent",
      streamRunnable,
      singleAction: true,
    },
  );

  return agent;
}
