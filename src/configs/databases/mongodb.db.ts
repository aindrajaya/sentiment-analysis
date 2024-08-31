import "dotenv/config";
import { Db, MongoClient } from "mongodb";

export const config = {
  url: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DATABASE,
};

let db: Db | null = null;

export async function connectToMongo(): Promise<void> {
  if (db) {
    return; // Already connected
  }
  try {
    const client = new MongoClient(config.url || "");
    await client.connect();
    db = client.db(config.dbName);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw new Error("Could not connect to MongoDB");
  }
}

export { db }; // Export the `db` variable directly
