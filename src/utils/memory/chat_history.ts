import { BaseListChatMessageHistory } from "@langchain/core/chat_history";

import type { StoredMessage, BaseMessage } from "@langchain/core/messages";
import { mapChatMessagesToStoredMessages } from "@langchain/core/messages";
import {
  mapStoredMessageToChatMessage,
  mapStoredMessagesToChatMessages,
} from "./libs/utils.js";
import { Collection, Document, ObjectId, PushOperator } from "mongodb";
import { Document as ChainDoc } from "@langchain/core/documents";
import { db } from "../../configs/databases/mongodb.db.js";
import { UsageMetadata } from "../langchain/callbacks/llm/types/interfacte.js";
interface MongoDBChatMessageHistoryProps {
  sessionId?: string;
  userId: string;
}

/** HACK: SOME DATA SCHEMA DETAILS:
 
    AI Answer Schema
    - descritption: "the answer"
    - result: "```json JSON_RESULT ```"
    Memory schema
    - userId: the user id
    - sessionId: unique id for the user session
    - messages: chat history for the user session
    - - messages schema
    - - - id: unique id for the chat message
    - - - type: the type of the message
    - - - data: the message data
    - - - - data schema
    - - - - - content: the message content
    - - - - - role: the role of the message
    - - - - - name: the name of the message
    - - - - - tool_call_id: the tool call id
    - - - - - additional_kwargs: additional kwargs
    - - - - - response_metadata: response metadata
    - - - - - - response_metadata schema key-value pair 
    - - - - - - - documentUsed: the documents from chunk of pageContent used in the conversation
    - - - - - - - oToken: output token used in the conversation
    - - - - - - - iToken: input token used in the conversation
    - - - - - id: unique id for the message
    - aiFinalAnswer: ai answer that has confirmed by the user in json string format {descritption: "the answer",result: "```json JSON_RESULT ```"}
    - pageContent: the documents used in the conversation
    - documents: chunk of pageContent
    - totalInputToken: total token used in the conversation
    - totalOutputToken: total token used in the conversation
**/

export interface ChatDocument extends Document {
  userId: string;
  url: string;
  messages: StoredMessage[];
  pageContent: string;
  finalAnswer?: string;
  inputToken: number;
  outputToken: number;
}

export class MongoDBChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace: string[] = ["langchain", "stores", "message", "mongodb"];
  collection: Collection<ChatDocument>; // Adjust this type according to your MongoDB collection type
  sessionId: ObjectId;
  userId: string;
  idKey: string = "_id";

  constructor({ sessionId, userId }: MongoDBChatMessageHistoryProps) {
    super();
    this.collection = db!.collection("memory") as Collection<ChatDocument>;
    if (!sessionId) {
      this.sessionId = new ObjectId();
    } else {
      this.sessionId = new ObjectId(sessionId);
    }
    console.log("sessionId", sessionId);
    this.userId = userId;
    console.log("userId", userId);
  }

  splitMessagesByQnA(messages: StoredMessage[]): ChainDoc[] {
    const docs: ChainDoc[] = [];
    const temp = [];
    for (let i = 0; i < messages.length; i++) {
      temp.push(messages[i]);
      if (i % 2 === 0) {
        docs.push(
          new ChainDoc({
            pageContent: temp
              .map((m) => `${m.data.role}: ${m.data.content}`)
              .join("\n"),
            metadata: [{ ...temp }],
          }),
        );
      }
    }
    return docs;
  }

  // NOTE: still in consideration for the implementation
  searchSimilarMessages(messages: StoredMessage[], query: string) {}

  async getSessions() {
    const documents = await this.collection
      .find({ userId: this.userId })
      .toArray();
    const history = documents.map((doc) => {
      return {
        sessionId: doc._id.toString(),
        name: doc.url,
      };
    });
    return history;
  }

  async getChatHistory() {
    const document = await this.collection.findOne({
      userId: this.userId,
      [this.idKey]: this.sessionId,
    });
    const messages = document?.messages || [];
    messages.splice(0, 2);
    return messages;
  }
  async getConversationTokenUsage() {
    const document = await this.collection.findOne({
      userId: this.userId,
      [this.idKey]: this.sessionId,
    });
    return {
      inputTokens: document?.inputToken || 0,
      outputTokens: document?.outputToken || 0,
    };
  }
  async updateSessionOwnership(newOwner: string) {
    const updated = await this.collection.updateOne(
      {
        userId: this.userId,
        [this.idKey]: this.sessionId,
      },
      {
        $set: {
          userId: newOwner,
        },
      },
    );
    return updated.modifiedCount > 0;
  }
  async createSession(content: string, url: string) {
    const session = await this.collection.insertOne({
      userId: this.userId,
      url: url,
      messages: [],
      inputToken: 0,
      outputToken: 0,
      totalToken: 0,
      pageContent: content,
    });
    this.sessionId = session.insertedId;
    return session.insertedId.toString();
  }

  async saveFinalAnswer() {
    const lastAnswer = await this.collection.findOne({
      userId: this.userId,
      [this.idKey]: this.sessionId,
    });
    const aiAnswers = lastAnswer?.messages.filter(
      (message) => message.type == "ai",
    );
    const finalAnswer = aiAnswers
      ? aiAnswers[aiAnswers.length - 1].data.content
      : "";
    await this.collection.updateOne(
      {
        [this.idKey]: this.sessionId,
        userId: this.userId,
      },
      {
        $set: {
          aiFinalAnswer: finalAnswer,
        },
      },
    );

    return {
      finalAnswer: finalAnswer,
      inputToken: lastAnswer?.inputToken,
      outputToken: lastAnswer?.outputToken,
    };
  }

  async getPageContent() {
    const document = await this.collection.findOne({
      userId: this.userId,
      [this.idKey]: this.sessionId,
    });
    const pageContent =
      document?.pageContent ||
      "Something went wrong while fetching the page content, please try to scrape again.";
    const webPage = document?.url;
    return { pageContent, webPage };
  }

  async getMetadata() {
    const document = await this.collection.findOne({
      userId: this.userId,
      [this.idKey]: this.sessionId,
    });
    return document;
  }

  async getMessages() {
    const document = await this.collection.findOne({
      userId: this.userId,
      [this.idKey]: this.sessionId,
    });
    const messages = document?.messages || [];
    if (messages.length > 4) {
      messages.splice(0, messages.length - 4);
    }
    return mapStoredMessagesToChatMessages(messages);
  }

  async addSessionUsageMetadata(metadata: UsageMetadata) {
    console.log("update metadata", metadata);
    if (metadata) {
      await this.collection.updateOne(
        {
          userId: this.userId,
          [this.idKey]: this.sessionId,
        },
        {
          $inc: {
            inputToken: metadata.input_tokens,
            outputToken: metadata.output_tokens,
            totalToken: metadata.total_tokens,
          },
        },
      );
    }
  }

  async addMessage(message: BaseMessage) {
    console.log("update message", message);
    const chats = mapChatMessagesToStoredMessages([message]);
    await this.collection.updateOne(
      { [this.idKey]: this.sessionId, userId: this.userId },
      {
        $push: {
          messages: { $each: chats },
        } as unknown as PushOperator<ChatDocument>,
      },
      { upsert: true },
    );
  }

  async clear() {
    await this.collection.deleteOne({
      [this.idKey]: this.sessionId,
      userId: this.userId,
    });
  }
}
