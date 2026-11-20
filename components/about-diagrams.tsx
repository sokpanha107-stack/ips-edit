'use client';

/** Inline SVG diagrams for the manual. Hard-coded cream palette (not CSS vars) so the PDF capture renders identically. */
const C = { bg: '#f4ecdf', card: '#fffaf2', line: '#cdbfae', ink: '#1e293b', soft: '#6b6358', amber: '#d97706', amberLt: '#f6d9a8', green: '#65a37b' };
const font = 'Inter, system-ui, sans-serif';

function Box({ x, y, w, h, title, sub, accent }: { x: number; y: number; w: number; h: number; title: string; sub?: string; accent?: boolean }) {
  return <g>
    <rect x={x} y={y} width={w} height={h} rx={12} fill={accent ? C.amberLt : C.card} stroke={accent ? C.amber : C.line} strokeWidth={1.5} />
    <text x={x + w / 2} y={y + (sub ? h / 2 - 3 : h / 2 + 5)} textAnchor="middle" fontFamily={font} fontSize={13} fontWeight={700} fill={C.ink}>{title}</text>
    {sub && <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontFamily={font} fontSize={10.5} fill={C.soft}>{sub}</text>}
  </g>;
}
function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <g stroke={C.amber} strokeWidth={2} fill="none" strokeLinecap="round"><line x1={x1} y1={y1} x2={x2} y2={y2 - 6} /><path d={`M${x2 - 5} ${y2 - 8} L${x2} ${y2 - 1} L${x2 + 5} ${y2 - 8}`} /></g>;
}

/** Content workflow: Script → Voice/Image → Batch (unlimited scenes) → Timeline → Omni-Worker Render → Cloud. */
export function WorkflowDiagram() {
  return <svg viewBox="0 0 360 560" width="100%" role="img" aria-label="Atom Edit workflow" style={{ display: 'block', background: C.bg, borderRadius: 16 }}>
    <Box x={90} y={14} w={180} h={50} title="Script Preparation" sub="AI assist · breath · scenes · hand-off" />
    <Arrow x1={180} y1={64} x2={180} y2={96} />
    <Box x={14} y={96} w={160} h={60} title="Voice Engine" sub="KH | EN · 1 audio / scene" accent />
    <Box x={186} y={96} w={160} h={60} title="Image Engine" sub="1 image / scene" accent />
    <Arrow x1={94} y1={156} x2={150} y2={196} />
    <Arrow x1={266} y1={156} x2={210} y2={196} />
    <Box x={50} y={196} w={260} h={64} title="Batch Processing · Unlimited Scenes" sub="Autonomous Resume · auto-saved" accent />
    <Arrow x1={180} y1={260} x2={180} y2={298} />
    <Box x={90} y={298} w={180} h={50} title="Timeline Editor" sub="Master Script · 2.5D · FX · SFX" />
    <Arrow x1={180} y1={348} x2={180} y2={386} />
    <Box x={70} y={386} w={220} h={50} title="RunPod Omni-Worker · Render" sub="1 GPU · NVENC · fire-and-forget" />
    <Arrow x1={180} y1={436} x2={180} y2={474} />
    <Box x={60} y={474} w={240} h={56} title="Document · Cloud Storage" sub="saved by the GPU · notification · Pod stops" />
    <Box x={8} y={298} w={72} h={50} title="Music" sub="own voice" accent />
    <Arrow x1={44} y1={348} x2={64} y2={474} />
    <circle cx={338} cy={22} r={5} fill={C.green} />
  </svg>;
}

/** System architecture. */
export function ArchitectureDiagram() {
  return <svg viewBox="0 0 360 520" width="100%" role="img" aria-label="Atom Edit architecture" style={{ display: 'block', background: C.bg, borderRadius: 16 }}>
    <Box x={80} y={14} w={200} h={54} title="Atom Edit PWA" sub="iPhone / Android · Next.js" accent />
    <Arrow x1={180} y1={68} x2={180} y2={100} />
    <Box x={80} y={100} w={200} h={54} title="Vercel API" sub="/api/* · jobs · assistant · vault" />
    <Arrow x1={110} y1={154} x2={80} y2={196} />
    <Arrow x1={250} y1={154} x2={282} y2={196} />
    <Box x={8} y={196} w={170} h={110} title="Supabase" sub="Auth · RLS database" />
    <text x={93} y={284} textAnchor="middle" fontFamily={font} fontSize={10.5} fill={C.soft}>Storage bucket “documents”</text>
    <text x={93} y={299} textAnchor="middle" fontFamily={font} fontSize={10.5} fill={C.soft}>owner-only policies</text>
    <Box x={190} y={196} w={162} h={110} title="API Key Vault" sub="AES-256-GCM encrypted" />
    <text x={271} y={284} textAnchor="middle" fontFamily={font} fontSize={10.5} fill={C.soft}>key never returned</text>
    <text x={271} y={299} textAnchor="middle" fontFamily={font} fontSize={10.5} fill={C.soft}>to the browser</text>
    <Arrow x1={110} y1={154} x2={110} y2={196} />
    <Arrow x1={271} y1={306} x2={271} y2={346} />
    <Arrow x1={93} y1={306} x2={93} y2={346} />
    <Box x={8} y={346} w={170} h={56} title="Your files" sub="Document · History · Prompts" />
    <Box x={190} y={346} w={162} h={56} title="External engines" sub="called by the server" accent />
    <Arrow x1={271} y1={402} x2={271} y2={430} />
    <Box x={8} y={430} w={110} h={60} title="Gemini" sub="AI Assistant" />
    <Box x={125} y={430} w={110} h={60} title="RunPod Omni" sub="Image·Music·Render" />
    <Box x={242} y={430} w={110} h={60} title="Voice · Alerts" sub="gTTS · Push · Telegram" />
  </svg>;
}
