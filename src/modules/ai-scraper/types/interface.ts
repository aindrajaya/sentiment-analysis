import type { StoredMessage } from "@langchain/core/messages";

export interface AiScraperBodyRequest {
  markdown: string;
  task: string;
}

export interface AiIdentifierBodyRequest {
  url: string;
  markdown: string;
  userId: string;
}

export interface AiScraperV2BodyRequest {
  task: string;
  sessionId: string;
  userId: string;
}

export interface AiScraperV2FinalAnswerBodyRequest {
  sessionId: string;
  userId: string;
}

export interface AiScraperV2GetSessionsParamsRequest {
  userId: string;
}

export interface AiScraperV2GetChatHistoryParamsRequest {
  userId: string;
  sessionId: string;
}

export interface AiScraperBodyResponse {
  task: string;
  json: string;
}

export interface AiScraperV2BodyResponse {
  desc: string;
  json: string;
}

export interface AiScraperV2FinalAnswerBodyResponse {
  finalAnswer?: string;
  inputToken?: string;
  outputToken?: string;
}

export interface AiScraperV2GetSessionsBodyResponse {
  sessionId: string;
  name: string;
}

export type AiScraperV2GetChatHistoryBodyResponse = StoredMessage[];

export interface AiIdentifierBodyResponse {
  content: string;
}

export interface Generation {
  /**
   * Generated text output
   */
  text: string;
  /**
   * Raw generation info response from the provider.
   * May include things like reason for finishing (e.g. in {@link OpenAI})
   */
  generationInfo?: Record<string, any>;
  /**
   * Message object containing additional metadata and tool calls.
   */
  message?: Message;
}

export interface Message {
  /**
   * Language code or other identifier.
   */
  lc: number;
  /**
   * Type of message or constructor type.
   */
  type: string;
  /**
   * Message identifier, typically an array with module and class names.
   */
  id: string[];
  /**
   * Additional key-value pairs related to the message.
   */
  kwargs?: {
    /**
     * Content of the message.
     */
    content: string;
    /**
     * Additional arguments, like function call information.
     */
    additional_kwargs?: Record<string, any>;
    /**
     * Response metadata, including tokens used and finish reason.
     */
    response_metadata?: Record<string, any>;
    /**
     * Tool call chunks related to the message.
     */
    tool_call_chunks?: any[];
    /**
     * Message ID.
     */
    id: string;
    /**
     * Usage metadata including token usage.
     */
    usage_metadata?: UsageMetadata;
    /**
     * List of tool calls made.
     */
    tool_calls?: any[];
    /**
     * List of invalid tool calls.
     */
    invalid_tool_calls?: any[];
  };
  usage_metadata?: UsageMetadata;
  [key: string]: any;
}

export interface UsageMetadata {
  /**
   * Number of tokens used in the input.
   */
  input_tokens: number;
  /**
   * Number of tokens generated in the output.
   */
  output_tokens: number;
  /**
   * Total number of tokens used.
   */
  total_tokens: number;
}

export declare const RUN_KEY = "__run";

export interface LLMResult {
  /**
   * List of the things generated. Each input could have multiple {@link Generation | generations}, hence this is a list of lists.
   */
  generations: Generation[][];
  /**
   * Dictionary of arbitrary LLM-provider specific output.
   */
  llmOutput?: Record<string, any>;
  /**
   * Dictionary of run metadata
   */
  [RUN_KEY]?: Record<string, any>;
}
