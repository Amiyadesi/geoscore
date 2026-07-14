export function createSseStream(
  cb: (emit: (event: string, data: unknown) => void) => Promise<void>
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (chunk: string) => writer.write(encoder.encode(chunk)).catch(() => {});

  const emit = (event: string, data: unknown) => {
    write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat every 15s — prevents Cloudflare/CDN proxy from closing idle SSE streams
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), 15_000);

  cb(emit)
    .catch((err) => emit('error', { message: (err as Error).message ?? 'Internal error' }))
    .finally(() => {
      clearInterval(heartbeat);
      writer.close().catch(() => {});
    });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
