import * as express from "express";
import {
  aiFinalAnswerValidation,
  aiIdentifierValidation,
  aiScraperV2GetChatHistoryValidation,
  aiScraperV2GetSessionsValidation,
  aiScraperValidation,
  apiAiScraperV2Validation,
} from "./aiScraper.validation.js";
import {
  askAi,
  askAiV2,
  getChatHistory,
  getSessions,
  identifyContent,
  saveFinalAnswer,
} from "./aiScrpaer.service.js";
import { successResponse } from "../../utils/helper.util.js";

const aiRouter = express.Router();
aiRouter.post("/v1", aiScraperValidation, askAi);
aiRouter.post(
  "/v2",
  apiAiScraperV2Validation,
  (req: express.Request, res: express.Response) =>
    askAiV2(
      req.body,
      (result) => successResponse(res, "answered", result, 200),
      false,
    ),
);
aiRouter.post("/v2/save-result", aiFinalAnswerValidation, saveFinalAnswer);
aiRouter.get(
  "/v2/chat-history/:userId",
  aiScraperV2GetSessionsValidation,
  getSessions,
);
aiRouter.get(
  "/v2/chat-history/:userId/:sessionId",
  aiScraperV2GetChatHistoryValidation,
  getChatHistory,
);
aiRouter.post("/identify", aiIdentifierValidation, identifyContent);

export default aiRouter;
