import { RecordScreen } from "@/components/record-screen";
export const metadata = { title: "측정 기록" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <RecordScreen key={id} id={id} saved={query.saved === "1"} />;
}
