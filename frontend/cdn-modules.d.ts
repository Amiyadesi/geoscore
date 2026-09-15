/**
 * Ambient declarations for browser modules that are loaded from a CDN at
 * runtime. `frontend/semantic-search.js` imports this one lazily and only when
 * WebGPU is available, so it must never be bundled or fetched eagerly.
 */
declare module 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js' {
  export const env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
  };
  export function pipeline(
    task: string,
    model: string,
    options?: { device?: string; dtype?: string },
  ): Promise<(input: unknown, options?: Record<string, unknown>) => Promise<unknown>>;
}
