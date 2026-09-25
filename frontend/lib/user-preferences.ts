export const exerciseVolumeOptions = [
  { value: "less", label: "더 적게 운동하기" },
  { value: "standard", label: "기본" },
  { value: "more", label: "더 많이 운동하기" },
] as const;

export const exerciseGoalOptions = [
  {
    value: "fitness_grade_improvement",
    label: "국민체력100 등급 개선",
    description: "종목별 등급 향상",
  },
  {
    value: "body_composition_management",
    label: "체형 관리",
    description: "체지방·근육 관리",
  },
  {
    value: "general_fitness_improvement",
    label: "기본 체력 증진",
    description: "일상 체력 기르기",
  },
] as const;

export type ExerciseVolume = (typeof exerciseVolumeOptions)[number]["value"];
export type ExerciseGoal = (typeof exerciseGoalOptions)[number]["value"];
export interface ExercisePreferences {
  exerciseVolume: ExerciseVolume;
  exerciseGoal: ExerciseGoal | null;
}
