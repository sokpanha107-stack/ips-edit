import { handleComplete, CORS } from '@/lib/backend/gpuComplete';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });
export const POST = (req: Request) => handleComplete('video', req);
