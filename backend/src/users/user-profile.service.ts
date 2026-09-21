import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  includeRecord,
  serializeRecord,
} from '../measurements/measurements.service.js';
import {
  includeAssignment,
  serializeAssignment,
} from '../curricula/curricula.service.js';
import { serializeGoal } from './fitness-goals.service.js';
import type { UserPatchInput } from './user-input.js';

@Injectable()
export class UserProfileService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async get(userId: string) {
    // Relations are separate Prisma SELECTs. One snapshot keeps current fitness,
    // missing items and onboarding consistent during concurrent measurement edits.
    return this.database.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            preferredExercises: true,
            exerciseGoals: true,
            currency: true,
            fitnessGoals: { orderBy: { code: 'asc' } },
            currentCurriculumAssignment: { include: includeAssignment },
            measurements: {
              orderBy: [
                { measuredOn: 'desc' },
                { createdAt: 'desc' },
                { id: 'asc' },
              ],
              take: 1,
              include: includeRecord,
            },
          },
        });
        if (!user)
          throw new UnauthorizedException(
            '로그인이 필요하거나 계정이 삭제되었습니다.',
          );
        if (!user.currency)
          throw new ServiceUnavailableException(
            '사용자 재화 정보가 누락되었습니다. 관리자 확인이 필요합니다.',
          );
        const current = user.measurements[0];
        return {
          id: user.id,
          email: user.email,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
          preferredExercises: user.preferredExercises,
          exerciseGoals: user.exerciseGoals,
          isOnboarded: current !== undefined,
          currentFitness: current ? serializeRecord(current) : null,
          fitnessGoals: user.fitnessGoals.map(serializeGoal),
          currency: { balance: user.currency.balance },
          currentCurriculum: user.currentCurriculumAssignment
            ? serializeAssignment(user.currentCurriculumAssignment)
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async patch(userId: string, input: UserPatchInput) {
    const data: Prisma.UserUpdateManyMutationInput = {};
    if (input.preferredExercises !== undefined)
      data.preferredExercises = input.preferredExercises;
    if (input.exerciseGoals !== undefined)
      data.exerciseGoals = input.exerciseGoals;
    const result = await this.database.user.updateMany({
      where: { id: userId },
      data,
    });
    if (!result.count)
      throw new UnauthorizedException(
        '로그인이 필요하거나 계정이 삭제되었습니다.',
      );
    return this.get(userId);
  }
}
