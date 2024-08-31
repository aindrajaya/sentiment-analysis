import "dotenv/config";
import { MongoClient } from "mongodb";

export const config = {
  url: process.env.MONGODB_URI,
  db: process.env.MONGODB_DATABASE,
};

export default async function connectToMongo() {
  try {
    const client = new MongoClient(config.url || "");
    await client.connect();
    return client.db(config.db);
  } catch (error) {
    console.error(error, "\n\n Your Configuration: ", { ...config });
    throw new Error(
      "Could not connect to MongoDB, please check your connection.",
    );
  }
}
