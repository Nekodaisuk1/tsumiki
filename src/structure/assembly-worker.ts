import { analyzeAssembly } from "./assembly";
import type { Design } from "./design";

self.onmessage = (event: MessageEvent<{ design: Design; order?: string[] }>) => {
  try {
    self.postMessage({ plan: analyzeAssembly(event.data.design, undefined, undefined, event.data.order) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
