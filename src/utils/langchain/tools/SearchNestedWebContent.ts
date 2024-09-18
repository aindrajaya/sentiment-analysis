import { DynamicStructuredTool, Tool, ToolParams } from "langchain/tools";
import { z } from "zod";
import extractMarkdown from "../../etl/jina.js";
import { countTokens } from "../../helper.util.js";
export const SearchNestedWebContentTool = new DynamicStructuredTool({
  name: "search-nested-web-content",
  description:
    "Tool used when you need to search related web content from nested web content like details of the data etc. Please make sure the url are valid with complete url not just the endpoint",
  schema: z.object({ urls: z.array(z.string()) }),
  func: async ({ urls }) => {
    console.log("urls", urls);
    const markdown: Promise<string[]> | any = [];
    for (const url of urls) {
      markdown.push(await extractMarkdown(url));
    }

    console.log(
      `=======================\n Markdown Detail: \n ${JSON.stringify(markdown)} \n=======================`,
    );

    console.log(countTokens(JSON.stringify(markdown)));

    return JSON.stringify(markdown);
  },
});
