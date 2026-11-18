'use client';

import { AiAssistant } from '@/components/ai-assistant';
import { AboutPanel } from '@/components/about-panel';
import { podPowerOff, podPowerOn } from '@/lib/client/pod';
import { setBatchProgress, useBatchProgress } from '@/lib/client/progress';
import { useEffect, useRef, useState } from 'react';
import { RefBar, OptionsPanel, useEngineConfig, cropToAspect, type EngineOpts, type RefImage } from '@/components/engine-kit';
import { AudioFolderPicker, AudioReport, readAudioUrl, videoCopy, type AudioItem } from '@/components/audio-folder';
import { ScriptPrepScreen } from '@/components/script-tools';
import { FeatureSettings } from '@/components/feature-settings';
import { DEFAULT_FEATURES, isOn, loadFeatures, saveFeatures, FEATURE_LABEL, type FeatureCfg, type FeatureId } from '@/lib/client/features';
import { TimelineEditor, type TimelineHandle } from '@/components/timeline-editor';
import { ImageEngine } from '@/components/image-engine';
import { PromptLibrary } from '@/components/prompt-library';
import { CommandCenter } from '@/components/command-center';
import { useHeartbeat } from '@/lib/client/heartbeat';
import { addVoice, blobToDataUrl, deleteVoices as dbDeleteVoices, fmtLen, getVoiceBlob, listVoices, type VoiceMeta } from '@/lib/client/voiceStore';
import { api, isFinished, splitScenes, type JobView, type VaultService } from '@/lib/client/api';
import { AccountPanel } from '@/components/account-panel';
import { ApiKeyVault } from '@/components/api-key-vault';
import { DocumentManager } from '@/components/document-manager';
import {
  AudioLines, Check, ChevronDown, Cloud, Library, Square, Clapperboard, Image as ImageIcon, ChevronRight, Eye, EyeOff, Film, Gauge, History, LampDesk, Lock, Menu, Mic2, Moon,
  Folder, NotebookPen, Palette, Play, Radio, Send, Settings2, ShieldCheck, Sun, Trash2, Upload, WandSparkles, X, type LucideIcon, BookOpen,
} from 'lucide-react';

type Tab = 'script' | 'prompts' | 'documents' | 'voices' | 'kh' | 'video' | 'image' | 'en' | 'timeline' | 'history';
const TAB_FEATURE: Partial<Record<Tab, FeatureId>> = { script: 'script', prompts: 'prompts', documents: 'documents', voices: 'voices', kh: 'voice', en: 'voice', video: 'video', image: 'image', history: 'history' };
type ThemeMode = 'system' | 'light' | 'dark';
type Language = 'en' | 'kh';

type Copy = {
  brandTag: string; ready: string; voiceLibrary: string; videoEngine: string; khEngine: string; enEngine: string; history: string;
  workspace: string; voiceDetail: string; videoDetail: string; khDetail: string; enDetail: string; historyDetail: string;
  packages: string; addPackage: string; uploadSample: string; voiceAdded: string; noSample: string; send: string; preview: string; voiceNote: string;
  private: string; baseImage: string; dropImage: string; imageTypes: string; browse: string; locked: string;
  selectedVoice: string; masterPrompt: string; required: string; batchScripts: string; optional: string; generateVideo: string; generateVoice: string;
  describeScene: string; setDelivery: string; scriptVideo: string; scriptVoice: string; generating: string; keepOpen: string; uploadDrive: string;
  uploaded: string; archived: string; close: string; uploadAfter: string; projects: string; uploadedStatus: string;
  focused: string; noScroll: string; controlRoom: string; commandCenter: string; gpuOnly: string; runpod: string; gpuOn: string; gpuOff: string;
  render: string; khSynthesis: string; enSynthesis: string; performance: string; performanceDetail: string; activeTasks: string; storage: string; vram: string; idle: string; connecting: string; done: string;
  preferences: string; settings: string; apiDisplay: string; apiTitle: string; apiDetail: string; apiKey: string; apiPlaceholder: string; language: string; languageDetail: string; theme: string; themeDetail: string; system: string; light: string; dark: string; eyeCare: string; eyeCareDetail: string; save: string;
  sendTo: string; sentTo: string; assigned: string;
  select: string; cancel: string; selectAll: string; selectedCount: string; deleteVoices: string; confirmDelete: string; deletedVoices: string; emptyLibrary: string; unlocked: string; change: string; imageError: string; imageReady: string; tagline: string;
  folderName: string; folderPlaceholder: string; sceneCount: string; scenesWord: string; scriptHas: string; butSet: string; verified: string; needFolder: string; needCount: string; needPrompt: string; needImage: string; noScript: string; detected: string;
};

const english: Copy = {
  brandTag: 'AI production studio', ready: 'All systems ready', voiceLibrary: 'Voice Library', videoEngine: 'Video Engine', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', history: 'History Project', workspace: 'Workspace', voiceDetail: 'Choose a voice package and send it to an engine.', videoDetail: 'One focused workspace for your next scene.', khDetail: 'One focused workspace for your next Khmer voice performance.', enDetail: 'One focused workspace for your next English voice performance.', historyDetail: 'A clean archive of finished work and uploaded outputs.', packages: 'packages', addPackage: 'Add package', uploadSample: 'Upload a voice sample (mp3 / wav / m4a, under 3 MB)', voiceAdded: 'Voice added', noSample: 'Sample not found', send: 'Send', preview: 'Preview', voiceNote: 'Voice samples are real audio files stored on this device. They are sent to the Voice Engine only when you generate.', private: 'Your workspace is private', baseImage: 'Base image', dropImage: 'Drop base character image', imageTypes: 'PNG, JPG · up to 20 MB', browse: 'Browse', locked: 'locked', selectedVoice: 'Voice profile selected', masterPrompt: 'Master Prompt', required: 'Required', batchScripts: 'Batch Scripts', optional: 'Optional', generateVideo: 'Generate Video', generateVoice: 'Generate Voice', describeScene: 'Describe the scene, movement, and mood...', setDelivery: 'Set the delivery, emotion, and pacing...', scriptVideo: 'Scene 01: [camera] — [action] — [mood]\nScene 02: [camera] — [action] — [mood]', scriptVoice: 'Paste your script or multiple lines of dialogue here...', generating: 'Generating', keepOpen: 'Keep this workspace open.', uploadDrive: 'Upload to Google Drive', uploaded: 'Uploaded to Google Drive', archived: 'Your finished file is safely archived.', close: 'Close uploaded result', uploadAfter: 'The upload action appears after generation completes.', projects: 'projects', uploadedStatus: 'Uploaded to Drive', focused: 'Focused workspace', noScroll: 'One screen. One clear creative decision at a time.', controlRoom: 'Control room', commandCenter: 'Command Center', gpuOnly: 'GPU controls only', runpod: 'RunPod compute', gpuOn: 'GPU on', gpuOff: 'GPU off', render: 'Rendering and motion', khSynthesis: 'Khmer voice synthesis', enSynthesis: 'English voice synthesis', performance: 'GPU Performance Monitor', performanceDetail: 'Live RunPod resources and generation activity', activeTasks: 'Active generation tasks', storage: 'Storage', vram: 'VRAM', idle: 'No active tasks', connecting: 'Connecting…', done: 'Done', preferences: 'Studio preferences', settings: 'Settings', apiDisplay: 'API, language, and display', apiTitle: 'Access key', apiDetail: 'Connect to your studio backend', apiKey: 'Access key', apiPlaceholder: 'Enter your access key', language: 'Language', languageDetail: 'Choose your studio language', theme: 'Display theme', themeDetail: 'Auto-sync follows your device', system: 'System', light: 'Light', dark: 'Dark', eyeCare: 'Eye care mode', eyeCareDetail: 'Soften cool screen tones', save: 'Save preferences', sendTo: 'Send to', sentTo: 'Assigned to', assigned: 'Assigned', select: 'Select', cancel: 'Cancel', selectAll: 'Select all', selectedCount: 'selected', deleteVoices: 'Delete', confirmDelete: 'Delete the selected voices?', deletedVoices: 'Voices deleted', emptyLibrary: 'No voice packages yet.', unlocked: 'unlocked', change: 'Change', imageError: 'Use a PNG or JPG image up to 20 MB.', imageReady: 'Base image added', tagline: 'AI Production Studio', folderName: 'Folder name', folderPlaceholder: 'e.g. Episode 01', sceneCount: 'Scenes', scenesWord: 'scenes', scriptHas: 'Script has', butSet: 'but you set', verified: 'Verified — ready to generate', needFolder: 'Enter a folder name.', needCount: 'Enter the number of scenes.', needPrompt: 'Write the Master Prompt.', needImage: 'Add the base image first.', noScript: 'No script — one run from the Master Prompt.', detected: 'detected in script',
};

const khmer: Copy = {
  brandTag: 'AI production studio', ready: 'ប្រព័ន្ធដំណើរការរួចរាល់', voiceLibrary: 'Voice Library', videoEngine: 'Video Engine', khEngine: 'KH Voice Engine', enEngine: 'EN Voice Engine', history: 'History Project', workspace: 'ផ្ទាំងការងារ', voiceDetail: 'ជ្រើសរើស voice package ហើយផ្ញើទៅ engine ដែលត្រូវការ។', videoDetail: 'ផ្ទាំងការងារសម្រាប់ scene បន្ទាប់របស់អ្នក។', khDetail: 'ផ្ទាំងការងារសម្រាប់ការសំយោគសំឡេង Khmer។', enDetail: 'ផ្ទាំងការងារសម្រាប់ការសំយោគសំឡេង English។', historyDetail: 'បណ្ណសារស្អាតសម្រាប់ project និង output ដែលបាន upload។', packages: 'packages', addPackage: 'បន្ថែម package', uploadSample: 'Upload voice sample (mp3 / wav / m4a, ក្រោម 3 MB)', voiceAdded: 'បានបន្ថែមសំឡេង', noSample: 'រកមិនឃើញ sample', send: 'ផ្ញើ', preview: 'ស្តាប់ Preview', voiceNote: 'Voice sample ជាឯកសារសំឡេងពិត រក្សាទុកក្នុងឧបករណ៍នេះ ហើយផ្ញើទៅ Voice Engine តែពេលអ្នកចុច Generate ប៉ុណ្ណោះ។', private: 'Workspace របស់អ្នកមានភាពឯកជន', baseImage: 'រូបភាពដើម', dropImage: 'ដាក់ base character image', imageTypes: 'PNG, JPG · អតិបរមា 20 MB', browse: 'ជ្រើសរើស', locked: 'បាន lock', selectedVoice: 'បានជ្រើសរើស voice profile', masterPrompt: 'Master Prompt', required: 'ត្រូវការ', batchScripts: 'Batch Scripts', optional: 'ជាជម្រើស', generateVideo: 'Generate Video', generateVoice: 'Generate Voice', describeScene: 'ពិពណ៌នា scene, movement និង mood...', setDelivery: 'កំណត់ delivery, emotion និង pacing...', scriptVideo: 'Scene 01: [camera] — [action] — [mood]\nScene 02: [camera] — [action] — [mood]', scriptVoice: 'ដាក់ script ឬ dialogue ច្រើនបន្ទាត់នៅទីនេះ...', generating: 'កំពុង Generate', keepOpen: 'សូមរក្សា workspace នេះឱ្យបើក។', uploadDrive: 'Upload ទៅ Google Drive', uploaded: 'បាន Upload ទៅ Google Drive', archived: 'File របស់អ្នកត្រូវបានរក្សាទុកដោយសុវត្ថិភាព។', close: 'បិទ uploaded result', uploadAfter: 'ប៊ូតុង upload នឹងបង្ហាញ បន្ទាប់ពី generation រួចរាល់។', projects: 'projects', uploadedStatus: 'បាន Upload ទៅ Drive', focused: 'ផ្ទាំងការងារសំខាន់', noScroll: 'មួយអេក្រង់ សម្រាប់ការសម្រេចចិត្តច្នៃប្រឌិតមួយ។', controlRoom: 'បន្ទប់គ្រប់គ្រង', commandCenter: 'Command Center', gpuOnly: 'គ្រប់គ្រង GPU ប៉ុណ្ណោះ', runpod: 'RunPod compute', gpuOn: 'បើក GPU', gpuOff: 'បិទ GPU', render: 'Rendering និង motion', khSynthesis: 'Khmer voice synthesis', enSynthesis: 'English voice synthesis', performance: 'GPU Performance Monitor', performanceDetail: 'ធនធាន RunPod និងសកម្មភាព generation ផ្ទាល់', activeTasks: 'Generation tasks កំពុងដំណើរការ', storage: 'Storage', vram: 'VRAM', idle: 'គ្មាន task កំពុងដំណើរការ', connecting: 'កំពុងភ្ជាប់…', done: 'រួចរាល់', preferences: 'ចំណូលចិត្ត Studio', settings: 'ការកំណត់', apiDisplay: '', apiTitle: 'Access key', apiDetail: '', apiKey: 'Access key', apiPlaceholder: 'ដាក់ access key របស់អ្នក', language: 'ភាសា', languageDetail: '', theme: 'រចនាបថបង្ហាញ', themeDetail: '', system: 'តាមប្រព័ន្ធ', light: 'ភ្លឺ', dark: 'ងងឹត', eyeCare: 'ម៉ូដការពារភ្នែក', eyeCareDetail: '', save: 'រក្សាទុកការកំណត់', sendTo: 'ផ្ញើទៅ', sentTo: 'បានផ្ញើទៅ', assigned: 'បានផ្ញើ', select: 'ជ្រើសរើស', cancel: 'បោះបង់', selectAll: 'ជ្រើសរើសទាំងអស់', selectedCount: 'បានជ្រើសរើស', deleteVoices: 'លុប', confirmDelete: 'លុប voice ដែលបានជ្រើសរើស?', deletedVoices: 'បានលុប voice រួចរាល់', emptyLibrary: 'មិនទាន់មាន voice package ទេ។', unlocked: 'មិនទាន់ lock', change: 'ប្តូរ', imageError: 'សូមប្រើរូប PNG ឬ JPG ដែលធំមិនលើស 20 MB។', imageReady: 'បានបន្ថែមរូបភាពដើម', tagline: 'AI Production Studio', folderName: 'ឈ្មោះ folder', folderPlaceholder: 'ឧ. Episode 01', sceneCount: 'ចំនួន scene', scenesWord: 'scenes', scriptHas: 'Script មាន', butSet: 'ប៉ុន្តែអ្នកកំណត់', verified: 'ផ្ទៀងផ្ទាត់រួច — ត្រៀមផលិត', needFolder: 'សូមដាក់ឈ្មោះ folder។', needCount: 'សូមដាក់ចំនួន scene។', needPrompt: 'សូមសរសេរ Master Prompt។', needImage: 'សូមដាក់រូបភាពដើមសិន។', noScript: 'គ្មាន script — ផលិតពី Master Prompt តែមួយ។', detected: 'រកឃើញក្នុង script',
};

const navItems = (t: Copy): { id: Tab; label: string; shortLabel: string; icon: LucideIcon }[] => [
  { id: 'script', label: 'Script Preparation', shortLabel: 'Script', icon: NotebookPen },
  { id: 'voices', label: t.voiceLibrary, shortLabel: 'Voices', icon: Mic2 },
  { id: 'kh', label: t.khEngine, shortLabel: 'KH Voice', icon: AudioLines },
  { id: 'video', label: t.videoEngine, shortLabel: 'Video', icon: Film },
  { id: 'en', label: t.enEngine, shortLabel: 'EN Voice', icon: Radio },
  { id: 'timeline', label: 'Timeline Editor', shortLabel: 'Timeline', icon: Clapperboard },
  { id: 'history', label: t.history, shortLabel: 'History', icon: History },
];

type Voice = { id: string; name: string; type: string; initials: string; color: string; length: string };
const VOICE_COLORS = ['#b45309', '#1e3a5f', '#6b4f3b', '#667f71', '#7c3a5c', '#3d5a80'];
const toVoice = (m: VoiceMeta, i: number): Voice => ({ id: m.id, name: m.name, type: m.type, initials: m.name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || 'V', color: VOICE_COLORS[i % VOICE_COLORS.length], length: fmtLen(m.seconds) });

function BatchBanner() {
  const p = useBatchProgress();
  if (!p) return null;
  const cur = Math.min(p.total, p.done + 1);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return <div className="batch-banner" role="status" aria-live="polite"><span>{`Processing ${p.label} Scene ${cur}/${p.total}…`}</span><div className="batch-track"><i style={{ width: `${pct}%` }} /></div></div>;
}

function Toggle({ checked, onChange, label, connecting }: { checked: boolean; onChange: () => void; label: string; connecting?: boolean }) {
  return <button type="button" aria-label={label} aria-pressed={checked} onClick={onChange} className={`toggle ${checked ? 'is-on' : ''} ${connecting ? 'is-connecting' : ''}`}><span /></button>;
}

function Brand({ t }: { t: Copy }) {
  return <div className="brand" aria-label="Atom Edit"><div className="brand-mark"><LampDesk size={25} strokeWidth={1.8} /><span>i</span></div><div><strong>Atom <em>Edit</em></strong><small>{t.brandTag}</small></div></div>;
}

function SectionHeading({ icon: Icon, eyebrow }: { icon: LucideIcon; eyebrow: string; title?: string; detail?: string }) {
  return <div className="section-heading"><div className="heading-icon"><Icon size={18} /></div><div className="heading-only"><span className="eyebrow">{eyebrow}</span></div></div>;
}

type Target = 'kh' | 'en';

function VoiceLibrary({ t, voices, assigned, onSend, onDelete, onAdd, onNotice }: { t: Copy; voices: Voice[]; assigned: Record<Target, string>; onSend: (voice: string, target: Target) => void; onDelete: (names: string[]) => void; onAdd: (file: File, kind: string) => void; onNotice: (message: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [langKind, setLangKind] = useState('Khmer');
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const play = async (v: Voice) => { audioRef.current?.pause(); if (playing === v.id) { setPlaying(null); return; } const blob = await getVoiceBlob(v.id); if (!blob) { onNotice(t.noSample); return; } const a = new Audio(URL.createObjectURL(blob)); audioRef.current = a; a.onended = () => setPlaying(null); setPlaying(v.id); a.play().catch(() => setPlaying(null)); };
  useEffect(() => () => audioRef.current?.pause(), []);
  const [openVoice, setOpenVoice] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const targets: { id: Target; label: string }[] = [{ id: 'kh', label: t.khEngine }, { id: 'en', label: t.enEngine }];
  const stopSelecting = () => { setSelecting(false); setPicked([]); setConfirming(false); };
  const startSelecting = () => { setOpenVoice(null); setSelecting(true); };
  const toggle = (name: string) => { setConfirming(false); setPicked((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]); };
  const allPicked = voices.length > 0 && picked.length === voices.length;
  const remove = () => { onDelete(picked); stopSelecting(); };
  return <section className="screen-card voice-library-screen"><div className="screen-heading"><SectionHeading icon={Mic2} eyebrow={`01 · ${t.voiceLibrary}`} title={t.voiceLibrary} detail={t.voiceDetail} /><div className="library-tools"><span className="capacity">{voices.length} / 10 {t.packages}</span><button type="button" className={`select-toggle ${selecting ? 'active' : ''}`} onClick={selecting ? stopSelecting : startSelecting}>{selecting ? <X size={14} /> : <Check size={14} />} {selecting ? t.cancel : t.select}</button></div></div>{selecting && <div className="select-bar"><button type="button" className="select-all" onClick={() => { setConfirming(false); setPicked(allPicked ? [] : voices.map((voice) => voice.name)); }}><span className={`check-box ${allPicked ? 'checked' : ''}`}>{allPicked && <Check size={12} />}</span>{t.selectAll}</button><span className="select-count">{picked.length} {t.selectedCount}</span>{confirming ? <div className="confirm-delete"><span>{t.confirmDelete}</span><button type="button" className="danger" onClick={remove}><Trash2 size={14} /> {t.deleteVoices} ({picked.length})</button><button type="button" onClick={() => setConfirming(false)}>{t.cancel}</button></div> : <button type="button" className="trash-button" disabled={picked.length === 0} onClick={() => setConfirming(true)} aria-label={t.deleteVoices}><Trash2 size={16} /></button>}</div>}<div className="voice-list">{voices.length === 0 && <p className="library-empty">{t.emptyLibrary}</p>}{voices.map((voice) => { const isOpen = openVoice === voice.name; const isPicked = picked.includes(voice.name); const sentTo = targets.filter((target) => assigned[target.id] === voice.name); return <article className={`voice-card ${isOpen ? 'is-open' : ''} ${isPicked ? 'is-picked' : ''}`} key={voice.id} onClick={selecting ? () => toggle(voice.name) : undefined}><div className="voice-card-main">{selecting && <span className={`check-box ${isPicked ? 'checked' : ''}`} role="checkbox" aria-checked={isPicked} aria-label={voice.name}>{isPicked && <Check size={12} />}</span>}<div className="voice-avatar" style={{ background: voice.color }}>{voice.initials}</div><div className="voice-info"><strong>{voice.name}</strong><span className="voice-type">{voice.type}</span></div><div className="waveform"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><button type="button" className="voice-length" aria-label="Play sample" onClick={(e) => { e.stopPropagation(); void play(voice); }}>{playing === voice.id ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />} {voice.length}</button>{sentTo.length > 0 && <span className="voice-assigned"><Check size={11} /> {sentTo.map((target) => target.id.toUpperCase()).join(' · ')}</span>}{!selecting && <button type="button" className="send-button" aria-expanded={isOpen} aria-label={`${t.send} ${voice.name}`} onClick={() => setOpenVoice(isOpen ? null : voice.name)}><Send size={14} /><span>{t.send}</span></button>}</div>{isOpen && !selecting && <div className="send-choices"><span>{t.sendTo}</span>{targets.map((target) => <button type="button" key={target.id} className={assigned[target.id] === voice.name ? 'active' : ''} onClick={() => { onSend(voice.name, target.id); setOpenVoice(null); }}><AudioLines size={13} /> {target.label}</button>)}</div>}</article>; })}{!selecting && <><input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAdd(f, langKind); }} /><div className="lang-pick" role="group" aria-label="Language">{['Khmer', 'English'].map((k) => <button type="button" key={k} className={langKind === k ? 'active' : ''} onClick={() => setLangKind(k)}>{k}</button>)}</div><button type="button" className="add-voice" onClick={() => fileRef.current?.click()}><Upload size={19} /><div><strong>{t.addPackage}</strong><span>{t.uploadSample}</span></div></button></>}</div><div className="library-note"><ShieldCheck size={15} /><span>{t.voiceNote}</span></div></section>;
}

type BaseImage = RefImage | null;


function LogoMark({ className, size = 132 }: { className?: string; size?: number }) {
  const shape = 'M13.5 .5H28.5A13 13 0 0 1 41.5 13.5V28.5A13 13 0 0 1 28.5 41.5H4.5A4 4 0 0 1 .5 37.5V13.5A13 13 0 0 1 13.5 .5Z';
  return <svg className={className} viewBox="0 0 45 45" width={size} height={size} role="img" aria-label="Atom Edit"><defs><linearGradient id="ips-logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e2a047" /><stop offset="1" stopColor="#d97706" /></linearGradient></defs><path transform="translate(3 3)" fill="var(--ink)" d={shape} /><path fill="url(#ips-logo-g)" stroke="var(--ink)" strokeWidth="1" d={shape} /><g transform="translate(8.5 8.5) scale(1.0416667)" fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 5-3 3 2 7 8-8-7-2Z" /><path d="m14 5-3 3-3-3 3-3 3 3Z" /><path d="M9.5 6.5 4 12l3 6" /><path d="M3 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H3Z" /></g><path fill="var(--ink)" d="M8.6 25.4 11.9 23.6V31.1Q11.9 31.6 12.7 31.6H13.5V32.8H7.6V31.6H8.4Q9.2 31.6 9.2 31.1V25.7Z" /></svg>;
}

function Splash({ leaving, onSkip, t }: { leaving: boolean; onSkip: () => void; t: Copy }) {
  return <div className={`splash ${leaving ? 'is-leaving' : ''}`} onClick={onSkip} role="presentation"><div className="splash-inner"><LogoMark className="splash-logo" /><h1>Atom <em>Edit</em></h1><p>{t.tagline}</p><div className="splash-bar"><i /></div></div></div>;
}

type JobDraft = { folder: string; count: string; prompt: string; script: string; audio: AudioItem[] };
type EngineKey = 'video' | 'kh' | 'en';
const emptyDraft: JobDraft = { folder: '', count: '', prompt: '', script: '', audio: [] };

function countScenes(script: string) {
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marker = /^(scene|ឈុត|ឆាក)\s*\d+|^\d+\s*[.):-]/i;
  const marked = lines.filter((line) => marker.test(line));
  return marked.length > 0 ? marked.length : lines.length;
}

function EngineWorkspace({ blocked, type, t, language, anchor = [], onAnchor, draft, onDraft, voiceProfile, cfg, onNotice }: { blocked?: string; type: EngineKey; t: Copy; language: Language; anchor?: AudioItem[]; onAnchor?: (items: AudioItem[]) => void; draft: JobDraft; onDraft: (patch: Partial<JobDraft>) => void; voiceProfile?: Voice; cfg?: ReturnType<typeof useEngineConfig>; onNotice: (message: string) => void }) {
  const isVideo = type === 'video';
  const image = cfg?.ref ?? null;
  const opts = cfg?.opts;
  const isKh = type === 'kh';
  const vc = videoCopy[language];
  const audio = draft.audio ?? [];
  const beat = useHeartbeat(isVideo);
  const [paused, setPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [isUploaded, setIsUploaded] = useState(false);
  const title = isVideo ? t.videoEngine : isKh ? t.khEngine : t.enEngine;
  const detail = isVideo ? t.videoDetail : isKh ? t.khDetail : t.enDetail;
  const Icon = isVideo ? Film : AudioLines;
  const scriptScenes = draft.script.trim() ? countScenes(draft.script) : 0;
  const wanted = Number(draft.count);
  let problem = '';
  if (isVideo && !image) problem = t.needImage;
  else if (!draft.folder.trim()) problem = t.needFolder;
  else if (!wanted || wanted < 1) problem = t.needCount;
  else if (!draft.prompt.trim()) problem = t.needPrompt;
  else if (isVideo && audio.length > 0 && audio.length !== wanted) problem = vc.mismatch(audio.length, wanted);
  else if (type === 'en' && anchor.length > 0 && anchor.length !== wanted) problem = vc.anchorMismatch(anchor.length, wanted);
  else if (scriptScenes > 0 && scriptScenes !== wanted) problem = `${t.scriptHas} ${scriptScenes} ${t.scenesWord} ${t.butSet} ${wanted}`;
  if (blocked) problem = blocked;
  const ready = problem === '';
  const summary = `${draft.folder.trim()} · ${wanted} ${t.scenesWord}`;
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const storeKey = `ips-job-${type}`;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  useEffect(() => { try { const saved = window.localStorage.getItem(storeKey); if (saved) { setJobId(saved); setIsProcessing(true); } } catch { /* storage unavailable */ } }, [storeKey]);
  useEffect(() => {
    if (!jobId || paused) return;
    let stopped = false;
    let timer = 0;
    const measureKh = async (view: JobView) => {
      const urls = [...view.scenes].sort((a, b) => a.idx - b.idx).map((s) => s.outputUrl);
      if (!onAnchor || !urls.length || !urls.every((u) => u && /^https?:/.test(u))) return; // preview/mock outputs have no audio to measure
      try {
        const items: AudioItem[] = [];
        for (let i = 0; i < urls.length; i++) items.push({ name: `KH ${String(i + 1).padStart(2, '0')}`, seconds: await readAudioUrl(urls[i] as string) });
        onAnchor(items); noticeRef.current(vc.anchorFromKh(items.length));
      } catch { /* leave the previous anchor untouched */ }
    };
    const finish = (view: JobView) => {
      if (type === 'video') void podPowerOff();
      setIsProcessing(false);
      setJobId(null);
      try { window.localStorage.removeItem(storeKey); } catch { /* storage unavailable */ }
      if (view.status === 'completed' || view.status === 'partial') setHasGenerated(true);
      if (type === 'kh' && view.status === 'completed') void measureKh(view);
      else if (view.status === 'failed') noticeRef.current(view.scenes.find((s) => s.error)?.error ?? 'Generation failed');
    };
    const poll = async () => {
      try {
        const view = await api.getJob(jobId);
        if (stopped) return;
        setJob(view);
        setBatchProgress(isFinished(view.status) ? null : { label: type === 'video' ? 'Video' : 'Voice', done: view.progress.done + view.progress.failed, total: view.progress.total });
        if (view.status === 'cancelled') { setPaused(true); return; } // stopped by the heartbeat guard: wait for Resume
        if (isFinished(view.status)) { finish(view); return; }
      } catch (error) {
        if (stopped) return;
        if (error instanceof Error && /not found/i.test(error.message)) { setIsProcessing(false); setJobId(null); try { window.localStorage.removeItem(storeKey); } catch { /* storage unavailable */ } return; }
      }
      timer = window.setTimeout(poll, 3000);
    };
    poll();
    return () => { stopped = true; window.clearTimeout(timer); setBatchProgress(null); };
  }, [jobId, storeKey, paused]);
  // GPU worker went silent in the middle of a job: stop the queue now and keep the finished scenes.
  useEffect(() => {
    if (beat !== 'down' || !jobId || !isProcessing || paused) return;
    setPaused(true);
    api.cancelJob(jobId).then(setJob).catch(() => undefined);
  }, [beat, jobId, isProcessing, paused]);
  const resume = async () => {
    if (!jobId) return;
    if (beat === 'down') { onNotice(vc.stillOffline); return; }
    try { const view = await api.resumeJob(jobId); setJob(view); setPaused(false); setIsProcessing(true); }
    catch (error) { onNotice(error instanceof Error ? error.message : 'Could not resume'); }
  };
  const generate = async () => {
    if (!ready) return;
    setIsProcessing(true); setHasGenerated(false); setIsUploaded(false); setJob(null); setPaused(false);
    try {
      const parsed = splitScenes(draft.script);
      const useAudio = isVideo && audio.length > 0;
      const scenes = parsed.length ? parsed : useAudio ? audio.map(() => '') : [''];
      let sample: string | undefined;
      if (!isVideo && voiceProfile) { const b = await getVoiceBlob(voiceProfile.id); if (b) sample = await blobToDataUrl(b); }
      if (type === 'video') await podPowerOn();
      const created = await api.createJob({
        engine: type, folder: draft.folder.trim(), masterPrompt: draft.prompt.trim(), scenes,
        imageDataUrl: isVideo && image ? await cropToAspect(image.url, opts?.aspect ?? '9:16') : undefined, voiceId: voiceProfile?.name,
        // Audio-first: every scene carries its audio length so the GPU renders exactly that many frames
        options: { ...(isVideo && opts ? { steps: opts.fast ? 20 : 30, similarity: opts.similarity, aspect: opts.aspect, ...(opts.seed ? { seed: Number(opts.seed) } : {}) } : {}), ...(useAudio ? { sceneSeconds: audio.map((a) => a.seconds) } : type === 'en' && anchor.length === scenes.length ? { sceneSeconds: anchor.map((a) => a.seconds) } : {}), ...(sample ? { voiceSample: sample } : {}) },
      });
      try { window.localStorage.setItem(storeKey, created.id); } catch { /* storage unavailable */ }
      setJob(created); setJobId(created.id);
    } catch (error) {
      setIsProcessing(false);
      onNotice(error instanceof Error ? error.message : 'Could not start the job');
    }
  };
  return <section className="screen-card engine-screen"><div className="screen-heading"><SectionHeading icon={Icon} eyebrow={`${isVideo ? '02' : isKh ? '03' : '04'} · ${title}`} />{isVideo ? <span className={`hb-dot ${beat}`} role="status"><i />{beat === 'up' ? vc.online : beat === 'down' ? vc.offline : vc.checking}</span> : <span className="status-dot"><span />{t.ready}</span>}</div>{isVideo ? <>{cfg && <div className="mb-3"><RefBar cfg={cfg} onNotice={onNotice} /></div>}<AudioFolderPicker c={vc} items={audio} disabled={isProcessing} onNotice={onNotice} onChange={(items) => onDraft({ audio: items, ...(items.length ? { count: String(items.length) } : {}) })} /></> : <div className="voice-source"><div className={`voice-avatar ${isKh ? 'kh-avatar' : 'en-avatar'}`} style={voiceProfile ? { background: voiceProfile.color } : undefined}>{voiceProfile?.initials ?? '--'}</div><div><span>{t.selectedVoice}</span><strong>{voiceProfile?.name ?? '—'}</strong></div><ChevronRight size={16} /></div>}<div className="job-fields"><div><label className="field-label" htmlFor={`${type}-folder`}>{t.folderName} <span>{t.required}</span></label><input id={`${type}-folder`} className="studio-input" value={draft.folder} maxLength={60} placeholder={t.folderPlaceholder} onChange={(event) => onDraft({ folder: event.target.value.replace(/[\\/:*?"<>|]/g, '-') })} /></div><div><label className="field-label" htmlFor={`${type}-count`}>{t.sceneCount} <span>{t.required}</span></label><input id={`${type}-count`} className="studio-input" inputMode="numeric" value={draft.count} maxLength={3} placeholder="0" onChange={(event) => onDraft({ count: event.target.value.replace(/\D/g, '').slice(0, 3) })} /></div></div><label className="field-label">{t.masterPrompt} <span>{t.required}</span></label><input className="studio-input" value={draft.prompt} onChange={(event) => onDraft({ prompt: event.target.value })} placeholder={isVideo ? t.describeScene : t.setDelivery} /><label className="field-label">{t.batchScripts} <span>{t.optional}</span></label><textarea className="studio-textarea" value={draft.script} onChange={(event) => onDraft({ script: event.target.value })} placeholder={isVideo ? t.scriptVideo : t.scriptVoice} />{isVideo && cfg && <OptionsPanel language={language} opts={cfg.opts} onChange={cfg.setOpts} disabled={isProcessing} />}{isVideo && audio.length > 0 && <AudioReport c={vc} items={audio} />}{type === 'en' && anchor.length > 0 && <AudioReport c={vc} items={anchor} />}{!isProcessing && !hasGenerated && !isUploaded && <div className={`scene-check ${ready ? 'ok' : scriptScenes > 0 && scriptScenes !== wanted ? 'bad' : 'neutral'}`}>{ready ? <Check size={14} /> : <ShieldCheck size={14} />}<span>{ready ? `${t.verified} · ${scriptScenes > 0 ? `${scriptScenes} ${t.scenesWord}` : t.noScript}` : problem}</span></div>}{isProcessing && !paused && (isVideo && job ? <div className="queue-line"><span className="processing-spinner" /> ⏳ {vc.rendering} {vc.scene} {Math.min(job.progress.total, (job.scenes.find((x) => x.status !== 'done')?.idx ?? job.progress.total - 1) + 1)}{vc.of}{job.progress.total}… · {job.progress.done} {vc.done}</div> : <div className="processing-state"><span className="processing-spinner" /> {t.generating} {isVideo ? 'video' : 'voice'}… {job ? `${job.progress.done}/${job.progress.total}` : ''}</div>)}{paused && <div className="paused-box">⚠ {vc.paused(job?.progress.done ?? 0, (job?.scenes.find((x) => x.status !== 'done')?.idx ?? 0) + 1)}</div>}{(isProcessing || hasGenerated) && <div className="job-summary"><Folder size={14} /> {summary}</div>}{paused && <button type="button" className="resume-button" onClick={resume}><Play size={15} fill="currentColor" /> {vc.resume}</button>}{!isProcessing && !paused && !hasGenerated && !isUploaded && <button type="button" className="primary-button generate-button" disabled={!ready} onClick={generate}><WandSparkles size={16} /> {isVideo ? t.generateVideo : t.generateVoice}</button>}{!isProcessing && hasGenerated && !isUploaded && <button type="button" className="drive-button" onClick={() => { setIsUploaded(true); onNotice(t.uploaded); }}><Upload size={15} /> {t.uploadDrive}</button>}{!isProcessing && isUploaded && <div className="upload-success"><div><Check size={16} /><strong>{t.uploaded}</strong><span>{t.archived}</span></div><button type="button" className="close-result" onClick={() => setIsUploaded(false)} aria-label={t.close}><X size={17} /></button></div>}{!isProcessing && !hasGenerated && !isUploaded && <p className="workspace-helper"><ShieldCheck size={14} /> {t.uploadAfter}</p>}</section>;
}

function HistoryProject({ t }: { t: Copy }) {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.listJobs().then((r) => setJobs(r.jobs)).catch((e) => { setErr(e instanceof Error ? e.message : 'Could not load history'); setJobs([]); }); }, []);
  const label = { video: 'Video generation', kh: 'KH Voice generation', en: 'EN Voice generation' } as const;
  const list = jobs ?? [];
  return <section className="screen-card history-screen"><div className="screen-heading"><SectionHeading icon={History} eyebrow={`05 · ${t.history}`} title={t.history} detail={t.historyDetail} /><span className="capacity">{list.length} {t.projects}</span></div>
    {err && <p className="library-empty">{err}</p>}
    <div className="history-list">{jobs && !list.length && !err && <p className="library-empty">No projects yet. Finished jobs appear here.</p>}{list.map((job, index) => <article className="history-item" key={job.id}><div className="history-index">{String(index + 1).padStart(2, '0')}</div><div className="history-info"><strong>{job.folder || 'Untitled'}</strong><span>{label[job.engine]} · {new Date(job.createdAt).toLocaleString()} · {job.progress.done}/{job.progress.total}</span></div><span className="history-status"><Check size={13} /> {job.status}</span><ChevronRight size={17} className="history-arrow" /></article>)}</div></section>;
}

function Acc({ icon: I, title, children, defaultOpen = false }: { icon: LucideIcon; title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [on, setOn] = useState(defaultOpen);
  return <section className={`acc ${on ? 'open' : ''}`}><button type="button" aria-expanded={on} onClick={() => setOn((v) => !v)}><I size={17} /><span>{title}</span><ChevronDown size={18} className="acc-chev" /></button>{on && <div className="acc-panel">{children}</div>}</section>;
}

function SettingsDrawer({ vault, vaultError, setVault, open, onClose, t, language, setLanguage, themeMode, setThemeMode, eyeCare, setEyeCare, features, setFeatures, onAbout }: { onAbout: () => void; vault: VaultService[] | null; vaultError: string; setVault: (v: VaultService[]) => void; features: FeatureCfg[]; setFeatures: (f: FeatureCfg[]) => void; open: boolean; onClose: () => void; t: Copy; language: Language; setLanguage: (language: Language) => void; themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void; eyeCare: boolean; setEyeCare: () => void }) {
  if (!open) return null;
  const themes: [ThemeMode, string, LucideIcon][] = [['system', t.system, Radio], ['light', t.light, Sun], ['dark', t.dark, Moon]];
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="command-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-header"><h2>{t.settings}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button></div><div className="drawer-content"><div className="vault-heading">API Key Vault</div><ApiKeyVault services={vault} error={vaultError} onChange={setVault} /><Acc icon={ShieldCheck} title="Account & Notifications"><AccountPanel /></Acc><Acc icon={Palette} title={t.language}><div className="segmented"><button type="button" className={language === 'kh' ? 'active' : ''} onClick={() => setLanguage('kh')}>ភាសាខ្មែរ</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English</button></div></Acc><Acc icon={Sun} title={t.theme}><div className="theme-options">{themes.map(([key, label, ThemeIcon]) => <button type="button" key={key} className={themeMode === key ? 'active' : ''} onClick={() => setThemeMode(key)}><ThemeIcon size={15} />{label}</button>)}</div><div className="setting-row compact"><strong>{t.eyeCare}</strong><Toggle checked={eyeCare} onChange={setEyeCare} label={t.eyeCare} /></div></Acc><Acc icon={BookOpen} title={language === 'kh' ? 'អំពី Atom Edit · សៀវភៅណែនាំ' : 'About Atom Edit · Manual'}><button type="button" className="primary-button" onClick={onAbout}>{language === 'kh' ? 'បើកសៀវភៅណែនាំ' : 'Open the manual'}</button></Acc><FeatureSettings features={features} onChange={setFeatures} /></div><button type="button" className="drawer-save" onClick={onClose}><Check size={16} /> {t.save}</button></aside></div>;
}

export default function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const t = language === 'kh' ? khmer : english;
  const [activeTab, setActiveTab] = useState<Tab>('script');
  const [commandOpen, setCommandOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const lastVoiceRef = useRef<Tab>('kh');
  const [features, setFeaturesState] = useState<FeatureCfg[]>(DEFAULT_FEATURES);
  const [vault, setVault] = useState<VaultService[] | null>(null);
  const [vaultError, setVaultError] = useState('');
  useEffect(() => { api.vault().then((r) => setVault(r.services)).catch((e) => { setVault([]); setVaultError(e instanceof Error ? e.message : 'Failed'); }); }, []);
  // opened from a push notification (?tab=documents)
  useEffect(() => { const q = new URLSearchParams(window.location.search).get('tab'); if (q === 'documents') setActiveTab('documents'); }, []);
  const runpodReady = !!vault?.find((v) => v.service === 'runpod' && v.hasKey && v.endpoint);
  const timelineRef = useRef<TimelineHandle>(null);
  const setFeatures = (f: FeatureCfg[]) => { setFeaturesState(f); saveFeatures(f); };
  useEffect(() => { setFeaturesState(loadFeatures()); const sync = (e: StorageEvent) => { if (e.key === 'ips-features') setFeaturesState(loadFeatures()); }; window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [eyeCare, setEyeCare] = useState(false);
  const [notice, setNotice] = useState('');
  const [assigned, setAssigned] = useState<Record<Target, string>>({ kh: '', en: '' });
  const [drafts, setDrafts] = useState<Record<EngineKey, JobDraft>>({ video: emptyDraft, kh: emptyDraft, en: emptyDraft });
  const updateDraft = (key: EngineKey, patch: Partial<JobDraft>) => setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  const [voices, setVoices] = useState<Voice[]>([]);
  useEffect(() => { listVoices().then((l) => setVoices(l.map(toVoice))).catch(() => undefined); }, []);
  const videoCfg = useEngineConfig('video');
  const [splash, setSplash] = useState<'show' | 'leaving' | 'done'>('show');

  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('ips-prefs') || '{}');
      if (['system', 'light', 'dark'].includes(saved.theme)) setThemeMode(saved.theme);
      if (typeof saved.eyeCare === 'boolean') setEyeCare(saved.eyeCare);
      if (saved.language === 'kh' || saved.language === 'en') setLanguage(saved.language);
    } catch { /* storage unavailable */ }
    setPrefsLoaded(true);
  }, []);
  useEffect(() => {
    if (!prefsLoaded) return;
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.classList.toggle('eye-care', eyeCare);
    try { window.localStorage.setItem('ips-prefs', JSON.stringify({ theme: themeMode, eyeCare, language })); } catch { /* storage unavailable */ }
  }, [prefsLoaded, themeMode, eyeCare, language]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const onChange = () => { if (hadController && !reloaded) { reloaded = true; window.location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    navigator.serviceWorker.register('/sw.js').then((registration) => registration.update()).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);
  useEffect(() => { if (splash === 'show') { const id = window.setTimeout(() => setSplash('leaving'), 2200); return () => window.clearTimeout(id); } if (splash === 'leaving') { const id = window.setTimeout(() => setSplash('done'), 600); return () => window.clearTimeout(id); } }, [splash]);
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3200); };
  const sendVoice = (voice: string, target: Target) => { setAssigned((current) => ({ ...current, [target]: voice })); showNotice(`${t.sentTo} ${target === 'kh' ? t.khEngine : t.enEngine} · ${voice}`); };
  const deleteVoices = (names: string[]) => { void dbDeleteVoices(voices.filter((v) => names.includes(v.name)).map((v) => v.id)); setVoices((current) => current.filter((voice) => !names.includes(voice.name))); setAssigned((current) => ({ kh: names.includes(current.kh) ? '' : current.kh, en: names.includes(current.en) ? '' : current.en })); showNotice(t.deletedVoices); };
  const addVoiceFile = async (file: File, kind: string) => { try { await addVoice(file, kind); setVoices((await listVoices()).map(toVoice)); showNotice(t.voiceAdded); } catch (e) { showNotice(e instanceof Error ? e.message : 'Could not add the voice'); } };
  const renderScreen = () => { if (activeTab === 'script' || activeTab === 'prompts' || activeTab === 'documents' || activeTab === 'timeline' || activeTab === 'image') return null; if (activeTab === 'voices') return <VoiceLibrary t={t} voices={voices} assigned={assigned} onSend={sendVoice} onDelete={deleteVoices} onAdd={addVoiceFile} onNotice={showNotice} />; if (activeTab === 'video') return <EngineWorkspace key="video" blocked={runpodReady ? undefined : (vault ? 'Add your RunPod key + Endpoint ID in Settings → API Key Vault to use the Video Engine.' : 'Loading…')} type="video" t={t} language={language} draft={drafts.video} onDraft={(patch) => updateDraft('video', patch)} cfg={videoCfg} onNotice={showNotice} />; if (activeTab === 'kh') return <EngineWorkspace key="kh" type="kh" t={t} language={language} onAnchor={(items) => updateDraft('video', { audio: items, count: String(items.length) })} draft={drafts.kh} onDraft={(patch) => updateDraft('kh', patch)} voiceProfile={voices.find((voice) => voice.name === assigned.kh)} onNotice={showNotice} />; if (activeTab === 'en') return <EngineWorkspace key="en" type="en" t={t} language={language} anchor={drafts.video.audio} draft={drafts.en} onDraft={(patch) => updateDraft('en', patch)} voiceProfile={voices.find((voice) => voice.name === assigned.en)} onNotice={showNotice} />; return <HistoryProject t={t} />; };
  const items = navItems(t);

  const sendScript = (target: 'kh' | 'en' | 'video', text: string) => updateDraft(target, { script: text, count: String(splitScenes(text).length || drafts[target].count) });
  const go = (id: Tab) => { setActiveTab(id); setMenuOpen(false); };
  const on = (id: FeatureId) => isOn(features, id);
  const firstTab = (): Tab => { for (const f of features) { if (!f.on) continue; if (f.id === 'voice') return 'kh'; if (f.id !== 'command') return f.id as Tab; } return 'timeline'; };
  // a tab whose feature was switched off can no longer be shown
  useEffect(() => { const need = TAB_FEATURE[activeTab]; if (need && !isOn(features, need)) setActiveTab(firstTab()); }, [features, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === 'kh' || activeTab === 'en') lastVoiceRef.current = activeTab; }, [activeTab]);
  useEffect(() => { if (!isOn(features, 'command')) setCommandOpen(false); }, [features]);
  const tabIcon: Record<string, LucideIcon> = { script: NotebookPen, prompts: Library, documents: Cloud, voices: Mic2, video: Film, image: ImageIcon, history: History };
  const tabLabel: Record<string, string> = { script: 'Script Preparation', prompts: 'Prompt Library', documents: 'Document', voices: t.voiceLibrary, video: t.videoEngine, kh: t.khEngine, en: t.enEngine, timeline: 'Timeline Editor', image: 'Image Engine', history: t.history };
  const tabIdx = menuOpen ? 0 : -1;

  return <main className="app-shell"><header className="topbar"><button type="button" className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}><Menu size={22} /></button>{(activeTab === 'kh' || activeTab === 'en') && <div className="voice-switch" role="tablist" aria-label="Voice language"><button type="button" role="tab" aria-selected={activeTab === 'kh'} className={activeTab === 'kh' ? 'active' : ''} onClick={() => setActiveTab('kh')}>KH</button><button type="button" role="tab" aria-selected={activeTab === 'en'} className={activeTab === 'en' ? 'active' : ''} onClick={() => setActiveTab('en')}>EN</button></div>}<h1 className="top-title">{activeTab === 'kh' || activeTab === 'en' ? 'Voice Engine' : (tabLabel[activeTab] ?? '')}</h1>{!settingsOpen && !commandOpen && <AiAssistant screen={tabLabel[activeTab] ?? activeTab} language={language} />}</header><BatchBanner />
    <div className={`side-overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden={!menuOpen} />
    <aside className={`side-drawer ${menuOpen ? 'open' : ''}`} aria-label="Navigation" aria-hidden={!menuOpen}>
      <div className="side-head"><Brand t={t} /><button type="button" className="icon-button" onClick={() => setMenuOpen(false)} aria-label={t.close ?? 'Close'}><X size={20} /></button></div>
      <nav className="side-nav">{features.filter((f) => f.on).map((f) => {
        if (f.id === 'voice') {
          const inVoice = activeTab === 'kh' || activeTab === 'en';
          return <button type="button" key="voice" tabIndex={tabIdx} className={inVoice ? 'side-item active' : 'side-item'} onClick={() => go(inVoice ? (activeTab as Tab) : lastVoiceRef.current)}><AudioLines size={20} /><span>Voice Engine</span></button>;
        }
        if (f.id === 'command') return <button type="button" key="command" tabIndex={tabIdx} className="side-item" onClick={() => { setMenuOpen(false); setCommandOpen(true); }}><Gauge size={20} /><span>{t.commandCenter}</span></button>;
        const Icon = tabIcon[f.id];
        return <button type="button" key={f.id} tabIndex={tabIdx} className={activeTab === f.id ? 'side-item active' : 'side-item'} onClick={() => go(f.id as Tab)}><Icon size={20} /><span>{tabLabel[f.id]}</span></button>;
      })}
        <button type="button" tabIndex={tabIdx} className={activeTab === 'timeline' ? 'side-item active' : 'side-item'} onClick={() => go('timeline')}><Clapperboard size={20} /><span>Timeline Editor</span></button>
        <div className="side-sep" />
        <button type="button" tabIndex={tabIdx} className="side-item" onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}><Settings2 size={20} /><span>{t.settings}</span></button>
      </nav>
    </aside>
    <div className="workspace">{notice && <div className="notice"><Check size={16} />{notice}</div>}
      <div hidden={activeTab !== 'script'}><ScriptPrepScreen language={language} anchor={drafts.video.audio.map((a) => a.seconds)} onSend={sendScript} onNotice={showNotice} /></div>
      <div hidden={activeTab !== 'timeline'}><TimelineEditor ref={timelineRef} scripts={[{ label: 'KH', text: drafts.kh.script }, { label: 'EN', text: drafts.en.script }]} onNotice={showNotice} /></div>
      <div hidden={activeTab !== 'prompts'}>{on('prompts') && <PromptLibrary active={activeTab === 'prompts'} onNotice={showNotice} />}</div>
      <div hidden={activeTab !== 'documents'}>{on('documents') && <DocumentManager active={activeTab === 'documents'} onNotice={showNotice} onSendToTimeline={async (files) => { await timelineRef.current?.addMixed(files); setActiveTab('timeline'); }} />}</div>
      <div hidden={activeTab !== 'image'}>{on('image') && <ImageEngine language={language} onImages={(files) => timelineRef.current?.addImages(files)} onNotice={showNotice} />}</div>
      {renderScreen()}</div>
    <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} /><CommandCenter open={commandOpen && on('command')} onClose={() => setCommandOpen(false)} t={t} language={language} show={{ voice: on('voice'), video: on('video'), image: on('image') }} /><SettingsDrawer onAbout={() => setAboutOpen(true)} vault={vault} vaultError={vaultError} setVault={setVault} features={features} setFeatures={setFeatures} open={settingsOpen} onClose={() => setSettingsOpen(false)} t={t} language={language} setLanguage={setLanguage} themeMode={themeMode} setThemeMode={setThemeMode} eyeCare={eyeCare} setEyeCare={() => setEyeCare((value) => !value)} />{splash !== 'done' && <Splash leaving={splash === 'leaving'} onSkip={() => setSplash('leaving')} t={t} />}</main>;
}
