export const CF_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CF_FAST_CHAT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
/**
 * Compatibility label for the admin diagnostics. Runtime calls use
 * `API_MODEL` from the Worker environment so the generic endpoint is not
 * coupled to a particular vendor or model.
 */
export const API_CHAT_MODEL = 'configured';
export const GROQ_CHAT_MODEL = 'llama-3.1-8b-instant';
export const OPENROUTER_CHAT_MODEL = 'openrouter/free';
