import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { decimalValueSchema } from '../measurements/measurement-input.js';

const preferences = z
  .array(
    z
      .string()
      .transform((value) => value.trim().replace(/\s+/gu, ' '))
      .pipe(z.string().min(1).max(80)),
  )
  .max(20)
  .transform((values) => [...new Set(values)]);

const patchSchema = z
  .strictObject({
    preferredExercises: preferences.optional(),
    exerciseGoals: preferences.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    '수정할 필드를 한 개 이상 입력해 주세요.',
  );

const goalFields = {
  value: decimalValueSchema,
  unit: z.string().trim().min(1).max(30),
};
const goalCreateSchema = z.strictObject({
  catalogVersion: z.string().trim().min(1).max(100),
  measurementCode: z
    .string()
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/),
  ...goalFields,
});
const goalPatchSchema = z
  .strictObject(goalFields)
  .partial()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    '수정할 필드를 한 개 이상 입력해 주세요.',
  );
const deleteSchema = z.strictObject({ password: z.string().min(1).max(128) });

export function invalidUserInput(
  errors: Array<{ field: string; message: string }>,
): never {
  throw new BadRequestException({
    statusCode: 400,
    message: '사용자 입력을 확인해 주세요.',
    errors,
  });
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    invalidUserInput(
      result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || 'body',
        // Never echo submitted values, especially the deletion password.
        message: issue.message,
      })),
    );
  return result.data;
}

export const parseUserPatch = (input: unknown) => parse(patchSchema, input);
export const parseGoalCreate = (input: unknown) =>
  parse(goalCreateSchema, input);
export const parseGoalPatch = (input: unknown) => parse(goalPatchSchema, input);
export const parseAccountDelete = (input: unknown) =>
  parse(deleteSchema, input);
export const parseGoalId = (input: unknown) =>
  parse(z.uuid(), input).toLowerCase();
export type UserPatchInput = z.output<typeof patchSchema>;
export type GoalCreateInput = z.output<typeof goalCreateSchema>;
export type GoalPatchInput = z.output<typeof goalPatchSchema>;
