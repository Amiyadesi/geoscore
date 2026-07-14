export function extractJsonObject(text: string): Record<string, unknown> | null {
  const value = extractJsonValue(text, '{', '}');
  return isRecord(value) ? value : null;
}

export function extractJsonArray(text: string): unknown[] | null {
  const value = extractJsonValue(text, '[', ']');
  return Array.isArray(value) ? value : null;
}

function cleanAndParseJson(jsonStr: string): unknown {
  try {
    return JSON.parse(jsonStr);
  } catch {
    // If standard JSON.parse fails, perform light cleanup and retry:
    // 1. Remove trailing commas in arrays/objects (extremely common in LLM responses)
    // 2. Remove comments (// or /* */) if the model injected comments
    let cleaned = jsonStr
      .replace(/,\s*([\]}])/g, '$1') // trailing commas before closing brackets/braces
      .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1') // JS-style comments
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Last-ditch attempt: balance braces if it got truncated
      return null;
    }
  }
}

function extractJsonValue(text: string, open: '{' | '[', close: '}' | ']'): unknown | null {
  // Pre-clean markdown fences (e.g. ```json ... ```) to help locate the correct block start
  let trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```[a-zA-Z0-9]*\s*/, '').replace(/\s*```$/, '');
  }

  const start = trimmed.indexOf(open);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = inString;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        const parsed = cleanAndParseJson(trimmed.slice(start, i + 1));
        if (parsed !== null) return parsed;
      }
    }
  }

  // Fallback: if we didn't find balanced braces due to truncation, try to parse what we can
  try {
    const slice = trimmed.slice(start);
    // Find last matching closing character we can get
    const lastClose = slice.lastIndexOf(close);
    if (lastClose > 0) {
      const parsed = cleanAndParseJson(slice.slice(0, lastClose + 1));
      if (parsed !== null) return parsed;
    }
  } catch { /* no-op */ }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
