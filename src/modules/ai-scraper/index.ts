import * as express from "express";
import { aiScraperValidation } from "./aiScraper.validation.js";
import { askAi, askAiV2 } from "./aiScrpaer.service.js";

const aiRouter = express.Router();
aiRouter.post("/v1", aiScraperValidation, askAi);
aiRouter.post("/v2", askAiV2);
import {
  aiIdentifierValidation,
  aiScraperValidation
} from "./aiScraper.validation.js";
import { askAi, identifyContent } from "./aiScrpaer.service.js";

const sentimentRouter = express.Router();
sentimentRouter.post("/", aiScraperValidation, askAi);
sentimentRouter.post("/identify", aiIdentifierValidation, identifyContent);

export default aiRouter;
