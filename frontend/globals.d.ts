/**
 * Cross-file globals the frontend controllers publish on `window` so
 * `index.html` can compose them without a bundler.
 *
 * These declarations exist to catch name typos and to give the shared
 * controllers a single place to gain real types as the frontend is typed.
 * Scratch variables that only one file uses do not belong here.
 */
interface Window {
  GeoScoreI18n?: {
    t?: (key: string, vars?: Record<string, unknown>) => string;
    [key: string]: unknown;
  };
  GeoScoreSitePass?: {
    PAY_URL?: string;
    [key: string]: any;
  };
  GeoScoreAdmin?: {
    api?: string;
    session?: Record<string, unknown> | null;
    [key: string]: any;
  };
  GeoScoreCustomApi?: {
    [key: string]: any;
  };
}
