import { redirect } from 'next/navigation';

export default function DatasetIndexPage({ params }: { params: { id: string } }) {
  redirect(`/app/datasets/${params.id}/overview`);
}
