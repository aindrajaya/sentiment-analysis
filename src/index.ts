// dependencies / libraries
import express, { NextFunction, Request, Response } from "express";
import { Server } from "socket.io";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
// middlewares
import apiKey from "./middlewares/apiKey.middleware.js";

// routers
import sentimentRouter from "./modules/sentiment/index.js";
import aiScraperRouter from "./modules/ai-scraper/index.js";

// configs
import * as config from "./configs/general.config.js";
import { configServer } from "./configs/server.config.js";
import { connectToMongo, db } from "./configs/databases/mongodb.db.js";
import socketServer from "./socketServer.js";
import { join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function main() {
  const port = config.port || 3000;
  const app = express();
  const server = createServer(app);
  const io = new Server(server);
  await connectToMongo();
  if (!db) {
    console.log("MongoDB connection failed");
    process.exit(1);
  }
  configServer(app);

  /*
   * Web Socket Server
   */
  socketServer(io);

  /*
   * REST API
   */
  // endpoint
  app.get("/", (req: Request, res: Response) => {
    res.send("MR Scraper Sentiment Analysis API");
  });

  app.get("/test", (req: Request, res: Response) => {
    res.sendFile(join(__dirname, "index.html"));
  });
  app.use("/detect-sentiment", apiKey, sentimentRouter);
  app.use("/ai-scraper", apiKey, aiScraperRouter);

  /* Error handler */
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.log(err);
  });

  // logger
  server.listen(port, () => {
    console.log(`listening at http://localhost:${port}`);
  });
}

main();
