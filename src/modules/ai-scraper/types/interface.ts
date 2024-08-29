export interface AiScraperBodyRequest {
  markdown: string;
  task: string;
}

export interface AiScraperV2BodyRequest {
  markdown: string;
  task: string;
  sessionId: string;
}

export interface AiScraperBodyResponse {
  desc: string;
  result: string;
}

export interface AiScraperBodyResponse {
  task: string;
  json: string;
}
