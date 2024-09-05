import type { StoredMessage } from "@langchain/core/messages";
import type { ObjectId } from "mongodb";
export interface StoredMessageWithId extends StoredMessage {
  id: ObjectId;
}
