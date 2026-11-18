/**
 * Atom Edit manual (សៀវភៅណែនាំ). One source of truth:
 *  MANDATORY: whenever ANY feature, screen, schema or workflow changes, update this file in the same commit
 *  and bump ABOUT_UPDATED (see CLAUDE.md). The About screen, its PDF export and the AI assistant all read from here.
 *  - shown in the full-screen About panel,
 *  - sent to Gemini as its grounding knowledge (system instruction) by /api/assistant.
 * Edit the text here and both update.
 */
export interface AboutSection { id: string; title: string; body: string }

export const ABOUT_UPDATED = '2026-11-19';
export const ABOUT_VERSION = '1.3';

export const ABOUT_INTRO = 'Atom Edit (ពីមុនឈ្មោះ IPS edit) គឺជា PWA សម្រាប់ផលិតវីដេអូដោយ AI។ វាប្រមូលផ្តុំ Script, Voice (សំឡេង), Image, Video, Timeline និង Cloud Storage ក្នុងកន្លែងតែមួយ ហើយដំណើរការលើទូរស័ព្ទ ដោយទិន្នន័យរបស់អ្នកនៅឯកជនក្នុងគណនីរបស់អ្នកផ្ទាល់។';

export const ABOUT_SECTIONS: AboutSection[] = [
  { id: 'vision', title: 'គោលបំណង (Vision)', body: 'ធ្វើឱ្យការផលិតវីដេអូខ្លីមួយរឿងពេញលេញ អាចធ្វើបានពីទូរស័ព្ទតែមួយ៖ សរសេរ Script → បង្កើត Voice → បង្កើត Image/Video ជា Scene ច្រើន → តម្រៀបក្នុង Timeline → ទុកក្នុង Cloud។ Scene នីមួយៗ = 1 Image + 1 Audio។' },
  { id: 'login', title: 'ចូលគណនី (Login)', body: 'ចូលតាម Google, Email magic link ឬ Passkey (Face ID)។ គ្រប់ទិន្នន័យ (Prompt, Document, API key, Job) ជាកម្មសិទ្ធិផ្ទាល់ខ្លួន ហើយអ្នកផ្សេងមើលមិនបានទេ (Row Level Security)។' },
  { id: 'command', title: 'Command Center', body: 'បន្ទះត្រួតពិនិត្យ GPU។ ភ្ជាប់ Video Engine និង Image Engine (URL + API key) ហើយមើលស្ថានភាព worker និង active tasks។ RunPod Serverless ចាប់ផ្តើម/បិទខ្លួនឯង។ សម្រាប់ RunPod Pod វាបង្ហាញ GPU, CPU, VRAM, RAM ពិត ហើយមានជម្រើស Auto-start/Auto-stop (បិទជាលំនាំដើម) ដោយប្រើ Pod ID។' },
  { id: 'script', title: 'Script Preparation', body: 'សរសេរ ឬបិទភ្ជាប់ Script ហើយបំបែកជា Scene។ អាចបកប្រែ ហើយផ្ញើទៅ KH Voice, EN Voice ឬ Video Engine។' },
  { id: 'voice', title: 'Voice Engine (KH / EN)', body: 'មានតែមួយ "Voice Engine" ក្នុង Sidebar។ ក្នុង header ខាងឆ្វេងមាន switch KH | EN ហើយបន្ទាប់មកជាអក្សរ "Voice Engine"។ ដាក់ Folder name, ចំនួន Scene, Master prompt និង Script។ ជាលំនាំដើមប្រើសំឡេងឥតគិតថ្លៃ (gTTS)។ ដាក់ Premium Voice ក្នុង API Key Vault បើចង់បានគុណភាពខ្ពស់។' },
  { id: 'image', title: 'Image Engine', body: 'ដាក់រូប Signature, សរសេរ Prompt មួយបន្ទាត់ក្នុងមួយ Scene (ច្រើនបំផុត 100) ហើយចុច Generate។ រូបនីមួយៗចូល Media Bin របស់ Timeline ស្វ័យប្រវត្តិ ហើយត្រូវទុកក្នុង folder ក្នុង Document។' },
  { id: 'video', title: 'Video Engine', body: 'ដាក់រូបមូលដ្ឋាន និងថត Audio (Scene នីមួយៗជា clip) ហើយ Render តាម GPU របស់អ្នក។ ប្រសិនបើ GPU ស្ងាត់ មិនឆ្លើយ ប្រព័ន្ធផ្អាក ហើយរក្សា Scene ដែលចប់ហើយ។ ចុច Resume ដើម្បីបន្ត។' },
  { id: 'batch', title: 'Batch Processing 100 Scenes', body: 'Scene ត្រូវដំណើរការម្តងមួយៗតាមលំដាប់ (1 → 100)។ ឯកសារនីមួយៗត្រូវរក្សាទុកក្នុង folder គោលដៅស្វ័យប្រវត្តិ។ របារខាងលើបង្ហាញ "Processing Scene 12/100…" ពេលវេលាជាក់ស្តែង។ Scene ណាបរាជ័យ ប្រព័ន្ធព្យាយាមម្តងទៀតស្វ័យប្រវត្តិ ហើយអាចចុច Retry/Resume។' },
  { id: 'timeline', title: 'Timeline Editor', body: 'Media Bin ទទួលរូប និងសំឡេង។ មាន lane សម្រាប់ Visual និង Voice។ អាចផ្ញើពី Document ដោយចុចយូរលើឯកសារ → Send to Timeline។' },
  { id: 'documents', title: 'Document (Cloud Storage)', body: 'ឯកសារ និង folder ផ្ទាល់ខ្លួន បង្ហាញជា grid មានរូបតូច (thumbnail) ឬ icon (zip, audio, video) ពេញអេក្រង់ ដោយគ្មានប្រអប់។ ប៊ូតុង + តូចបើក New folder / Upload files ហើយមាន icon ប្តូរ Grid/List និង Select។ តម្រៀបតាមលេខពិតប្រាកដ (1,2,3…10,11 មិនមែន 1,10,11,2)។ ចុចយូរ ឬចុច Select ដើម្បីជ្រើសច្រើន មានប៊ូតុង Select all → Send to Timeline, Share ឬ Export។ ចុច ⋮ លើ item សម្រាប់ Extract to ZIP, Save ZIP to cloud និង Delete។' },
  { id: 'prompts', title: 'Prompt Library', body: 'ទុក Prompt ដែលប្រើញឹកញាប់ ហើយចម្លងបានភ្លាម។' },
  { id: 'vault', title: 'API Key Vault', body: 'ទុក API key ទាំង 4 សេវា៖ Gemini (AI Assistant), RunPod GPU, Video Engine (ជម្រើស, បើទទេប្រើ RunPod) និង Premium Voice ដោយអ៊ិនគ្រីប (AES-256-GCM)។ កាតនីមួយៗឈរដាច់ដោយឡែក (គ្មានប្រអប់ក្រៅ) ហើយមាន switch ៖ ពេលបិទ កាតបង្ហាញតែចំណងជើង ហើយធ្លាក់ទៅក្រោមបំផុត ដើម្បីកុំឱ្យចុចលុបដោយចៃដន្យ (ការបិទនេះគ្រាន់តែលាក់កាតលើឧបករណ៍នេះ)។ Key មិនត្រូវបានផ្ញើត្រឡប់មកអេក្រង់ទេ។ ហាមដាក់ service_role key ឬ DB password ក្នុង App ឬ GitHub។' },
  { id: 'assistant', title: 'AI Assistant', body: 'ប៊ូតុង "Ask AI" នៅ header ខាងលើស្ដាំលើគ្រប់អេក្រង់ ទាល់តែ Settings និង Command Center។ សួរអំពីអេក្រង់បច្ចុប្បន្ន ឬ App ទាំងមូល ដោយវាយ ប្រើមីក្រូហ្វូន ឬផ្ញើរូប Screenshot។ អាចចុចស្តាប់ចម្លើយ។ ត្រូវដាក់ Gemini key ក្នុង Vault មុន។ មាន Safety Quota ៖ ពេលប្រើដល់ 98% ប្រព័ន្ធផ្អាកជាបណ្ដោះអាសន្ន ដើម្បីការពារការចំណាយ។' },
  { id: 'architecture', title: 'ស្ថាបត្យកម្ម និង Workflow (Architecture)', body: 'Workflow៖ Script Preparation → Voice Engine និង Image Engine (Batch 100 Scenes ម្តងមួយ Scene) → Timeline Editor → Document (Cloud Storage)។\nស្ថាបត្យកម្ម៖ PWA លើទូរស័ព្ទ (Next.js) → API លើ Vercel → Supabase (Auth, Database ដែលមាន Row Level Security, Storage) និង API Key Vault ដែលអ៊ិនគ្រីប → GPU របស់អ្នក (RunPod/Colab), Gemini, gTTS។' },
  { id: 'manual', title: 'សៀវភៅណែនាំ និង PDF', body: 'Settings → About → បើកសៀវភៅណែនាំ។ ចុច "Export PDF" ដើម្បីទាញយកសៀវភៅទំហំ A4 ដែលមាន logo, diagram និងមាតិកាពេញលេញ។ សៀវភៅនេះត្រូវបានកែប្រែរាល់ពេល App មានការផ្លាស់ប្តូរ។' },
  { id: 'practice', title: 'គន្លឹះប្រើប្រាស់ល្អបំផុត', body: '១) ដាក់ឈ្មោះ folder ឱ្យច្បាស់ ហើយបំបែក Scene ឱ្យខ្លី។ ២) សាកល្បង 3–5 Scene មុនដំណើរការ 100។ ៣) រក្សា Colab/Pod ឱ្យនៅដំណើរការពេល Render។ ៤) ប្រើ Auto-stop ដើម្បីកុំឱ្យ GPU ចំណាយពេលទំនេរ។ ៥) កុំចែក API key ក្នុង Chat។' },
];

/** Plain-text version used as the AI's knowledge base. */
export function aboutAsText(): string {
  return [`Atom Edit manual v${ABOUT_VERSION}, updated ${ABOUT_UPDATED}`, ABOUT_INTRO, ...ABOUT_SECTIONS.map((s) => `## ${s.title}\n${s.body}`)].join('\n\n');
}
