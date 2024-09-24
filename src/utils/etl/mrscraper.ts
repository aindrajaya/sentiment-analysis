import fetch from "node-fetch";
import { platformApiUrl } from "../../configs/general.config.js";

const extractMarkdown = async (base_url: string, apiKey: string) => {
  const url = `${platformApiUrl}/extract-markdown`;
  console.log("url", url);
  const data = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: base_url,
    }),
  })
    .then((res) => res.json())
    .catch((err) => "");

  console.log(
    `=======================\n Markdown Detail: \n ${data?.content} \n=======================`,
  );
  return data?.content;
};

export default extractMarkdown;
