import * as express from "express";
import {
  aiIdentifierValidation,
  aiScraperValidation,
} from "./aiScraper.validation.js";
import { askAi, identifyContent } from "./aiScrpaer.service.js";

const aiRouter = express.Router();
aiRouter.post("/v1", aiScraperValidation, askAi);
aiRouter.post("/identify", aiIdentifierValidation, identifyContent);

export default aiRouter;
