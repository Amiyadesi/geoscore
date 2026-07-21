/**
 * Language-aware metadata thresholds shared by the technical module and the
 * normalized evidence registry. Character counts are intentionally simple and
 * deterministic; they are a quality signal, not a search-engine promise.
 */

export interface TextLengthRange {
  min: number;
  max: number;
  label: string;
}

export function containsCjk(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(value);
}

export function textLengthRange(value: string, locale?: string | null): TextLengthRange {
  const localeHint = String(locale ?? '').toLowerCase();
  const cjk = containsCjk(value) || /^(?:zh|ja|ko)(?:[-_]|$)/.test(localeHint);
  return cjk
    ? { min: 8, max: 35, label: '8-35' }
    : { min: 30, max: 70, label: '30-70' };
}

export function isTextLengthGood(value: string, locale?: string | null): boolean {
  const range = textLengthRange(value, locale);
  return value.length >= range.min && value.length <= range.max;
}

function normalizedBrandToken(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

/** A root-domain brand title is intentional on many homepages, not a thin title. */
export function isBrandOnlyHomepageTitle(title: string, rootDomain: string): boolean {
  const normalizedTitle = normalizedBrandToken(title);
  const normalizedRoot = normalizedBrandToken(rootDomain);
  const rootLabel = normalizedBrandToken(rootDomain.split('.')[0] ?? '');
  if (!normalizedTitle || !rootLabel) return false;
  return normalizedTitle === rootLabel || normalizedTitle === normalizedRoot;
}

export function descriptionLengthRange(value: string, locale?: string | null): TextLengthRange {
  const localeHint = String(locale ?? '').toLowerCase();
  const cjk = containsCjk(value) || /^(?:zh|ja|ko)(?:[-_]|$)/.test(localeHint);
  return cjk
    ? { min: 24, max: 120, label: '24-120' }
    : { min: 100, max: 170, label: '100-170' };
}

export function isDescriptionLengthGood(value: string, locale?: string | null): boolean {
  const range = descriptionLengthRange(value, locale);
  return value.length >= range.min && value.length <= range.max;
}
