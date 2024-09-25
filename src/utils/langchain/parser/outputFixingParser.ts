import {
  BaseOutputParser,
  OutputParserException,
} from "@langchain/core/output_parsers";
import { LLMChain } from "langchain/chains";
import { Runnable } from "@langchain/core/runnables";
import { BasePromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import { Callbacks } from "@langchain/core/callbacks/manager";
interface OutputFixingParserRetryInput {
  instructions: string;
  completion: string;
  error: OutputParserException;
}
function isLLMChain(x: any) {
  return x.prompt !== undefined && x.llm !== undefined;
}
const FixingPrompt = PromptTemplate.fromTemplate(
  "Instructions:\n--------------\n{instructions}\n !IMPORTANT Do not return the answer wrapped in ```json FIXED_ANSWER ```, just return the answer directly!\n--------------\nCompletion:\n--------------\n{completion}\n--------------\n\nAbove, the Completion did not satisfy the constraints given in the Instructions.\nError:\n--------------\n{error}\n--------------\n\nPlease try again. \n\n !IMPORTANT\n 1. Do not give data that not included in the completion (you can give an empty value with the same type laid out in the instructions) \n 2. Do Not Halucinate! \n 3. Only respond with an answer that satisfies the constraints laid out in the Instructions:",
);

/**
 * Class that extends the BaseOutputParser to handle situations where the
 * initial parsing attempt fails. It contains a retryChain for retrying
 * the parsing process in case of a failure.
 */

export class OutputFixingParser<T> extends BaseOutputParser<T> {
  lc_namespace: string[] = ["langchain", "output_parsers", "fix"];
  // @ts-ignore
  lc_serializable: boolean = true;
  parser: BaseOutputParser<T>;
  retryChain: LLMChain | Runnable<OutputFixingParserRetryInput, T>;
  static lc_name() {
    return "OutputFixingParser";
  }
  /**
   * Static method to create a new instance of OutputFixingParser using a
   * given language model, parser, and optional fields.
   * @param llm The language model to be used.
   * @param parser The parser to be used.
   * @param fields Optional fields which may contain a prompt.
   * @returns A new instance of OutputFixingParser.
   */
  static fromLLM<T>(
    llm: BaseLanguageModelInterface,
    parser: BaseOutputParser<T>,
    fields?: {
      prompt?: BasePromptTemplate;
    },
  ): OutputFixingParser<T> {
    console.log("Masuk sini");
    const prompt = fields?.prompt ?? FixingPrompt;
    const chain = new LLMChain({ llm, prompt });
    return new OutputFixingParser({ parser, retryChain: chain });
  }

  constructor({
    parser,
    retryChain,
  }: {
    parser: BaseOutputParser<T>;
    retryChain: LLMChain | Runnable<OutputFixingParserRetryInput, T>;
  }) {
    super(...arguments);
    this.parser = parser;
    this.retryChain = retryChain;
  }
  /**
   * Method to parse the completion using the parser. If the initial parsing
   * fails, it uses the retryChain to attempt to fix the output and retry
   * the parsing process.
   * @param completion The completion to be parsed.
   * @param callbacks Optional callbacks to be used during parsing.
   * @returns The parsed output.
   */
  async parse(completion: string, callbacks?: Callbacks): Promise<T> {
    console.log("sini lah");
    try {
      return await this.parser.parse(completion, callbacks);
    } catch (e) {
      console.log("Ke catch nih");
      // eslint-disable-next-line no-instanceof/no-instanceof
      if (e instanceof OutputParserException) {
        let answer = completion.includes("Text:")
          ? completion.split("Text: ")[1].split(". Error:")[0].trim()
          : completion;
        const isJsonWrapped =
          answer.substring(0, 8) === '"```json' &&
          answer.substring(answer.length - 4) === '```"';
        console.log("Error caused by json wrapped: ", isJsonWrapped);
        if (isJsonWrapped) {
          // If the completion is wrapped in ```json``` then we need to remove it
          answer = answer.slice(8, -4);
          console.log("Answer after removing json wrapping: ", answer);
          return JSON.parse(answer.trim());
        }
        const retryInput = {
          instructions: this.parser.getFormatInstructions(),
          completion,
          error: e,
        };
        if (isLLMChain(this.retryChain)) {
          // @ts-ignore
          const result = await this.retryChain.call(retryInput, callbacks);
          // @ts-ignore
          const newCompletion = result[this.retryChain.outputKey];
          return this.parser.parse(newCompletion, callbacks);
        } else {
          const result = await this.retryChain.invoke(retryInput, {
            callbacks,
          });
          // @ts-ignore
          return result;
        }
      }

      throw e;
    }
  }
  /**
   * Method to get the format instructions for the parser.
   * @returns The format instructions for the parser.
   */
  getFormatInstructions() {
    return this.parser.getFormatInstructions();
  }
}
