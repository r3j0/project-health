import { RecordScreen } from "@/components/record-screen";
export const metadata = { title: "측정 기록 수정" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RecordScreen key={id} id={id} edit />;
}
