import { DynamicStructuredTool, Tool, ToolParams } from "langchain/tools";
import { z } from "zod";
import { countTokens } from "../../helper.util.js";
import extractMarkdown from "../../etl/mrscraper.js";

export const PaginateTool = (
  apiKey: string,
  batchCallback: (
    markdown: string,
    url: string,
    question: string,
  ) => Promise<void>,
) =>
  new DynamicStructuredTool({
    name: "paginate-tool",
    description:
      "Tool used when you need to get web content from multiple pages",
    schema: z.object({
      urls: z.array(z.string()),
      question: z
        .string()
        .describe(
          "Clear question for each page, with the specific number of data if exists.",
        ),
    }),
    func: async ({ urls, question }) => {
      console.log("urls", urls);
      console.log("question", question);
      let markdown: Promise<string[]> | any = [];
      for (const url of urls) {
        markdown.push(extractMarkdown("click", url, apiKey));
      }

      markdown = await Promise.all(markdown);

      console.log(
        `=======================\n Markdown All: \n ${JSON.stringify(
          markdown,
        )} \n=======================`,
      );

      const tokenLength = countTokens(JSON.stringify(markdown));
      if (tokenLength > 20_000) {
        let index = 0;
        for (const md of markdown) {
          await batchCallback(md, urls[index], question);
          index++;
        }

        return "All data has been successfully scraped and the content is too long, so tell user it has been sent in batches!. IMPORTANT! Don't give any json again! or call any function again, just say it has been sent in batches!";
      }

      return JSON.stringify(markdown);
    },
  });
