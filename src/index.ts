// dependencies / libraries
import express, { NextFunction, Request, Response } from "express";
import { configServer } from "./configs/server.config.js";

// middlewares
import apiKey from "./middlewares/apiKey.middleware.js";

// routers
import sentimentRouter from "./modules/sentiment/index.js";
import aiScraperRouter from "./modules/ai-scraper/index.js";

// configs
import * as config from "./configs/general.config.js";

const port = config.port || 3000;
const app = express();
configServer(app);

// endpoint
app.get("/", (req: Request, res: Response) => {
  res.send("MR Scraper Sentiment Analysis API");
});
app.use("/detect-sentiment", apiKey, sentimentRouter);
app.use("/ai-scraper", apiKey, aiScraperRouter);

/* Error handler */
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.log(err);
});

// logger
app.listen(port, () => {
  console.log(`listening at http://localhost:${port}`);
});
