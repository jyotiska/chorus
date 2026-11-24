import { CampaignReport } from "@/components/harness/deepswe-report";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignReport key={id} id={id} />;
}
