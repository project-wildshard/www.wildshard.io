import { markedFetch } from './wildshard-agent-requests.mjs';

// This operator preload is scoped to the workflow step running the upload.
globalThis.fetch = markedFetch(globalThis.fetch);
