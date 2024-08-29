export interface AiScraperBodyRequest {
  markdown: string;
  task: string;
}

export interface AiIdentifierBodyRequest {
  markdown: string;
}

export interface AiScraperBodyResponse {
  task: string;
  json: string;
}

export interface AiIdentifierBodyResponse {
  content: string;
}
