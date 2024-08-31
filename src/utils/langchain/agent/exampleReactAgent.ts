import { RunnablePassthrough } from "@langchain/core/runnables";
import { renderTextDescription } from "langchain/tools/render";
import { formatToOpenAIFunctionMessages } from "langchain/agents/format_scratchpad";
import { ReActSingleInputOutputParser } from "langchain/agents/react/output_parser";
import {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { AgentRunnableSequence, AgentStep } from "langchain/agents";
import type { ToolInterface } from "@langchain/core/tools";
import { OpenAIClient } from "@langchain/openai";
import { Tool } from "langchain/tools";
import { convertToOpenAIFunction } from "@langchain/core/utils/function_calling";
import { BasePromptTemplate } from "@langchain/core/prompts";
import { formatLogToString } from "langchain/agents/format_scratchpad/log";

export type CreateReactAgentParams = {
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
};

/**
 * Create an agent that uses ReAct prompting.
 * @param params Params required to create the agent. Includes a Model, tools, and prompt.
 * @returns A runnable sequence representing an agent. It takes as input all the same input
 *     variables as the prompt passed in does. It returns as output either an
 *     AgentAction or AgentFinish.
 *
 * @example
 * ```typescript
 * import { AgentExecutor, createReactAgent } from "langchain/agents";
 * import { pull } from "langchain/hub";
 * import type { PromptTemplate } from "@langchain/core/prompts";
 *
 * import { OpenAI } from "@langchain/openai";
 *
 * // Define the tools the agent will have access to.
 * const tools = [...];
 *
 * // Get the prompt to use - you can modify this!
 * // If you want to see the prompt in full, you can at:
 * // https://smith.langchain.com/hub/hwchase17/react
 * const prompt = await pull<PromptTemplate>("hwchase17/react");
 *
 * const llm = new OpenAI({
 *   temperature: 0,
 * });
 *
 * const agent = await createReactAgent({
 *   llm,
 *   tools,
 *   prompt,
 * });
 *
 * const agentExecutor = new AgentExecutor({
 *   agent,
 *   tools,
 * });
 *
 * const result = await agentExecutor.invoke({
 *   input: "what is LangChain?",
 * });
 * ```
 */

export async function exampleReactAgent({
  model,
  tools,
  prompt,
  streamRunnable,
}: CreateReactAgentParams) {
  const missingVariables = ["tools", "tool_names", "agent_scratchpad"].filter(
    (v) => !prompt.inputVariables.includes(v),
  );
  if (missingVariables.length > 0) {
    throw new Error(
      `Provided prompt is missing required input variables: ${JSON.stringify(missingVariables)}`,
    );
  }
  const toolNames = tools.map((tool) => tool.name);
  const partialedPrompt = await prompt.partial({
    tools: renderTextDescription(tools),
    tool_names: toolNames.join(", "),
  });
  // TODO: Add .bind to core runnable interface.
  const modelWithStop = model.bind({
    stop: ["\nObservation:"],
  });
  const agent = AgentRunnableSequence.fromRunnables(
    [
      RunnablePassthrough.assign({
        agent_scratchpad: (input: {
          input: string;
          tools: Tool[];
          steps: AgentStep[];
        }) => formatLogToString(input.steps),
      }),
      partialedPrompt,
      modelWithStop,
      new ReActSingleInputOutputParser({
        toolNames,
      }),
    ],
    {
      name: "ReactAgent",
      streamRunnable,
      singleAction: true,
    },
  );
  return agent;
}
