import {
  RunnableSequence,
  RunnableLike,
  Runnable,
} from "@langchain/core/runnables";
export declare class test<
  RunInput = any,
  RunOutput = any,
> extends RunnableSequence<RunInput, RunOutput> {
  streamRunnable?: boolean;
  singleAction: boolean;
  static fromRunnables<RunInput = any, RunOutput = any>(
    [first, ...runnables]: [
      RunnableLike<RunInput>,
      ...RunnableLike[],
      RunnableLike<any, RunOutput>,
    ],
    config: {
      singleAction: boolean;
      streamRunnable?: boolean;
      name?: string;
    },
  ): AgentRunnableSequence<RunInput, Exclude<RunOutput, Error>>;
  static isAgentRunnableSequence(x: Runnable): x is AgentRunnableSequence;
}

export class AgentRunnableSequence<
  RunInput = any,
  RunOutput = any,
> extends RunnableSequence<RunInput, RunOutput> {
  streamRunnable?: boolean;
  singleAction: boolean = false;
  constructor() {
    // @ts-ignore
    super(...arguments);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static fromRunnables<RunInput = any, RunOutput = any>(
    [first, ...runnables]: [
      RunnableLike<RunInput>,
      ...RunnableLike[],
      RunnableLike<any, RunOutput>,
    ],
    config: {
      singleAction: boolean;
      streamRunnable?: boolean;
      name?: string;
    },
  ): RunnableSequence<RunInput, Exclude<RunOutput, Error>> {
    const sequence = RunnableSequence.from([first, ...runnables], config.name);
    // sequence.singleAction = config.singleAction;
    // sequence.streamRunnable = config.streamRunnable;
    return sequence;
  }
  static isAgentRunnableSequence(x: Runnable): x is AgentRunnableSequence {
    // @ts-ignore
    return typeof x.singleAction === "boolean";
  }
}
