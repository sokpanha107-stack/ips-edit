'use client';

import { useEffect, useState } from 'react';
import {
  AudioLines, Check, ChevronRight, Film, Gauge, History, LampDesk, Lock, Menu, Mic2, Moon,
  Palette, Play, Radio, Send, Settings2, ShieldCheck, Sun, Upload, WandSparkles, X, type LucideIcon,
} from 'lucide-react';

type Tab = 'voices' | 'video' | 'kh' | 'en' | 'history';
type ThemeMode = 'system' | 'light' | 'dark';
type Language = 'en' | 'kh';
type GpuKey = 'video' | 'kh' | 'en';
type GpuState = { enabled: boolean; connecting: boolean };

type Copy = {
  brandTag: string; ready: string; voiceLibrary: string; videoEngine: string; khEngine: string; enEngine: string; history: string;
  workspace: string; voiceDetail: string; videoDetail: string; khDetail: string; enDetail: string; historyDetail: string;
  packages: string; addPackage: string; uploadSample: string; send: string; preview: string; voiceNote: string;
  private: string; baseImage: string; dropImage: string; imageTypes: string; browse: string; locked: string;
  selectedVoice: string; masterPrompt: string; required: string; batchScripts: string; optional: string; generateVideo: string; generateVoice: string;
  describeScene: string; setDelivery: string; scriptVideo: string; scriptVoice: string; generating: string; keepOpen: string; uploadDrive: string;
  uploaded: string; archived: string; close: string; uploadAfter: string; projects: string; uploadedStatus: string;
  focused: string; noScroll: string; controlRoom: string; commandCenter: string; gpuOnly: string; runpod: string; gpuOn: string; gpuOff: string;
  render: string; khSynthesis: string; enSynthesis: string; performance: string; performanceDetail: string; activeTasks: string; storage: string; vram: string; idle: string; connecting: string; done: string;
  preferences: string; settings: string; apiDisplay: string; apiTitle: string; apiDetail: string; apiKey: string; apiPlaceholder: string; language: string; languageDetail: string; theme: string; themeDetail: string; system: string; light: string; dark: string; eyeCare: string; eyeCareDetail: string; save: string;
};

const english: Copy = {
  brandTag: 'AI production studio', ready: 'All systems ready', voiceLibrary: 'Voice Library', videoEngine: 'Video Engine', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', history: 'History Project', workspace: 'Workspace', voiceDetail: 'Choose a voice package and send it to an engine.', videoDetail: 'One focused workspace for your next scene.', khDetail: 'One focused workspace for your next Khmer voice performance.', enDetail: 'One focused workspace for your next English voice performance.', historyDetail: 'A clean archive of finished work and uploaded outputs.', packages: 'packages', addPackage: 'Add package', uploadSample: 'Upload a voice sample', send: 'Send', preview: 'Preview', voiceNote: 'Voice packages stay in this workspace until you send them to a voice engine.', private: 'Your workspace is private', baseImage: 'Base image', dropImage: 'Drop base character image', imageTypes: 'PNG, JPG · up to 20 MB', browse: 'Browse', locked: 'locked', selectedVoice: 'Voice profile selected', masterPrompt: 'Master Prompt', required: 'Required', batchScripts: 'Batch Scripts', optional: 'Optional', generateVideo: 'Generate Video', generateVoice: 'Generate Voice', describeScene: 'Describe the scene, movement, and mood...', setDelivery: 'Set the delivery, emotion, and pacing...', scriptVideo: 'Scene 01: [camera] — [action] — [mood]\nScene 02: [camera] — [action] — [mood]', scriptVoice: 'Paste your script or multiple lines of dialogue here...', generating: 'Generating', keepOpen: 'Keep this workspace open.', uploadDrive: 'Upload to Google Drive', uploaded: 'Uploaded to Google Drive', archived: 'Your finished file is safely archived.', close: 'Close uploaded result', uploadAfter: 'The upload action appears after generation completes.', projects: 'projects', uploadedStatus: 'Uploaded to Drive', focused: 'Focused workspace', noScroll: 'One screen. One clear creative decision at a time.', controlRoom: 'Control room', commandCenter: 'Command Center', gpuOnly: 'GPU controls only', runpod: 'RunPod compute', gpuOn: 'GPU on', gpuOff: 'GPU off', render: 'Rendering and motion', khSynthesis: 'Khmer voice synthesis', enSynthesis: 'English voice synthesis', performance: 'GPU Performance Monitor', performanceDetail: 'Live RunPod resources and generation activity', activeTasks: 'Active generation tasks', storage: 'Storage', vram: 'VRAM', idle: 'No active tasks', connecting: 'Connecting…', done: 'Done', preferences: 'Studio preferences', settings: 'Settings', apiDisplay: 'API, language, and display', apiTitle: 'RunPod API', apiDetail: 'Connect your generation account', apiKey: 'RunPod API key', apiPlaceholder: 'Enter your API key', language: 'Language', languageDetail: 'Choose your studio language', theme: 'Display theme', themeDetail: 'Auto-sync follows your device', system: 'System', light: 'Light', dark: 'Dark', eyeCare: 'Eye care mode', eyeCareDetail: 'Soften cool screen tones', save: 'Save preferences',
};

const khmer: Copy = {
  brandTag: 'AI production studio', ready: 'ប្រព័ន្ធដំណើរការរួចរាល់', voiceLibrary: 'Voice Library', videoEngine: 'Video Engine', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', history: 'History Project', workspace: 'ផ្ទាំងការងារ', voiceDetail: 'ជ្រើសរើស voice package ហើយផ្ញើទៅ engine ដែលត្រូវការ។', videoDetail: 'ផ្ទាំងការងារសម្រាប់ scene បន្ទាប់របស់អ្នក។', khDetail: 'ផ្ទាំងការងារសម្រាប់ការសំយោគសំឡេង Khmer។', enDetail: 'ផ្ទាំងការងារសម្រាប់ការសំយោគសំឡេង English។', historyDetail: 'បណ្ណសារស្អាតសម្រាប់ project និង output ដែលបាន upload។', packages: 'packages', addPackage: 'បន្ថែម package', uploadSample: 'Upload voice sample', send: 'ផ្ញើ', preview: 'ស្តាប់ Preview', voiceNote: 'Voice package នឹងនៅក្នុង workspace នេះ រហូតដល់អ្នកផ្ញើទៅ voice engine។', private: 'Workspace របស់អ្នកមានភាពឯកជន', baseImage: 'រូបភាពដើម', dropImage: 'ដាក់ base character image', imageTypes: 'PNG, JPG · អតិបរមា 20 MB', browse: 'ជ្រើសរើស', locked: 'បាន lock', selectedVoice: 'បានជ្រើសរើស voice profile', masterPrompt: 'Master Prompt', required: 'ត្រូវការ', batchScripts: 'Batch Scripts', optional: 'ជាជម្រើស', generateVideo: 'Generate Video', generateVoice: 'Generate Voice', describeScene: 'ពិពណ៌នា scene, movement និង mood...', setDelivery: 'កំណត់ delivery, emotion និង pacing...', scriptVideo: 'Scene 01: [camera] — [action] — [mood]\nScene 02: [camera] — [action] — [mood]', scriptVoice: 'ដាក់ script ឬ dialogue ច្រើនបន្ទាត់នៅទីនេះ...', generating: 'កំពុង Generate', keepOpen: 'សូមរក្សា workspace នេះឱ្យបើក។', uploadDrive: 'Upload ទៅ Google Drive', uploaded: 'បាន Upload ទៅ Google Drive', archived: 'File របស់អ្នកត្រូវបានរក្សាទុកដោយសុវត្ថិភាព។', close: 'បិទ uploaded result', uploadAfter: 'ប៊ូតុង upload នឹងបង្ហាញ បន្ទាប់ពី generation រួចរាល់។', projects: 'projects', uploadedStatus: 'បាន Upload ទៅ Drive', focused: 'ផ្ទាំងការងារសំខាន់', noScroll: 'មួយអេក្រង់ សម្រាប់ការសម្រេចចិត្តច្នៃប្រឌិតមួយ។', controlRoom: 'បន្ទប់គ្រប់គ្រង', commandCenter: 'Command Center', gpuOnly: 'គ្រប់គ្រង GPU ប៉ុណ្ណោះ', runpod: 'RunPod compute', gpuOn: 'បើក GPU', gpuOff: 'បិទ GPU', render: 'Rendering និង motion', khSynthesis: 'Khmer voice synthesis', enSynthesis: 'English voice synthesis', performance: 'GPU Performance Monitor', performanceDetail: 'ធនធាន RunPod និងសកម្មភាព generation ផ្ទាល់', activeTasks: 'Generation tasks កំពុងដំណើរការ', storage: 'Storage', vram: 'VRAM', idle: 'គ្មាន task កំពុងដំណើរការ', connecting: 'កំពុងភ្ជាប់…', done: 'រួចរាល់', preferences: 'ចំណូលចិត្ត Studio', settings: 'Settings', apiDisplay: 'API, language និង display', apiTitle: 'RunPod API', apiDetail: 'ភ្ជាប់ generation account របស់អ្នក', apiKey: 'RunPod API key', apiPlaceholder: 'ដាក់ API key របស់អ្នក', language: 'Language', languageDetail: 'ជ្រើសរើសភាសារបស់ Studio', theme: 'Display theme', themeDetail: 'Auto-sync តាម device របស់អ្នក', system: 'System', light: 'Light', dark: 'Dark', eyeCare: 'Eye care mode', eyeCareDetail: 'បន្ថយពន្លឺត្រជាក់លើអេក្រង់', save: 'រក្សាទុកការកំណត់',
};

const navItems = (t: Copy): { id: Tab; label: string; shortLabel: string; icon: LucideIcon }[] => [
  { id: 'voices', label: t.voiceLibrary, shortLabel: 'Voices', icon: Mic2 },
  { id: 'video', label: t.videoEngine, shortLabel: 'Video', icon: Film },
  { id: 'kh', label: t.khEngine, shortLabel: 'KH Voice', icon: AudioLines },
  { id: 'en', label: t.enEngine, shortLabel: 'EN Voice', icon: AudioLines },
  { id: 'history', label: t.history, shortLabel: 'History', icon: History },
];

const voiceProfiles = [
  { name: 'Sophea Warm', type: 'Female · Khmer', initials: 'SW', color: '#b45309', length: '00:24' },
  { name: 'Dara Clear', type: 'Male · Khmer', initials: 'DC', color: '#1e3a5f', length: '00:18' },
  { name: 'Studio Narrator', type: 'Custom · English', initials: 'SN', color: '#6b4f3b', length: '00:31' },
  { name: 'Maly Soft', type: 'Female · Khmer', initials: 'MS', color: '#667f71', length: '00:22' },
];

const historyProjects = [
  { title: 'Golden hour introduction', type: 'Video generation', date: 'Today · 10:42 AM' },
  { title: 'Sophea — welcome narration', type: 'KH Voice generation', date: 'Yesterday · 4:18 PM' },
  { title: 'Studio launch trailer', type: 'EN Voice generation', date: 'Nov 11 · 2:06 PM' },
  { title: 'Character moodboard v1', type: 'Video generation', date: 'Nov 08 · 9:31 AM' },
];

function Toggle({ checked, onChange, label, connecting }: { checked: boolean; onChange: () => void; label: string; connecting?: boolean }) {
  return <button type="button" aria-label={label} aria-pressed={checked} onClick={onChange} className={`toggle ${checked ? 'is-on' : ''} ${connecting ? 'is-connecting' : ''}`}><span /></button>;
}

function Brand({ t }: { t: Copy }) {
  return <div className="brand" aria-label="IPS edit"><div className="brand-mark"><LampDesk size={25} strokeWidth={1.8} /><span>i</span></div><div><strong>IPS <em>edit</em></strong><small>{t.brandTag}</small></div></div>;
}

function SectionHeading({ icon: Icon, eyebrow, title, detail }: { icon: LucideIcon; eyebrow: string; title: string; detail?: string }) {
  return <div className="section-heading"><div className="heading-icon"><Icon size={18} /></div><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{detail && <p>{detail}</p>}</div></div>;
}

function VoiceLibrary({ t, onNotice }: { t: Copy; onNotice: (message: string) => void }) {
  return <section className="screen-card voice-library-screen"><div className="screen-heading"><SectionHeading icon={Mic2} eyebrow={`01 · ${t.voiceLibrary}`} title={t.voiceLibrary} detail={t.voiceDetail} /><span className="capacity">{voiceProfiles.length} / 10 {t.packages}</span></div><div className="voice-row">{voiceProfiles.map((voice) => <article className="voice-card" key={voice.name}><div className="voice-card-head"><div className="voice-avatar" style={{ background: voice.color }}>{voice.initials}</div><span className="voice-type">{voice.type}</span></div><strong>{voice.name}</strong><div className="waveform"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="voice-meta"><span><Play size={11} fill="currentColor" /> {t.preview} · {voice.length}</span><button type="button" onClick={() => onNotice(`${voice.name} ${t.send}.`)}><Send size={13} /> {t.send}</button></div></article>)}<button type="button" className="add-voice" onClick={() => onNotice(t.uploadSample)}><Upload size={19} /><strong>{t.addPackage}</strong><span>{t.uploadSample}</span></button></div><div className="library-note"><ShieldCheck size={15} /><span>{t.voiceNote}</span></div></section>;
}

function EngineWorkspace({ type, t, onNotice }: { type: 'video' | 'kh' | 'en'; t: Copy; onNotice: (message: string) => void }) {
  const isVideo = type === 'video';
  const isKh = type === 'kh';
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [isUploaded, setIsUploaded] = useState(false);
  const title = isVideo ? t.videoEngine : isKh ? t.khEngine : t.enEngine;
  const detail = isVideo ? t.videoDetail : isKh ? t.khDetail : t.enDetail;
  const Icon = isVideo ? Film : AudioLines;
  const generate = () => { setIsProcessing(true); setHasGenerated(false); setIsUploaded(false); window.setTimeout(() => { setIsProcessing(false); setHasGenerated(true); }, 1600); };
  return <section className="screen-card engine-screen"><div className="screen-heading"><SectionHeading icon={Icon} eyebrow={`${isVideo ? '02' : isKh ? '03' : '04'} · ${title}`} title={title} detail={detail} /><span className="status-dot"><span />{t.ready}</span></div>{isVideo ? <div className="upload-box"><Upload size={22} className="upload-icon" /><div><strong>{t.dropImage}</strong><span>{t.imageTypes}</span></div><button type="button" className="text-button"><Upload size={15} /> {t.browse}</button><div className="lock-row"><Lock size={13} /> {t.baseImage} {t.locked}<Toggle checked={true} onChange={() => undefined} label={t.locked} /></div></div> : <div className="voice-source"><div className={`voice-avatar ${isKh ? 'kh-avatar' : 'en-avatar'}`}>{isKh ? 'SW' : 'SN'}</div><div><span>{t.selectedVoice}</span><strong>{isKh ? 'Sophea Warm' : 'Studio Narrator'}</strong></div><ChevronRight size={16} /></div>}<label className="field-label">{t.masterPrompt} <span>{t.required}</span></label><input className="studio-input" placeholder={isVideo ? t.describeScene : t.setDelivery} /><label className="field-label">{t.batchScripts} <span>{t.optional}</span></label><textarea className="studio-textarea" placeholder={isVideo ? t.scriptVideo : t.scriptVoice} />{isProcessing && <div className="processing-state"><span className="processing-spinner" /> {t.generating} {isVideo ? 'video' : 'voice'}… {t.keepOpen}</div>}{!isProcessing && !hasGenerated && !isUploaded && <button type="button" className="primary-button generate-button" onClick={generate}><WandSparkles size={16} /> {isVideo ? t.generateVideo : t.generateVoice}</button>}{!isProcessing && hasGenerated && !isUploaded && <button type="button" className="drive-button" onClick={() => { setIsUploaded(true); onNotice(t.uploaded); }}><Upload size={15} /> {t.uploadDrive}</button>}{!isProcessing && isUploaded && <div className="upload-success"><div><Check size={16} /><strong>{t.uploaded}</strong><span>{t.archived}</span></div><button type="button" className="close-result" onClick={() => setIsUploaded(false)} aria-label={t.close}><X size={17} /></button></div>}{!isProcessing && !hasGenerated && !isUploaded && <p className="workspace-helper"><ShieldCheck size={14} /> {t.uploadAfter}</p>}</section>;
}

function HistoryProject({ t }: { t: Copy }) {
  return <section className="screen-card history-screen"><div className="screen-heading"><SectionHeading icon={History} eyebrow={`05 · ${t.history}`} title={t.history} detail={t.historyDetail} /><span className="capacity">{historyProjects.length} {t.projects}</span></div><div className="history-list">{historyProjects.map((project, index) => <article className="history-item" key={project.title}><div className="history-index">0{index + 1}</div><div className="history-info"><strong>{project.title}</strong><span>{project.type} · {project.date}</span></div><span className="history-status"><Check size={13} /> {t.uploadedStatus}</span><ChevronRight size={17} className="history-arrow" /></article>)}</div></section>;
}

function CommandCenter({ open, onClose, t, gpus, setGpu }: { open: boolean; onClose: () => void; t: Copy; gpus: Record<GpuKey, GpuState>; setGpu: (key: GpuKey) => void }) {
  if (!open) return null;
  const controls: [GpuKey, string, string][] = [['video', t.videoEngine, t.render], ['kh', t.khEngine, t.khSynthesis], ['en', t.enEngine, t.enSynthesis]];
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">{t.controlRoom}</span><h2>{t.commandCenter}</h2><p>{t.gpuOnly}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div><div className="drawer-content"><div className="gpu-controls">{controls.map(([key, label, detail]) => <div className="gpu-control" key={key}><div><strong>{label}</strong><span>{detail}</span></div><div className="gpu-state"><span className={gpus[key].enabled ? 'ready-indicator' : gpus[key].connecting ? 'connecting-indicator' : 'off-indicator'} />{gpus[key].connecting ? t.connecting : gpus[key].enabled ? t.ready : t.gpuOff}<Toggle checked={gpus[key].enabled} connecting={gpus[key].connecting} onChange={() => setGpu(key)} label={`${label} ${gpus[key].enabled ? t.gpuOff : t.gpuOn}`} /></div></div>)}</div><div className="performance-panel"><div className="performance-heading"><div><span className="eyebrow">{t.runpod}</span><h3>{t.performance}</h3><p>{t.performanceDetail}</p></div><Gauge size={19} /></div><div className="gpu-monitor-grid"><article><span>RTX 4090</span><strong>24 GB</strong><small>{t.vram}</small><div className="usage-bar"><i style={{ width: '68%' }} /></div></article><article><span>Storage disk</span><strong>186 GB</strong><small>{t.storage}</small><div className="usage-bar"><i style={{ width: '42%' }} /></div></article><article><span>{t.activeTasks}</span><strong>02</strong><small>{t.videoEngine} · {t.khEngine}</small><div className="task-pips"><i /><i /><i /></div></article></div><div className="monitor-status"><span className="ready-indicator" />{t.ready} · RunPod port connected</div><div className="monitor-idle"><span>{t.idle}</span><span>Last sync · 4 sec ago</span></div></div></div><button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.done}</button></aside></div>;
}

function SettingsDrawer({ open, onClose, t, language, setLanguage, themeMode, setThemeMode, eyeCare, setEyeCare }: { open: boolean; onClose: () => void; t: Copy; language: Language; setLanguage: (language: Language) => void; themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void; eyeCare: boolean; setEyeCare: () => void }) {
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">{t.preferences}</span><h2>{t.settings}</h2><p>{t.apiDisplay}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div><div className="drawer-content"><div className="settings-block"><div className="settings-title"><Lock size={17} /><div><strong>{t.apiTitle}</strong><span>{t.apiDetail}</span></div></div><label className="field-label">{t.apiKey}</label><input className="studio-input" type="password" placeholder={t.apiPlaceholder} /></div><div className="settings-block"><div className="settings-title"><Palette size={17} /><div><strong>{t.language}</strong><span>{t.languageDetail}</span></div></div><div className="segmented"><button type="button" className={language === 'kh' ? 'active' : ''} onClick={() => setLanguage('kh')}>ភាសាខ្មែរ <span>លាយអង់គ្លេស</span></button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English <span>100%</span></button></div></div><div className="settings-block"><div className="settings-title"><Sun size={17} /><div><strong>{t.theme}</strong><span>{t.themeDetail}</span></div></div><div className="theme-options">{[['system', t.system, Radio], ['light', t.light, Sun], ['dark', t.dark, Moon]].map(([key, label, Icon]) => { const ThemeIcon = Icon as LucideIcon; return <button type="button" key={key as string} className={themeMode === key ? 'active' : ''} onClick={() => setThemeMode(key as ThemeMode)}><ThemeIcon size={15} />{label as string}</button>; })}</div><div className="setting-row compact"><div><strong>{t.eyeCare}</strong><span>{t.eyeCareDetail}</span></div><Toggle checked={eyeCare} onChange={setEyeCare} label={t.eyeCare} /></div></div></div><button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.save}</button></aside></div>;
}

export default function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const t = language === 'kh' ? khmer : english;
  const [activeTab, setActiveTab] = useState<Tab>('voices');
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [eyeCare, setEyeCare] = useState(false);
  const [gpus, setGpus] = useState<Record<GpuKey, GpuState>>({ video: { enabled: true, connecting: false }, kh: { enabled: true, connecting: false }, en: { enabled: false, connecting: false } });
  const [notice, setNotice] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = themeMode; document.documentElement.classList.toggle('eye-care', eyeCare); }, [themeMode, eyeCare]);
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined); }, []);
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3200); };
  const setGpu = (key: GpuKey) => { setGpus((current) => { const gpu = current[key]; if (gpu.enabled) return { ...current, [key]: { enabled: false, connecting: false } }; return { ...current, [key]: { enabled: false, connecting: true } }; }); if (!gpus[key].enabled) window.setTimeout(() => setGpus((current) => ({ ...current, [key]: { enabled: true, connecting: false } })), 1300); };
  const renderScreen = () => { if (activeTab === 'voices') return <VoiceLibrary t={t} onNotice={showNotice} />; if (activeTab === 'video') return <EngineWorkspace type="video" t={t} onNotice={showNotice} />; if (activeTab === 'kh') return <EngineWorkspace type="kh" t={t} onNotice={showNotice} />; if (activeTab === 'en') return <EngineWorkspace type="en" t={t} onNotice={showNotice} />; return <HistoryProject t={t} />; };
  const items = navItems(t);

  return <main className="app-shell"><header className="topbar"><Brand t={t} /><div className="topbar-actions"><div className="live-status"><span />{t.ready}</div><button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label={t.settings}><Settings2 size={19} /></button><button type="button" className="menu-button" onClick={() => setCommandOpen(true)} aria-label={t.commandCenter}><Menu size={22} /><span>{t.commandCenter}</span></button></div></header><div className="app-body"><nav className="sidebar"><div className="sidebar-label">{t.workspace}</div>{items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={activeTab === id ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab(id)}><Icon size={18} /><span>{label}</span>{activeTab === id && <ChevronRight size={14} className="nav-arrow" />}</button>)}<div className="sidebar-spacer" /><div className="sidebar-foot"><div className="mini-pulse"><span /><div><strong>{t.ready}</strong><small>RunPod · 2 GPUs online</small></div></div><button type="button" className="nav-item" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /><span>{t.settings}</span></button></div></nav><div className="workspace">{notice && <div className="notice"><Check size={16} />{notice}</div>}{renderScreen()}</div></div><nav className="bottom-nav">{items.map(({ id, shortLabel, icon: Icon }) => <button type="button" key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}><Icon size={19} /><span>{shortLabel}</span></button>)}</nav><CommandCenter open={commandOpen} onClose={() => setCommandOpen(false)} t={t} gpus={gpus} setGpu={setGpu} /><SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} t={t} language={language} setLanguage={setLanguage} themeMode={themeMode} setThemeMode={setThemeMode} eyeCare={eyeCare} setEyeCare={() => setEyeCare((value) => !value)} /></main>;
}
