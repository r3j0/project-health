import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  includeAssignment,
  serializeAssignment,
} from '../curricula/curricula.service.js';

@Injectable()
export class UserProfileService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async get(userId: string) {
    // Read account state and measurement existence in one snapshot. Only an ID
    // is needed for onboarding; no measured values or goals are loaded.
    return this.database.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            currency: true,
            currentCurriculumAssignment: { include: includeAssignment },
            measurements: { select: { id: true }, take: 1 },
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
        return {
          id: user.id,
          email: user.email,
          created_at: user.createdAt,
          updated_at: user.updatedAt,
          isOnboarded: user.measurements.length > 0,
          currency: { balance: user.currency.balance },
          currentCurriculum: user.currentCurriculumAssignment
            ? serializeAssignment(user.currentCurriculumAssignment)
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
