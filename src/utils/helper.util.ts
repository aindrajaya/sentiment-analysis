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
export function countTokens(text: string, model: TiktokenModel = "gpt-4o") {
  const encoding = encodingForModel(model);
  const tokens = encoding.encode(text);
  return tokens.length;
}

export { errorResponse, successResponse, validate };
