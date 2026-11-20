/** Which app features are shown, and in what order. Stored in localStorage and shared by the Sidebar, Settings and Command Center. */
export type FeatureId = 'script' | 'prompts' | 'documents' | 'voices' | 'music' | 'music-engine' | 'voice' | 'video' | 'image' | 'history' | 'command';
export interface FeatureCfg { id: FeatureId; on: boolean }

export const FEATURE_LABEL: Record<FeatureId, string> = {
  script: 'Script Preparation', prompts: 'Prompt Library', documents: 'Document', voices: 'Voice Library', music: 'Music Library', 'music-engine': 'Music Engine', voice: 'Voice Engine', video: 'Video Engine', image: 'Image Engine', history: 'History Project', command: 'Command Center',
};
export const FEATURE_STORE = 'ips-features';
export const DEFAULT_FEATURES: FeatureCfg[] = (['script', 'prompts', 'documents', 'voices', 'music', 'voice', 'video', 'image', 'music-engine', 'history', 'command'] as FeatureId[]).map((id) => ({ id, on: id !== 'video' }))   // v2.4: the standalone Video Engine is hidden by default (Settings → Features switches it on);

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
  try {
    const f = sanitizeFeatures(JSON.parse(window.localStorage.getItem(FEATURE_STORE) ?? 'null'));
    if (window.localStorage.getItem('ips-features-v24') !== '1') {        // one-time v2.4 migration: hide Video Engine (the user can switch it back on)
      window.localStorage.setItem('ips-features-v24', '1');
      const m = f.map((x) => (x.id === 'video' ? { ...x, on: false } : x)); window.localStorage.setItem(FEATURE_STORE, JSON.stringify(m)); return m;
    }
    return f;
  } catch { return DEFAULT_FEATURES; }
}
export function saveFeatures(f: FeatureCfg[]) { try { window.localStorage.setItem(FEATURE_STORE, JSON.stringify(f)); } catch { /* storage unavailable */ } }
export const isOn = (f: FeatureCfg[], id: FeatureId) => f.find((x) => x.id === id)?.on !== false;
