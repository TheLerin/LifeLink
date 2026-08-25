import PortalShell from "@/components/portal-shell";

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return <PortalShell initialSection={section} />;
}
