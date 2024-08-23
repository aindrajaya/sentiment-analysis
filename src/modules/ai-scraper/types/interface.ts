export interface AiScraperBodyRequest {
  markdown: string;
  task: string;
}

export interface AiScraperBodyResponse {
  task: string;
  json: string;
}
