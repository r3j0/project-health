import { assessmentHref, resolveWorkoutMode } from "./workout-mode.ts";
/** Keep only known local destinations, including the temporary assessment mode. */
export function authDestination(next: string): string {
  if (
    /^\/measurements(?:\/new|\/[a-f0-9-]+(?:\/edit)?)?$/.test(next) ||
    [
      "/",
      "/account",
      "/account/settings",
      "/workout",
      "/onboarding",
      "/onboarding/manual",
      "/onboarding/photo",
    ].includes(next)
  )
    return next;
  if (next.startsWith("/workout?") && !next.includes("#")) {
    const query = new URLSearchParams(next.slice("/workout?".length));
    if ([...query.keys()].some((key) => !["mode", "curriculum"].includes(key)))
      return "/";
    const param = (key: string) => {
      const values = query.getAll(key);
      return values.length > 1 ? values : values[0];
    };
    if (resolveWorkoutMode(param("mode"), param("curriculum")) === "assessment")
      return assessmentHref;
  }
  return "/";
}
