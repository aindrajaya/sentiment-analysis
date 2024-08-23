import { errorResponse } from "../utils/helper.util.js";
import * as config from "../configs/general.config.js";
import type { NextFunction, Request, Response } from "express";

const apiKey = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey === config.apiKey) {
    return next();
  }
  return errorResponse(res, "Invalid API Key", null, 401);
};

export default apiKey;
