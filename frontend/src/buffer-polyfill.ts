// src/buffer-polyfill.ts
// Standalone Buffer polyfill that runs before React app bootstraps

import { Buffer } from "buffer";

// Attach Buffer to the global scope *before* any other modules are evaluated
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}
