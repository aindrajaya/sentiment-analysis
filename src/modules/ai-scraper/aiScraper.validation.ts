import { z } from "zod";
import { validate } from "../../utils/helper.util.js";

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

const AiIdentifierSchema = z.object({
  body: z.object({
    markdown: z.string({
      required_error: "Markdown is required",
    }),
  }),
});

const aiScraperValidation = validate(AiScraperSchema);
const aiIdentifierValidation = validate(AiIdentifierSchema);

export { 
  aiScraperValidation,
  aiIdentifierValidation,
};
