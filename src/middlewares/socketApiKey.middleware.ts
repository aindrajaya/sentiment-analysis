import { validateToken } from "../utils/helper.util.js";
import * as config from "../configs/general.config.js";

const socketApiKey = async (
  key: string,
  callback: (status: boolean) => void,
) => {
  if (key === config.apiKey) {
    callback(true);
  } else {
    try {
      const validation = await validateToken(key);
      callback(validation);
    } catch (error) {
      callback(false);
      console.error(
        "An error occured when validating socket connection (api key): ",
        error,
      );
    }
  }
};

export default socketApiKey;
