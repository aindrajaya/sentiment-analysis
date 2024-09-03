import * as express from "express";
import {
  aiFinalAnswerValidation,
  aiIdentifierValidation,
  aiScraperValidation,
} from "./aiScraper.validation.js";
import {
  askAi,
  identifyContent,
  saveFinalAnswer,
} from "./aiScrpaer.service.js";

const aiRouter = express.Router();
aiRouter.post("/v1", aiScraperValidation, askAi);
aiRouter.post("/v2/save-result", aiFinalAnswerValidation, saveFinalAnswer);
aiRouter.post("/identify", aiIdentifierValidation, identifyContent);

export default aiRouter;
