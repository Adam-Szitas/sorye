import { OcrReading } from '@/components/ocr-reading';
import { ensureHubUser } from '@/lib/ensure-user';
import { getOcrAnalysis } from '@/lib/store/ocr-analyses';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import '../reading.css';

export const dynamic = 'force-dynamic';

interface ReadingPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ReadingPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Reading ${id} · Sorye OCR` };
}

export default async function OcrReadingPage({ params }: ReadingPageProps) {
  const session = await ensureHubUser();
  if (!session) redirect('/login');

  const { id } = await params;
  if (!/^ocr-[a-zA-Z0-9-]{4,40}$/.test(id)) notFound();

  const result = await getOcrAnalysis(session.user.id, session.workspace.id, id);
  if (result.access === 'denied' || !result.analysis) notFound();

  return <OcrReading analysis={result.analysis} />;
}
