import { AssessmentWorkout } from "@/components/assessment-workout";
export const metadata = { title: "간이측정" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ curriculum?: string }>;
}) {
  const { curriculum } = await searchParams;
  return <AssessmentWorkout curriculum={curriculum} />;
}
