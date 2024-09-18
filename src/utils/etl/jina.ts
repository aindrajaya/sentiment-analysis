import { jinaApiKey } from "../../configs/general.config.js";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

const extractMarkdown = async (base_url: string) => {
  const url = `https://r.jina.ai/${base_url}`;
  const data = await fetch(url, {
    // headers: {
    //   Authorization: "Bearer " + jinaApiKey,
    // },
    agent: new HttpsProxyAgent(
      "http://xjrxxdsh-rotate:bs1a64qlhfnk@p.webshare.io:80",
    ),
  })
    .then((res) => res.text())
    .catch((err) => "");

  console.log(
    `=======================\n Markdown Detail: \n ${data} \n=======================`,
  );
  return data;
};

export default extractMarkdown;
