import { z } from "zod";
import { validate } from "../../utils/helper.util.js";

const DetectSentimentSchema = z.object({
  body: z.object({
    product_name: z.string({
      required_error: "Product name is required",
    }),
    tweets: z.array(z.string()).nonempty({
      message: "Tweets are required",
    }),
  }),
});

const detectSentimentValidation = validate(DetectSentimentSchema);

export { detectSentimentValidation };
