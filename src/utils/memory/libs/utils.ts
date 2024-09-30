import type { StoredMessage, BaseMessage } from "@langchain/core/messages";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  FunctionMessage,
  ToolMessage,
  ChatMessage,
  FunctionMessageFieldsWithName,
  ToolMessageFieldsWithToolCallId,
} from "@langchain/core/messages";

export interface MongoStoredMessage extends StoredMessage {
  id: number;
}
/**
 * Transforms an array of `BaseMessage` instances into an array of
 * `StoredMessage` instances. It does this by calling the `toDict` method
 * on each `BaseMessage`, which returns a `StoredMessage`. This function
 * is used to prepare chat messages for storage.
 */
export function mapChatMessagesToStoredMongoMessages(
  messages: BaseMessage[],
  id: number,
) {
  const stored: MongoStoredMessage[] = messages.map((message) => {
    const storedMessage = message.toDict();
    return {
      id,
      ...storedMessage,
    };
  });
  return stored;
}

/**
 * Maps messages from an older format (V1) to the current `StoredMessage`
 * format. If the message is already in the `StoredMessage` format, it is
 * returned as is. Otherwise, it transforms the V1 message into a
 * `StoredMessage`. This function is important for maintaining
 * compatibility with older message formats.
 */
function mapV1MessageToStoredMessage(message: StoredMessage): StoredMessage {
  // TODO: Remove this mapper when we deprecate the old message format.
  if (message.data !== undefined) {
    return message;
  } else {
    const v1Message = message;
    return {
      type: v1Message.type,
      data: {
        // @ts-ignore
        content: v1Message.text,
        // @ts-ignore
        role: v1Message.role,
        name: undefined,
        tool_call_id: undefined,
      },
    };
  }
}
export function mapStoredMessageToChatMessage(
  message: StoredMessage,
):
  | ToolMessage
  | AIMessage
  | ChatMessage
  | FunctionMessage
  | HumanMessage
  | SystemMessage {
  const storedMessage = mapV1MessageToStoredMessage(message);
  switch (storedMessage.type) {
    case "human":
      return new HumanMessage(storedMessage.data);
    case "ai":
      return new AIMessage(storedMessage.data);
    case "system":
      return new SystemMessage(storedMessage.data);
    case "function":
      if (storedMessage.data.name === undefined) {
        throw new Error("Name must be defined for function messages");
      }
      return new FunctionMessage(
        storedMessage.data as unknown as FunctionMessageFieldsWithName,
      );
    case "tool":
      if (storedMessage.data.tool_call_id === undefined) {
        throw new Error("Tool call ID must be defined for tool messages");
      }
      return new ToolMessage(
        storedMessage.data as unknown as ToolMessageFieldsWithToolCallId,
      );
    case "generic": {
      if (storedMessage.data.role === undefined) {
        throw new Error("Role must be defined for chat messages");
      }
      return new ChatMessage(storedMessage.data.content, storedMessage.type);
    }
    default:
      throw new Error(`Got unexpected type: ${storedMessage.type}`);
  }
}
/**
 * Transforms an array of `StoredMessage` instances into an array of
 * `BaseMessage` instances. It uses the `mapV1MessageToStoredMessage`
 * function to ensure all messages are in the `StoredMessage` format, then
 * creates new instances of the appropriate `BaseMessage` subclass based
 * on the type of each message. This function is used to prepare stored
 * messages for use in a chat context.
 */
export function mapStoredMessagesToChatMessages(
  messages: StoredMessage[],
): BaseMessage[] {
  return messages.map(mapStoredMessageToChatMessage);
}
