import { Server } from "socket.io";
import { AiScraperV2BodyRequest } from "./modules/ai-scraper/types/interface.js";
import { aiScraperV2Validation } from "./modules/ai-scraper/aiScraper.validation.js";
import socketApiKey from "./middlewares/socketApiKey.middleware.js";
import { askAiV2 } from "./modules/ai-scraper/aiScraper.service.js";
import { apiKey } from "./configs/general.config.js";

export default function socketServer(io: Server) {
  io.use((socket, next) =>
    socketApiKey(socket.handshake.auth.apiKey, (status) => {
      if (!status) {
        io.to(socket.id).emit("error", "Invalid API Key");
        // close the connection
        socket.disconnect();
      } else {
        console.log("Socket API Key is valid");
        next();
      }
    }),
  );

  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });

    socket.on("ask-ai-v2", async (payload: AiScraperV2BodyRequest) => {
      console.log("ask-ai-v2", payload);
      const { status, message } = aiScraperV2Validation(payload);
      if (!status) {
        io.to(socket.id).emit("conversation-error", message);
      } else {
        await askAiV2(
          payload,
          (res, isFinal) => {
            const response = { ...res, isFinal };
            io.to(socket.id).emit("answer-ai-v2", response);
          },
          socket.handshake.auth.apiKey,
        );
      }
    });
  });
}
