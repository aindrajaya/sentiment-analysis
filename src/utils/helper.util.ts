import { z } from "zod";
import * as fs from "fs";
import { Page } from "puppeteer";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-extra";
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer-core";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import BlockResourcesPlugin from "puppeteer-extra-plugin-block-resources";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { ObjectAny } from "../interfaces/general.i.js";
import { NextFunction, Request, Response } from "express";
import { encodingForModel, TiktokenModel } from "js-tiktoken";
import { RunLogPatch } from "@langchain/core/tracers/log_stream";
import {
  AiScraperV2BodyRequest,
  AiScraperV2BodyResponse,
} from "../modules/ai-scraper/types/interface.js";
import {
  platformApiUrl,
  platformWebhookSecret,
} from "../configs/general.config.js";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { AIMessageChunk } from "@langchain/core/messages";
import axios from "axios";
import { MongoDBChatMessageHistory } from "./memory/chat_history.js";

// ================== Req/Res Helper ===================
function errorResponse<T>(
  res: Response,
  message: string,
  data: T,
  code: number = 500,
) {
  res.status(code).json({ success: false, message, data });
}

function successResponse<T>(
  res: Response,
  message: string,
  data: T,
  code: number = 200,
) {
  res.status(code).json({ success: true, message, data });
}

function streamResponse<T>(res: Response, data: T) {
  res.write(data);
}

async function streamAIV2Response(
  logStream: AsyncGenerator<RunLogPatch>,
  callback: (data: AiScraperV2BodyResponse, isFinal: boolean) => void,
  userId: string,
  sessionId: string,
  scraperId: string,
) {
  let finalState;
  let currentDesc = "";
  let currentJson = "";
  let currentStream = "";
  let isDescDone = false;
  for await (const chunk of logStream) {
    if (!finalState) {
      finalState = chunk;
    } else {
      finalState = finalState.concat(chunk);
    }
    // console.log("Agent Chunk:", JSON.stringify(chunk, null, 2));
    if (
      chunk.ops.length > 1 &&
      chunk.ops[1].op == "add" &&
      (chunk.ops[1].path == "/logs/ChatOpenAI:2/streamed_output/-" ||
        chunk.ops[1].path == "/logs/ChatOpenAI/streamed_output/-")
    ) {
      const addOp = chunk.ops[1];
      if (addOp.value instanceof ChatGenerationChunk) {
        let content: string | undefined;
        if (addOp.value.text != "") {
          content = addOp.value.text;
        } else if (addOp.value.message instanceof AIMessageChunk) {
          content =
            addOp.value.message.additional_kwargs.function_call?.arguments;
        }

        const data: AiScraperV2BodyResponse = {
          desc: "",
          json: "",
        };
        if (typeof content == "string") {
          if (content.includes("desc") && !isDescDone) {
            currentStream = "desc";
            isDescDone = true;
          } else if (content.includes("json")) {
            currentStream = "json";
          }

          if (currentStream == "desc") {
            currentDesc += content;
            currentDesc = currentDesc
              .replace("desc", "")
              .replace(`desc":"`, "")
              .replace(`":"`, "")
              .replace(`"`, "")
              .replace(`:`, "")
              .replace(`","`, "")
              .replace(`,"`, "");
            data.desc = currentDesc;
          } else if (currentStream == "json") {
            currentJson += content;
            data.desc = currentDesc;
            if (currentJson.includes("```json")) {
              const jsonContentMatch =
                currentJson.match(/```json([\s\S]*?)```/);
              if (!jsonContentMatch) {
                const startIndex = currentJson.indexOf("```json");
                data.json = currentJson.substring(startIndex);
              } else {
                data.json = "```json" + jsonContentMatch[1] + "```";
              }
            } else {
              // console.log("current json", currentJson);
              if (currentJson.includes(`json":"`)) {
                const jsonContentMatch = currentJson.match(/json":"(.*)"/);
                if (!jsonContentMatch) {
                  const startIndex = currentJson.indexOf(`json":"`);
                  data.json =
                    "```json \n" +
                    currentJson.substring(startIndex + 8) +
                    "```";
                } else {
                  data.json =
                    "```json" +
                    jsonContentMatch[1]
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, "\\") +
                    "```";
                }
              }
            }
          }
          callback(data, false);
        }
      }
    } else if (
      chunk.ops.length > 0 &&
      chunk.ops[0].op == "replace" &&
      chunk.ops[0].path == "/final_output"
    ) {
      const replaceOp = chunk.ops[0];
      const content = replaceOp.value?.output;

      if (content) {
        console.log("content", content);
        let result = { desc: "", json: "" };
        try {
          let { desc, json } =
            typeof content == "string" ? JSON.parse(content) : content;
          result.desc = desc;
          json = json.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          const jsonContentMatch = json.match(/```json([\s\S]*?)```/);
          if (!jsonContentMatch) {
            json = "```json" + json + "```";
          }
          result.json = json;
        } catch (error) {
          if (typeof content == "string") {
            result.desc = content;
          }
        }
        await callMrScraperTokenWebhook(userId, sessionId, scraperId);
        callback(result, true);
      }
    }
  }
}

async function callMrScraperTokenWebhook(
  userId: string,
  sessionId: string,
  scraperId: string,
) {
  try {
    const memory = new MongoDBChatMessageHistory({ userId, sessionId });
    const finalAnswer = await memory.saveFinalAnswer();
    await axios.post(`${platformApiUrl}/scrape-gpt/token`, {
      scraper_id: +scraperId,
      input_token: finalAnswer.inputToken,
      output_token: finalAnswer.outputToken,
      secret: platformWebhookSecret,
    });
  } catch (error) {
    console.error("Error", error);
  }
}

async function hookResponse<T>(
  result: any | T,
  event: ObjectAny,
  context: ObjectAny,
  error: string | null = null,
) {
  try {
    // let s3 = new S3Client({
    //   region: process.env.AWS_REGION,
    // });

    const response: ObjectAny = {};
    response.type = "leads_generator";
    response.code = event.code;
    response.runtime =
      (event.timeout - context.getRemainingTimeInMillis()) / 1000;
    response.screenshots = [];
    response.recording_path = null;
    response.html_path = null;
    response.data_path = uploadFile(
      JSON.stringify(result.json, null, 2),
      "/assets/results/ai_scraper_result.json",
    );
    response.data = JSON.stringify(result.json, null, 2);
    response.task = result.task;

    if (error) {
      response.error = error;
    }

    await fetch(event.ping, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(response),
    });
  } catch (error) {
    console.error(error);
  }
}

const apiUrl = platformApiUrl + "/account";
async function validateToken(token: string) {
  console.log("Validate API URL:", apiUrl);
  const bearer = "Bearer " + token;
  console.log("Bearer:", bearer);

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: bearer,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.log("response:", res);
    return false;
  }

  const data = await res.json();
  console.log("result:", JSON.stringify(data, null, 2));

  if (data.data.token_usage >= data.data.token_limit) {
    return false;
  }

  return true;
}

function validate(scheme: z.ZodSchema<object>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      scheme.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      return next();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return errorResponse(res, error.errors[0].message, null, 400);
      }
      return errorResponse(res, "Internal server error", error?.message, 500);
    }
  };
}

function socketValidate(scheme: z.ZodSchema<object>) {
  return (payload: AiScraperV2BodyRequest) => {
    try {
      scheme.parse({
        body: payload,
      });

      return { status: true, message: "Validated" };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return { status: false, message: error.errors[0].message };
      }
      return { status: false, message: "Internal server error" };
    }
  };
}

// ================== File Helper ===================
export function uploadFile(
  file: string | NodeJS.ArrayBufferView,
  fullPath: string,
) {
  const outputDir = fullPath.split("/").slice(0, -1).join("/");
  console.log("outputDir", outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  try {
    fs.writeFileSync(fullPath, file);
    return fullPath;
  } catch (err) {
    console.error("upload error", err);
    return null;
  }
}

// ================== Scraper Helper ===================
export async function getBrowserInstance(event: ObjectAny) {
  let args = chromium.args;

  // @ts-ignore
  puppeteer.use(StealthPlugin());

  // @ts-ignore
  puppeteer.use(
    // @ts-ignore
    AdblockerPlugin({
      blockTrackersAndAnnoyances: true,
      interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    }),
  );
  if (event.disabled_resources) {
    // @ts-ignore
    puppeteer.use(
      // @ts-ignore
      BlockResourcesPlugin({
        blockedTypes: new Set(event.disabled_resources),
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
      }),
    );
  }

  // @ts-ignore
  return await puppeteer.launch({
    args: args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    timeout: event.timeout,
  });
}

export async function setupPageListeners(page: Page) {
  page.on("dialog", async (dialog) => {
    await dialog.dismiss();
  });

  page.on("pageerror", async (error) => {
    console.log("page error: " + error);
  });

  page.on("console", async (msg) => {
    console.log("PAGE LOG", msg.text());
  });

  page.on("error", async (error) => {
    console.log("scraping script errored: ", error.message);
  });
}

export async function configurePage(page: Page, event: ObjectAny) {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setDefaultNavigationTimeout(event.timeout * 1000);
  await page.setUserAgent(event.user_agent);
  if (event.cookies?.length) {
    await page.setCookie(...event.cookies);
  }
  if (event.http_headers && Object.keys(event.http_headers).length) {
    await page.setExtraHTTPHeaders(event.http_headers);
  }
}

// ===================== Open AI Helper =====================
export function countTokens(
  text: string,
  model: TiktokenModel = "gpt-4o-mini",
) {
  const encoding = encodingForModel(model);
  const tokens = encoding.encode(text);
  return tokens.length;
}

export function limitTokens(
  text: string,
  tokensLimit: number,
  model: TiktokenModel = "gpt-4o-mini",
) {
  const encoding = encodingForModel(model);
  const tokens = encoding.encode(text).slice(0, tokensLimit);

  return encoding.decode(tokens);
}

export {
  errorResponse,
  successResponse,
  validate,
  socketValidate,
  validateToken,
  streamResponse,
  streamAIV2Response,
};
