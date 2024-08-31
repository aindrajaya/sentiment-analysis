import { Tool, ToolParams } from "langchain/tools";
export class ExampleTool extends Tool {
  static lc_name() {
    return "ExampleTool";
  }

  name = "example-tool-1";

  description = "This tool just an example how to define a custom tool.";

  constructor(config?: ToolParams) {
    super(config);
  }

  async _call(_: string) {
    return "HAHAHAHA";
  }
}

export class ExampleTool2 extends Tool {
  static lc_name() {
    return "ExampleTool";
  }

  name = "example-tool-2";

  description = "This tool just an example how to define a custom tool.";

  constructor(config?: ToolParams) {
    super(config);
  }

  async _call(_: string) {
    return "World";
  }
}
