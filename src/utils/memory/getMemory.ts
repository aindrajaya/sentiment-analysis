import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { BufferMemory } from "langchain/memory";
import { MongoDBChatMessageHistory } from "@langchain/mongodb";

export async function getMemory(sessionId: string | null = null) {
  const client = new MongoClient(process.env.MONGODB_ATLAS_URI || "");
  await client.connect();
  const collection = client.db("ai-scraper").collection("memory");
  // generate a new sessionId string
  if (!sessionId) {
    sessionId = new ObjectId().toHexString();
  }
  const memory = new BufferMemory({
    chatHistory: new MongoDBChatMessageHistory({
      collection,
      sessionId,
    }),
  });
  return memory;
}
