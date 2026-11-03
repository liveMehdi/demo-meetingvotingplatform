import { useRef, useState } from "react";
import { CreationAttempt } from "./creation-attempt";

export function useCreationAttempt<T>() {
  const attempt = useRef(new CreationAttempt<T>());
  const [, render] = useState(0);
  return {
    retryInput: attempt.current.retryInput,
    reset() {
      attempt.current.reset();
      render((n) => n + 1);
    },
    async run<R>(input: T, send: (input: T, key: string) => Promise<R>) {
      try {
        return await attempt.current.run(input, send);
      } finally {
        render((n) => n + 1);
      }
    },
  };
}
