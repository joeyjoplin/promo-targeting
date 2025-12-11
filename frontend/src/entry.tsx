// src/entry.tsx
// Entry point used by Vite. It ensures Buffer is defined globally
// before React / Solana wallet code is loaded.

import "./buffer-polyfill";
import "./main";
