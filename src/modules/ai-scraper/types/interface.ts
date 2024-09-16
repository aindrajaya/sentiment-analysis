import type { StoredMessage } from "@langchain/core/messages";

export interface AiScraperBodyRequest {
  markdown: string;
  task: string;
}

export interface AiIdentifierBodyRequest {
  url: string;
  markdown: string;
  userId: string;
  isError: boolean;
  httpStatus: number;
  screenshot: string;
}

export interface AiScraperV2BodyRequest {
  task: string;
  sessionId: string;
  userId: string;
  scraperId: string;
}

export type AITypesSchema =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export type AIPropertiesSchema = {
  [key: string]: {
    type: AITypesSchema;
    description: string;
    properties?: AIPropertiesSchema;
    items?: AIItemsSchema;
  };
};
export type AIItemsSchema = {
  type: AITypesSchema;
  description?: string;
  properties?: AIPropertiesSchema;
  items?: AIItemsSchema;
};
export interface AIOutputSchema {
  type: AITypesSchema;
  description?: string;
  properties?: AIPropertiesSchema;
  items?: AIItemsSchema;
}

export interface AiScraperApiBodyRequest {
  markdown: string;
  schema: AIOutputSchema;
}

export interface AiScraperV2BodyRequest {
  task: string;
  sessionId: string;
  userId: string;
  scraperId: string;
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

export interface AiScraperV2MigrateChatHistoryBodyRequest {
  newUserId: string;
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
