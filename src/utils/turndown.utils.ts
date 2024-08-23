import TurndownService from "turndown";
// @ts-ignore
import TurndownPluginGfm from "turndown-plugin-gfm";

var gfm = TurndownPluginGfm.gfm;
console.log(gfm);

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// turndownService.use(gfm);

export default turndownService;
