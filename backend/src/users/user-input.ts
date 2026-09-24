import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
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

export const parseAccountDelete = (input: unknown) =>
  parse(deleteSchema, input);
export const parseEntityId = (input: unknown) =>
  parse(z.uuid(), input).toLowerCase();
