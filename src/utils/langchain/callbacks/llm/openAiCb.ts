import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Serialized } from "@langchain/core/load/serializable";
import { LLMResult, UsageMetadata } from "./types/interfacte.js";

export interface OpenAICallbackHandler {
  verbose: boolean;
  start: (
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ) => void;
  end: (
    output: LLMResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ) => void;
  tokenUsage: (usageMetadata: UsageMetadata) => void;
}
const openAICallbackHandler = (
  verbose: boolean = false,
  tokenUsage = (usageMetadata: UsageMetadata) => {},
  start = (
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ) => {},
  end = (
    output: LLMResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ) => {},
) =>
  BaseCallbackHandler.fromMethods({
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
      if (verbose) {
        console.log("handleLLMStart: LLM:", { llm });
        console.log("handleLLMStart: Prompt:", { prompts });
        console.log("handleLLMStart: Metadata:", { metadata });
      }
      start(
        llm,
        prompts,
        runId,
        parentRunId,
        extraParams,
        tags,
        metadata,
        runName,
      );
    },
    handleLLMEnd(
      output: LLMResult,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ) {
      if (output) {
        if (verbose) {
          console.log("handleLLMEnd: Output:", JSON.stringify(output, null, 2));
        }
        end(output, runId, parentRunId, tags);
        const usageMetadata =
          output.generations[0][0].message?.kwargs?.usage_metadata ||
          output.generations[0][0].message?.usage_metadata;
        if (usageMetadata) {
          if (verbose) {
            console.log("handleLLMEnd: Usage Metadata:", { usageMetadata });
          }
          tokenUsage(usageMetadata);
        }
      }
    },
  });
export default openAICallbackHandler;
