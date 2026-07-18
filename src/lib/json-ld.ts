const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TYPE_ATTRIBUTE_RE = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

/** Extract JSON-LD script bodies while accepting valid quoted or unquoted HTML attributes. */
export function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const attributes = match[1] ?? '';
    const typeMatch = attributes.match(TYPE_ATTRIBUTE_RE);
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (type !== 'application/ld+json') continue;
    const body = (match[2] ?? '').trim();
    if (body) blocks.push(body);
  }
  return blocks;
}
