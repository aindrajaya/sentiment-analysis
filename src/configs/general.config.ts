import "dotenv/config";
const apiKey = process.env.API_KEY;
const port = process.env.PORT;
const xKey = process.env.X_KEY;
const xSecret = process.env.X_SECRET;
const xBearer = process.env.X_BEARER;
const xToken = process.env.X_TOKEN;
const xTokenSecret = process.env.X_TOKEN_SECRET;
const xClientId = process.env.X_CLIENTID;
const xClientSecret = process.env.X_CLIENTSECRET;
const mongoUri = process.env.MONGO_URI;
const xCallbackUrl = process.env.APP_URL + "/integration/x/oauth2-callback";
const platformApiUrl = process.env.PLATFORM_API_URL;
const platformWebhookSecret = process.env.PLATFORM_WEBHOOK_SECRET;
const jinaApiKey = process.env.JINA_API_KEY;
const proxyUrl = process.env.PROXY_URL;
export {
  platformWebhookSecret,
  platformApiUrl,
  apiKey,
  port,
  xKey,
  xSecret,
  xBearer,
  xToken,
  xTokenSecret,
  mongoUri,
  xClientId,
  xClientSecret,
  xCallbackUrl,
  jinaApiKey,
  proxyUrl,
};
