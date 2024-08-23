import bodyParser from "body-parser";
import type { Application } from "express";
import cors from "cors";
const configServer = (app: Application) => {
  app.use(bodyParser.json());
  app.use(cors());
  app.use(
    bodyParser.urlencoded({
      extended: true,
    }),
  );
  // cors
  app.use(
    cors({
      credentials: true,
      origin: ["*", "http://localhost:3000"],
    }),
  );
};

export { configServer };
