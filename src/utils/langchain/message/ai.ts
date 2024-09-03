import {
  BaseMessage,
  ToolCall,
  InvalidToolCall,
  AIMessageFields,
  MessageType,
} from "@langchain/core/messages";
import { UsageMetadata } from "../../../modules/ai-scraper/types/interface.js";

export function defaultToolCallParser(
  rawToolCalls: Record<string, any>[],
): [ToolCall[], InvalidToolCall[]] {
  const toolCalls = [];
  const invalidToolCalls = [];
  for (const toolCall of rawToolCalls) {
    if (!toolCall.function) {
      continue;
    } else {
      const functionName = toolCall.function.name;
      try {
        const functionArgs = JSON.parse(toolCall.function.arguments);
        const parsed = {
          name: functionName || "",
          args: functionArgs || {},
          id: toolCall.id,
        };
        toolCalls.push(parsed);
      } catch (error) {
        invalidToolCalls.push({
          name: functionName,
          args: toolCall.function.arguments,
          id: toolCall.id,
          error: "Malformed args.",
        });
      }
    }
  }
  // @ts-ignore
  return [toolCalls, invalidToolCalls];
}

export class AIOutputMessage extends BaseMessage {
  tool_calls?: ToolCall[];
  invalid_tool_calls?: InvalidToolCall[];
  /**
   * If provided, token usage information associated with the message.
   */
  usage_metadata?: UsageMetadata;
  get lc_aliases(): Record<string, string> {
    // exclude snake case conversion to pascal case
    return {
      ...super.lc_aliases,
      tool_calls: "tool_calls",
      invalid_tool_calls: "invalid_tool_calls",
    };
  }
  constructor(
    fields: string | AIMessageFields,
    /** @deprecated */
    kwargs?: Record<string, unknown>,
    usageMetadataKey: string = "usage_metadata",
  ) {
    let initParams;
    if (typeof fields === "string") {
      let content = fields;
      let usage_metadata = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };
      try {
        const fieldObject: { [key: string]: any } = JSON.parse(fields);
        if (fieldObject[`${usageMetadataKey}`]) {
          usage_metadata = fieldObject[`${usageMetadataKey}`];
          delete fieldObject[`${usageMetadataKey}`];
          content = JSON.stringify(fieldObject);
        }
      } catch (error) {
        console.error("Error while try get usage metadata", error);
        content = fields;
      }
      console.log("THE FIELDS", content);
      initParams = {
        content,
        // @ts-ignore
        tool_calls: [],
        invalid_tool_calls: [],
        additional_kwargs: kwargs ?? {},
        usage_metadata: usage_metadata,
      };
    } else {
      console.log("THE FIELDS", fields);
      initParams = fields;
      const rawToolCalls = initParams.additional_kwargs?.tool_calls;
      const toolCalls = initParams.tool_calls;
      if (
        !(rawToolCalls == null) &&
        rawToolCalls.length > 0 &&
        (toolCalls === undefined || toolCalls.length === 0)
      ) {
        console.warn(
          [
            "New LangChain packages are available that more efficiently handle",
            "tool calling.\n\nPlease upgrade your packages to versions that set",
            "message tool calls. e.g., `yarn add @langchain/anthropic`,",
            "yarn add @langchain/openai`, etc.",
          ].join(" "),
        );
      }
      try {
        if (!(rawToolCalls == null) && toolCalls === undefined) {
          const [toolCalls, invalidToolCalls] =
            defaultToolCallParser(rawToolCalls);
          // @ts-ignore
          initParams.tool_calls = toolCalls ?? [];
          initParams.invalid_tool_calls = invalidToolCalls ?? [];
        } else {
          initParams.tool_calls = initParams.tool_calls ?? [];
          initParams.invalid_tool_calls = initParams.invalid_tool_calls ?? [];
        }
      } catch (e) {
        // Do nothing if parsing fails
        initParams.tool_calls = [];
        initParams.invalid_tool_calls = [];
      }
    }
    // Sadly, TypeScript only allows super() calls at root if the class has
    // properties with initializers, so we have to check types twice.
    super(initParams);

    if (typeof initParams !== "string") {
      // @ts-ignore
      this.tool_calls = initParams.tool_calls ?? this.tool_calls;
      this.invalid_tool_calls =
        initParams.invalid_tool_calls ?? this.invalid_tool_calls;
    }
    this.usage_metadata = initParams.usage_metadata;
  }
  static lc_name() {
    return "AIMessage";
  }
  _getType(): MessageType {
    return "ai";
  }
  get _printableFields(): Record<string, unknown> {
    return {
      ...super._printableFields,
      tool_calls: this.tool_calls,
      invalid_tool_calls: this.invalid_tool_calls,
      usage_metadata: this.usage_metadata,
    };
  }
}
