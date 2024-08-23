import { Request, Response } from "express";
import { successResponse, errorResponse } from "../../utils/helper.util.js";
import { pipeline } from "@xenova/transformers";
import {
  SentimentBodyRequest,
  SentimentBodyResponse,
} from "./types/interface.js";
async function detectSentiment(req: Request, res: Response) {
  try {
    const { product_name, tweets } = req.body as SentimentBodyRequest;

    let pipe = await pipeline(
      "text-classification",
      "Xenova/twitter-roberta-base-sentiment-latest",
    );
    const sentiments = [];
    for (const tweet of tweets) {
      const user = `Product: ${product_name}, People said: ${tweet}`;
      console.log(`text :`, user);
      const output = await pipe(user);
      console.log(`output:`, output);
      // @ts-ignore
      sentiments.push(output[0].label);
    }

    return successResponse<SentimentBodyResponse>(
      res,
      "Sentiment deteceted successfully",
      sentiments,
      200,
    );
  } catch (error: any) {
    return errorResponse(res, "Internal server error", error?.message, 500);
  }
}

export { detectSentiment };
