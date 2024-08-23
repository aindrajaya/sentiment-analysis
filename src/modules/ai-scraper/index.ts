import * as express from "express";
import { aiScraperValidation } from "./aiScraper.validation.js";
import { askAi } from "./aiScrpaer.service.js";

const sentimentRouter = express.Router();
sentimentRouter.post("/", aiScraperValidation, askAi);

export default sentimentRouter;
