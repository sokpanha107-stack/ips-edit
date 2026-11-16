/** Which app features are shown, and in what order. Stored in localStorage and shared by the Sidebar, Settings and Command Center. */
export type FeatureId = 'script' | 'voices' | 'voice' | 'video' | 'image' | 'history' | 'command';
export interface FeatureCfg { id: FeatureId; on: boolean }

export const FEATURE_LABEL: Record<FeatureId, string> = {
  script: 'Script Preparation', voices: 'Voice Library', voice: 'Voice Engine', video: 'Video Engine', image: 'Image Engine', history: 'History Project', command: 'Command Center',
};
export const FEATURE_STORE = 'ips-features';
export const DEFAULT_FEATURES: FeatureCfg[] = (['script', 'voices', 'voice', 'video', 'image', 'history', 'command'] as FeatureId[]).map((id) => ({ id, on: true }));

/** Accepts anything from storage: drops unknown ids, de-duplicates, and appends features added in newer versions (switched on). */
export function sanitizeFeatures(raw: unknown): FeatureCfg[] {
  const known = new Set<string>(DEFAULT_FEATURES.map((f) => f.id));
  const out: FeatureCfg[] = [];
  if (Array.isArray(raw)) for (const r of raw) {
    const id = (r as FeatureCfg)?.id;
    if (known.has(id) && !out.some((o) => o.id === id)) out.push({ id, on: (r as FeatureCfg).on !== false });
  }
  for (const d of DEFAULT_FEATURES) if (!out.some((o) => o.id === d.id)) out.push({ ...d });
  return out;
}
export function loadFeatures(): FeatureCfg[] {
  try { return sanitizeFeatures(JSON.parse(window.localStorage.getItem(FEATURE_STORE) ?? 'null')); } catch { return DEFAULT_FEATURES; }
}
export function saveFeatures(f: FeatureCfg[]) { try { window.localStorage.setItem(FEATURE_STORE, JSON.stringify(f)); } catch { /* storage unavailable */ } }
export const isOn = (f: FeatureCfg[], id: FeatureId) => f.find((x) => x.id === id)?.on !== false;
