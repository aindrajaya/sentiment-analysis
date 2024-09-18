const extractMarkdown = async (base_url: string) => {
  const url = `https://r.jina.ai/${base_url}`;
  const data = await fetch(url, {
    headers: {
      Authorization:
        "Bearer jina_d60e30c381c74d1f8969890fff44dc15GoJGdCSemNALcHstj6cO4ysVk4Pz",
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
