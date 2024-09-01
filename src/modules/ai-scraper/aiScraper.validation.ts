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

const AiIdentifierSchema = z.object({
  body: z.object({
    markdown: z.string({
      required_error: "Markdown is required",
    }),
    userId: z.string({
      required_error: "User ID is required",
    }),
  }),
});

const aiScraperValidation = validate(AiScraperSchema);
const aiScraperV2Validation = socketValidate(AiScraperSchemaV2);
const aiIdentifierValidation = validate(AiIdentifierSchema);

export { aiScraperValidation, aiIdentifierValidation, aiScraperV2Validation };
