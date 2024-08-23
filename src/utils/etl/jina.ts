const extractMarkdown = async (base_url: string) => {
  const url = `https://r.jina.ai/${base_url}`;
  const data = await fetch(url)
    .then((res) => res.text())
    .catch((err) => "");

  console.log("data", data);
  return data;
};

export default extractMarkdown;
