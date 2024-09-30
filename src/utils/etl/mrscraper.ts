import fetch from "node-fetch";
import { platformApiUrl } from "../../configs/general.config.js";

const extractMarkdown = async (
  type: "extract" | "click" = "extract",
  base_url: string,
  apiKey: string,
  selectors?: string[],
) => {
  const url = `${platformApiUrl}/extract-markdown`;
  console.log("url", url);
  let body: { [key: string]: any } = {
    type,
    url: base_url,
  };
  if (type === "click") {
    body["selectors"] = selectors;
  }
  const data = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
    .then((res) => res.json())
    .catch((err) => "");

  console.log(
    `=======================\n Markdown Detail: \n ${data?.content} \n=======================`,
  );
  return data?.content;
};

export default extractMarkdown;
