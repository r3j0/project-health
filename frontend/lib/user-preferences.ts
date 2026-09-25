export const exerciseVolumeOptions = [
  { value: "less", label: "더 적게 운동하기" },
  { value: "standard", label: "기본" },
  { value: "more", label: "더 많이 운동하기" },
] as const;

export const exerciseGoalOptions = [
  {
    value: "fitness_grade_improvement",
    label: "국민체력100 등급 개선",
    description: "측정 종목별 등급 향상을 목표로 해요.",
  },
  {
    value: "body_composition_management",
    label: "체형 관리",
    description: "체지방과 근육 등 체성분 관리를 목표로 해요.",
  },
  {
    value: "general_fitness_improvement",
    label: "기본 체력 증진",
    description: "일상에 필요한 체력을 전반적으로 기르고 싶어요.",
  },
] as const;

export type ExerciseVolume = (typeof exerciseVolumeOptions)[number]["value"];
export type ExerciseGoal = (typeof exerciseGoalOptions)[number]["value"];
export interface ExercisePreferences {
  exerciseVolume: ExerciseVolume;
  exerciseGoal: ExerciseGoal | null;
}
