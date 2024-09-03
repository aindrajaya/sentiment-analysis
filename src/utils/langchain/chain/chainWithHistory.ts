import {
  AIMessage,
  HumanMessage,
  isBaseMessage,
  BaseMessage,
} from "@langchain/core/messages";
import {
  Runnable,
  type RunnableBindingArgs,
  RunnablePassthrough,
  RunnableConfig,
  RunnableBinding,
  RunnableLambda,
} from "@langchain/core/runnables";
import {
  BaseChatMessageHistory,
  BaseListChatMessageHistory,
} from "@langchain/core/chat_history";
import { Run } from "@langchain/core/tracers/base";
import { AIOutputMessage } from "../message/ai.js";
type GetSessionHistoryCallable = (
  ...args: Array<any>
) =>
  | Promise<BaseChatMessageHistory | BaseListChatMessageHistory>
  | BaseChatMessageHistory
  | BaseListChatMessageHistory;
export interface RunnableWithMessageHistoryInputs<RunInput, RunOutput>
  extends Omit<RunnableBindingArgs<RunInput, RunOutput>, "bound" | "config"> {
  runnable: Runnable<RunInput, RunOutput>;
  getMessageHistory: GetSessionHistoryCallable;
  inputMessagesKey?: string;
  outputMessagesKey?: string;
  historyMessagesKey?: string;
  config?: RunnableConfig;
}

export class ChainWithMessageHistory<
  RunInput,
  RunOutput,
> extends RunnableBinding<RunInput, RunOutput> {
  runnable: Runnable<RunInput, RunOutput>;
  inputMessagesKey?: string;
  outputMessagesKey?: string;
  historyMessagesKey?: string;
  getMessageHistory: GetSessionHistoryCallable;
  constructor(fields: RunnableWithMessageHistoryInputs<RunInput, RunOutput>) {
    let historyChain = new RunnableLambda({
      func: (input, options) => this._enterHistory(input, options ?? {}),
    }).withConfig({ runName: "loadHistory" });
    const messagesKey = fields.historyMessagesKey ?? fields.inputMessagesKey;
    if (messagesKey) {
      // @ts-ignore
      historyChain = RunnablePassthrough.assign({
        [messagesKey]: historyChain,
      }).withConfig({ runName: "insertHistory" });
    }
    const bound = historyChain
      .pipe(
        // @ts-ignore
        fields.runnable.withListeners({
          onEnd: (run, config) => this._exitHistory(run, config ?? {}),
        }),
      )
      .withConfig({ runName: "RunnableWithMessageHistory" });
    const config = fields.config ?? {};
    super({
      ...fields,
      config,
      bound,
    });
    this.runnable = fields.runnable;
    this.getMessageHistory = fields.getMessageHistory;
    this.inputMessagesKey = fields.inputMessagesKey;
    this.outputMessagesKey = fields.outputMessagesKey;
    this.historyMessagesKey = fields.historyMessagesKey;
  }
  _getInputMessages(
    inputValue: string | BaseMessage | Array<BaseMessage> | Record<string, any>,
  ): Array<BaseMessage> {
    let parsedInputValue;
    if (
      typeof inputValue === "object" &&
      !Array.isArray(inputValue) &&
      !isBaseMessage(inputValue)
    ) {
      let key;
      if (this.inputMessagesKey) {
        key = this.inputMessagesKey;
      } else if (Object.keys(inputValue).length === 1) {
        key = Object.keys(inputValue)[0];
      } else {
        key = "input";
      }
      if (Array.isArray(inputValue[key]) && Array.isArray(inputValue[key][0])) {
        parsedInputValue = inputValue[key][0];
      } else {
        parsedInputValue = inputValue[key];
      }
    } else {
      parsedInputValue = inputValue;
    }
    if (typeof parsedInputValue === "string") {
      return [new HumanMessage(parsedInputValue)];
    } else if (Array.isArray(parsedInputValue)) {
      return parsedInputValue;
    } else if (isBaseMessage(parsedInputValue)) {
      return [parsedInputValue];
    } else {
      throw new Error(
        `Expected a string, BaseMessage, or array of BaseMessages.\nGot ${JSON.stringify(parsedInputValue, null, 2)}`,
      );
    }
  }
  _getOutputMessages(
    outputValue:
      | string
      | BaseMessage
      | Array<BaseMessage>
      | Record<string, any>,
  ): Array<BaseMessage> {
    let parsedOutputValue;
    if (
      !Array.isArray(outputValue) &&
      !isBaseMessage(outputValue) &&
      typeof outputValue !== "string"
    ) {
      let key;
      if (this.outputMessagesKey !== undefined) {
        key = this.outputMessagesKey;
      } else if (Object.keys(outputValue).length === 1) {
        key = Object.keys(outputValue)[0];
      } else {
        key = "output";
      }
      // If you are wrapping a chat model directly
      // The output is actually this weird generations object
      if (outputValue.generations !== undefined) {
        parsedOutputValue = outputValue.generations[0][0].message;
      } else {
        parsedOutputValue = outputValue[key];
      }
    } else {
      parsedOutputValue = outputValue;
    }
    if (typeof parsedOutputValue === "string") {
      return [new AIMessage(parsedOutputValue)];
    } else if (Array.isArray(parsedOutputValue)) {
      return parsedOutputValue;
    } else if (isBaseMessage(parsedOutputValue)) {
      return [parsedOutputValue];
    } else if (typeof parsedOutputValue === "object") {
      return [new AIOutputMessage(JSON.stringify(parsedOutputValue, null, 2))];
    } else {
      throw new Error(
        `Expected a string, BaseMessage, or array of BaseMessages. Received: ${JSON.stringify(parsedOutputValue, null, 2)}`,
      );
    }
  }
  async _enterHistory(
    input: any,
    kwargs?: RunnableConfig,
  ): Promise<BaseMessage[]> {
    const history = kwargs?.configurable?.messageHistory;
    const messages = await history.getMessages();
    if (this.historyMessagesKey === undefined) {
      return messages.concat(this._getInputMessages(input));
    }
    return messages;
  }
  async _exitHistory(run: Run, config: RunnableConfig): Promise<void> {
    const history = config.configurable?.messageHistory;
    // Get input messages
    let inputs;
    // Chat model inputs are nested arrays
    if (Array.isArray(run.inputs) && Array.isArray(run.inputs[0])) {
      inputs = run.inputs[0];
    } else {
      inputs = run.inputs;
    }
    let inputMessages = this._getInputMessages(inputs);
    // If historic messages were prepended to the input messages, remove them to
    // avoid adding duplicate messages to history.
    if (this.historyMessagesKey === undefined) {
      const existingMessages = await history.getMessages();
      inputMessages = inputMessages.slice(existingMessages.length);
    }
    // Get output messages
    const outputValue = run.outputs;
    if (!outputValue) {
      throw new Error(
        `Output values from 'Run' undefined. Run: ${JSON.stringify(run, null, 2)}`,
      );
    }
    console.log("OUTPUT VALUE", outputValue);
    const outputMessages = this._getOutputMessages(outputValue);
    await history.addMessages([...inputMessages, ...outputMessages]);
  }
  async _mergeConfig(
    ...configs: Array<RunnableConfig | undefined>
  ): Promise<Partial<RunnableConfig>> {
    const config = await super._mergeConfig(...configs);
    // Extract sessionId
    if (!config.configurable || !config.configurable.sessionId) {
      const exampleInput = {
        [this.inputMessagesKey ?? "input"]: "foo",
      };
      const exampleConfig = { configurable: { sessionId: "123" } };
      throw new Error(
        `sessionId is required. Pass it in as part of the config argument to .invoke() or .stream()\n` +
          `eg. chain.invoke(${JSON.stringify(exampleInput)}, ${JSON.stringify(exampleConfig)})`,
      );
    }
    // attach messageHistory
    const { sessionId } = config.configurable;
    config.configurable.messageHistory =
      await this.getMessageHistory(sessionId);
    return config;
  }
}
