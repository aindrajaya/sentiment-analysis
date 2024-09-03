import { z } from "zod";
import { socketValidate, validate } from "../../utils/helper.util.js";

const AiScraperSchema = z.object({
  body: z.object({
    markdown: z.string({
      required_error: "Markdown is required",
    }),
    task: z.string({
      required_error: "What data you need to scrape bro?",
    }),
  }),
});

const AiScraperSchemaV2 = z.object({
  body: z.object({
    sessionId: z.string({
      required_error: "Session ID is required",
    }),
    userId: z.string({
      required_error: "User ID is required",
    }),
    task: z.string({
      required_error: "What data you need to scrape bro?",
    }),
  }),
});

const AiScraperSchemaFinalAnswer = z.object({
  body: z.object({
    sessionId: z.string({
      required_error: "Session ID is required",
    }),
    userId: z.string({
      required_error: "User ID is required",
    }),
  }),
});

const AiScraperSchemaGetSessions = z.object({
  params: z.object({
    userId: z.string({
      required_error: "User ID is required",
    }),
  }),
});

const AiScraperSchemaGetChatHistory = z.object({
  params: z.object({
    userId: z.string({
      required_error: "User ID is required",
    }),
    sessionId: z.string({
      required_error: "Session ID is required",
    }),
  }),
});

const AiIdentifierSchema = z.object({
  body: z.object({
    markdown: z.string({
      required_error: "Markdown is required",
    }),
    userId: z.string({
      required_error: "User ID is required",
    }),
    url: z
      .string({
        required_error: "URL is required",
      })
      .url({ message: "Invalid URL" }),
  }),
});

const aiScraperValidation = validate(AiScraperSchema);
const aiScraperV2Validation = socketValidate(AiScraperSchemaV2);
const aiIdentifierValidation = validate(AiIdentifierSchema);
const aiScraperV2GetSessionsValidation = validate(AiScraperSchemaGetSessions);
const aiScraperV2GetChatHistoryValidation = validate(
  AiScraperSchemaGetChatHistory,
);
const aiFinalAnswerValidation = validate(AiScraperSchemaFinalAnswer);

export {
  aiScraperValidation,
  aiIdentifierValidation,
  aiScraperV2Validation,
  aiFinalAnswerValidation,
  aiScraperV2GetSessionsValidation,
  aiScraperV2GetChatHistoryValidation,
};
