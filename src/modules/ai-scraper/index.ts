import * as express from "express";
import {
  aiIdentifierValidation,
  aiScraperValidation
} from "./aiScraper.validation.js";
import { askAi, identifyContent } from "./aiScrpaer.service.js";

const sentimentRouter = express.Router();
sentimentRouter.post("/", aiScraperValidation, askAi);
sentimentRouter.post("/identify", aiIdentifierValidation, identifyContent);

export default sentimentRouter;
