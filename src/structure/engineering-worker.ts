import type { Design } from "./design";
import { analyzeTimber, type EngineeringSettings } from "./engineering";

self.onmessage = (event: MessageEvent<{ design: Design; settings: EngineeringSettings }>) => {
  try {
    self.postMessage({ result: analyzeTimber(event.data.design, event.data.settings) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
