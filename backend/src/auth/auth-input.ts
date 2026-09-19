import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const loginSchema = z.strictObject({
  email,
  password: z.string().min(1).max(128),
});
const registerSchema = loginSchema.extend({
  password: z.string().min(15).max(128),
});

export function parseCredentials(input: unknown, registration = false) {
  const result = (registration ? registerSchema : loginSchema).safeParse(input);
  if (!result.success) {
    // Never include submitted values, passwords, or the original request body.
    throw new BadRequestException({
      statusCode: 400,
      message: registration
        ? '유효한 이메일과 15~128자 비밀번호를 입력해 주세요.'
        : '유효한 이메일과 비밀번호를 입력해 주세요.',
    });
  }
  return result.data;
}
