import * as express from "express";
import {
  aiIdentifierValidation,
  aiScraperV2Validation,
  aiScraperValidation,
} from "./aiScraper.validation.js";
import { askAi, askAiV2, identifyContent } from "./aiScrpaer.service.js";

const aiRouter = express.Router();
aiRouter.post("/v1", aiScraperValidation, askAi);
aiRouter.post("/v2", aiScraperV2Validation, askAiV2);
aiRouter.post("/identify", aiIdentifierValidation, identifyContent);

export default aiRouter;
