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
    scraperId: z.string({
      required_error: "Scraper ID is required",
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
const AiScraperSchemaMigrateChatHistory = z.object({
  params: z.object({
    userId: z.string({
      required_error: "User ID is required",
    }),
    sessionId: z.string({
      required_error: "Session ID is required",
    }),
  }),
  body: z.object({
    newUserId: z.string({
      required_error: "New User ID is required",
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
const typeSchema = z.enum(["object", "array", "string", "number", "boolean"], {
  required_error: "Type is required",
  invalid_type_error:
    "Type must be in object, array, string, number, boolean types",
});

const propertiesSchema = z.record(
  z.string().nonempty({ message: "Key is required" }),
  z
    .object({
      type: typeSchema,
      description: z.string({
        required_error: "Description is required",
      }),
      properties: z
        .record(
          z.string().nonempty({ message: "Key is required" }),
          z.object({
            type: z.string({
              required_error: "Type is required",
            }),
            description: z.string({
              required_error: "Description is required",
            }),
          }),
        )
        .optional(),
      items: z
        .object({
          type: z.string({
            required_error: "Type is required",
          }),
          description: z.string({
            required_error: "Description is required",
          }),
          properties: z
            .record(
              z.string().nonempty({ message: "Key is required" }),
              z.object({
                type: z.string({
                  required_error: "Type is required",
                }),
                description: z.string({
                  required_error: "Description is required",
                }),
              }),
            )
            .optional(),
          required: z.array(z.string()).optional(),
        })
        .optional(),
      required: z.array(z.string()).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.type === "object" && !value.properties) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Properties is required for object type",
        });
      } else if (value.type === "array" && !value.items) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Items is required for array type",
        });
      } else if (value.type !== "object" && value.properties) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Properties is not allowed for non-object type",
        });
      } else if (value.type !== "array" && value.items) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Items is not allowed for non-array type",
        });
      }
      if (value.required && value.properties) {
        for (const key of value.required) {
          if (!value.properties[key]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Required key ${key} is not in properties`,
            });
          }
        }
      }
      if (value.items && value.items.type === "object") {
        for (const key of Object.keys(value.items.properties!)) {
          if (value.items.required && !value.items.required.includes(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Key ${key} is not in required keys`,
            });
          }
        }
      }
    }),
);
const itemsSchema = z
  .object({
    type: typeSchema,
    description: z
      .string({
        invalid_type_error: "Description must be a string",
      })
      .optional(),
    items: z
      .object({
        type: z.string({
          required_error: "Type is required",
        }),
        description: z
          .string({
            required_error: "Description is required",
          })
          .optional(),
        properties: propertiesSchema.optional(),
        required: z.array(z.string()).optional(),
      })
      .optional(),
    properties: propertiesSchema.optional(),
    required: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "object" && !value.properties) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Properties is required for object type",
      });
    } else if (value.type === "array" && !value.items) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Items is required for array type",
      });
    } else if (value.type !== "object" && value.properties) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Properties is not allowed for non-object type",
      });
    } else if (value.type !== "array" && value.items) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Items is not allowed for non-array type",
      });
    }

    if (value.items && value.items.type === "object") {
      for (const key of Object.keys(value.items.properties!)) {
        if (value.items.required && !value.items.required.includes(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Key ${key} is not in required keys`,
          });
        }
      }
    }
    if (value.required && value.properties) {
      for (const key of value.required) {
        if (!value.properties[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Required key ${key} is not in properties`,
          });
        }
      }
    }
  });
const AiScraperApiSchema = z.object({
  body: z
    .object({
      markdown: z.string({
        required_error: "Markdown is required",
      }),
      url: z
        .string({
          required_error: "URL is required",
        })
        .url({ message: "Invalid URL" }),
      min: z.number().optional().default(1),
      max: z.number().optional().default(1),
      schema: z.object({
        type: typeSchema,
        items: itemsSchema.optional(),
        properties: propertiesSchema.optional(),
        required: z.array(z.string()).optional(),
      }),
    })
    .superRefine(({ markdown, schema }, ctx) => {
      if (schema.type === "array" && !schema.items) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Items is required for array schema",
        });
      } else if (schema.type === "object" && !schema.properties) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Properties is required for object schema",
        });
      } else if (schema.type !== "object" && schema.properties) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Properties is not allowed for non-object schema",
        });
      } else if (schema.type !== "array" && schema.items) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Items is not allowed for non-array schema",
        });
      }
      if (schema.required && schema.properties) {
        for (const key of schema.required) {
          if (!schema.properties[key]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Required key ${key} is not in properties`,
            });
          }
        }
      }
      if (schema.items && schema.items.type === "object") {
        for (const key of Object.keys(schema.items.properties!)) {
          if (schema.items.required && !schema.items.required.includes(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Key ${key} is not in required keys`,
            });
          }
        }
      }
    }),
});
const aiScraperValidation = validate(AiScraperSchema);
const aiScraperV2Validation = socketValidate(AiScraperSchemaV2);
const aiScraperApiValidation = validate(AiScraperApiSchema);
const apiAiScraperV2Validation = validate(AiScraperSchemaV2);
const aiIdentifierValidation = validate(AiIdentifierSchema);
const aiScraperV2GetSessionsValidation = validate(AiScraperSchemaGetSessions);
const aiScraperV2GetChatHistoryValidation = validate(
  AiScraperSchemaGetChatHistory,
);
const aiScraperV2MigrateChatHistoryValidation = validate(
  AiScraperSchemaMigrateChatHistory,
);
const aiFinalAnswerValidation = validate(AiScraperSchemaFinalAnswer);
export {
  apiAiScraperV2Validation,
  aiScraperValidation,
  aiIdentifierValidation,
  aiScraperV2Validation,
  aiFinalAnswerValidation,
  aiScraperV2GetSessionsValidation,
  aiScraperV2GetChatHistoryValidation,
  aiScraperV2MigrateChatHistoryValidation,
  aiScraperApiValidation,
};
