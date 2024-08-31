import * as express from "express";
import { aiScraperValidation } from "./aiScraper.validation.js";
import { askAi, askAiV2 } from "./aiScrpaer.service.js";

const aiRouter = express.Router();
aiRouter.post("/v1", aiScraperValidation, askAi);
aiRouter.post("/v2", askAiV2);

export default aiRouter;
