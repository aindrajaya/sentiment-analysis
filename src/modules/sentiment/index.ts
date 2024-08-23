import * as express from "express";
import { detectSentimentValidation } from "./sentiment.validation.js";
import { detectSentiment } from "./sentiment.service.js";

const sentimentRouter = express.Router();
sentimentRouter.post("/", detectSentimentValidation, detectSentiment);

export default sentimentRouter;
