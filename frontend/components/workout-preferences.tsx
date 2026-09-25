"use client";

import { useId, useState } from "react";
import {
  BicepsFlexed,
  Dumbbell,
  Equal,
  Minus,
  Plus,
  Trophy,
} from "lucide-react";
import {
  exerciseGoalOptions,
  exerciseVolumeOptions,
  type ExercisePreferences,
} from "@/lib/user-preferences";
import { Header, Shell } from "./ui";
import styles from "./workout-preferences.module.css";

const volumeIcons = { less: Minus, standard: Equal, more: Plus };
const goalIcons = {
  fitness_grade_improvement: Trophy,
  body_composition_management: BicepsFlexed,
  general_fitness_improvement: Dumbbell,
};

/** Controlled fields can be connected to the preferences API without changing the UI. */
export function WorkoutPreferenceFields({
  value,
  onChange,
}: {
  value: ExercisePreferences;
  onChange: (next: ExercisePreferences) => void;
}) {
  const id = useId();
  return (
    <div className={styles.fields}>
      <fieldset className={styles.group} aria-describedby={`${id}-volume-hint`}>
        <legend>운동량</legend>
        <p id={`${id}-volume-hint`} className={styles.hint}>
          나에게 맞는 운동량을 선택해 주세요.
        </p>
        <div className={styles.choices}>
          {exerciseVolumeOptions.map((option) => {
            const Icon = volumeIcons[option.value];
            return (
              <label key={option.value} className={styles.choice}>
                <input
                  className="sr-only"
                  type="radio"
                  name={`${id}-exerciseVolume`}
                  value={option.value}
                  checked={value.exerciseVolume === option.value}
                  onChange={() =>
                    onChange({ ...value, exerciseVolume: option.value })
                  }
                />
                <Icon size={22} aria-hidden="true" />
                <span className={styles.label}>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className={styles.group} aria-describedby={`${id}-goal-hint`}>
        <legend>운동 목적</legend>
        <p id={`${id}-goal-hint`} className={styles.hint}>
          가장 이루고 싶은 목표를 하나 골라 주세요.
        </p>
        <div className={styles.choices}>
          {exerciseGoalOptions.map((option) => {
            const Icon = goalIcons[option.value];
            return (
              <label
                key={option.value}
                className={`${styles.choice} ${styles.goalChoice}`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`${id}-exerciseGoal`}
                  value={option.value}
                  aria-labelledby={`${id}-${option.value}-label`}
                  aria-describedby={`${id}-${option.value}-description`}
                  checked={value.exerciseGoal === option.value}
                  onChange={() =>
                    onChange({ ...value, exerciseGoal: option.value })
                  }
                />
                <Icon size={22} aria-hidden="true" />
                <span className={styles.goalCopy}>
                  <span
                    id={`${id}-${option.value}-label`}
                    className={styles.goalLabel}
                  >
                    {option.label}
                  </span>
                  <span
                    id={`${id}-${option.value}-description`}
                    className={styles.description}
                  >
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

export function WorkoutPreferences() {
  // UI preview only: no API calls, saved-state simulation, or browser persistence.
  const [draft, setDraft] = useState<ExercisePreferences>({
    exerciseVolume: "standard",
    exerciseGoal: null,
  });
  return (
    <Shell className="kspo-orange-theme">
      <Header title="운동 설정" back="/account" />
      <div className={`content ${styles.content}`}>
        <p className="muted">나의 속도와 목표에 맞춰 운동을 준비해요.</p>
        <WorkoutPreferenceFields value={draft} onChange={setDraft} />
        <div className={styles.save}>
          <button
            className="button primary"
            type="button"
            disabled
            aria-describedby="preferences-preview-hint"
          >
            저장하기
          </button>
          <p id="preferences-preview-hint" className="caption">
            지금은 선택만 가능해요. 저장 기능은 준비 중이며, 화면을 나가면
            선택이 초기화돼요.
          </p>
        </div>
      </div>
    </Shell>
  );
}
