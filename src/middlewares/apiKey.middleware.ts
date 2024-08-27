import { errorResponse } from "../utils/helper.util.js";
import * as config from "../configs/general.config.js";
import type { NextFunction, Request, Response } from "express";

const apiUrl = config.platformApiUrl + "/account";
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

  return true;
}

const apiKey = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"] as string;
  const validation = await validateToken(apiKey);
  if (validation) {
    return next();
  } else if (apiKey === config.apiKey) {
    return next();
  }
  return errorResponse(res, "Invalid API Key", null, 401);
};

export default apiKey;
