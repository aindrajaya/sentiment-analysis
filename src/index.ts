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
  configServer(app);

  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://127.0.0.1:8080",
        "https://app.mrscraper.com",
        "https://dev.mrscraper.com",
        "https://app.mrscraper.test",
      ],
    },
  });
  await connectToMongo();
  if (!db) {
    console.log("MongoDB connection failed");
    process.exit(1);
  }

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

  // use this endpoint to test the ai scraper v2 with simple client
  // NOTE: if you want to test the ai scraper v2, you need change staticly the session id and the user id in the index.html file (scroll down to the bottom of the file to see the script tag and change the value of the sessionId and userId variables to the desired values)

  app.get("/test/ai-scraper-v2", (req: Request, res: Response) => {
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
