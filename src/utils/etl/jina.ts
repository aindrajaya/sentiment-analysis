import { jinaApiKey } from "../../configs/general.config.js";

const extractMarkdown = async (base_url: string) => {
  const url = `https://r.jina.ai/${base_url}`;
  const data = await fetch(url, {
    headers: {
      Authorization: "Bearer " + jinaApiKey,
    },
  })
    .then((res) => res.text())
    .catch((err) => "");

  console.log(
    `=======================\n Markdown Detail: \n ${data} \n=======================`,
  );
  return data;
};

export default extractMarkdown;
