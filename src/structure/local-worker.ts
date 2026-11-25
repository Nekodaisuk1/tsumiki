import { type LocalSettings, solveLocal } from "./local-fem";

self.onmessage = (event: MessageEvent<LocalSettings>) => {
  try {
    self.postMessage({ result: solveLocal(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
