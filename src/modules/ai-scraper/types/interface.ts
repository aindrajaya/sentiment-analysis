export interface AiScraperBodyRequest {
  markdown: string;
  task: string;
}

export interface AiIdentifierBodyRequest {
  markdown: string;
  userId: string;
}

export interface AiScraperV2BodyRequest {
  task: string;
  sessionId: string;
  userId: string;
}

export interface AiScraperBodyResponse {
  task: string;
  json: string;
}

export interface AiIdentifierBodyResponse {
  content: string;
}
