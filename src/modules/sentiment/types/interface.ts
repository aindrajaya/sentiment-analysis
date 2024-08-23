export interface SentimentBodyRequest {
  product_name: string;
  tweets: string[];
}

export type SentimentBodyResponse = string[];
