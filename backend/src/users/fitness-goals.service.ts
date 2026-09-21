import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { UserFitnessGoal } from '../generated/prisma/client.js';
import { definitionValueErrors } from '../measurements/measurement-catalog.service.js';
import { invalidUserInput } from './user-input.js';
import type { GoalCreateInput, GoalPatchInput } from './user-input.js';

export function serializeGoal(goal: UserFitnessGoal) {
  return {
    id: goal.id,
    catalogVersion: goal.catalogVersion,
    measurementCode: goal.code,
    value: goal.value.toFixed(),
    unit: goal.unit,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

@Injectable()
export class FitnessGoalsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async list(userId: string) {
    const goals = await this.database.userFitnessGoal.findMany({
      where: { userId },
      orderBy: { code: 'asc' },
    });
    return { items: goals.map(serializeGoal) };
  }

  async get(userId: string, id: string) {
    const goal = await this.database.userFitnessGoal.findFirst({
      where: { id, userId },
    });
    if (!goal) throw this.notFound();
    return serializeGoal(goal);
  }

  async create(userId: string, input: GoalCreateInput) {
    try {
      const goal = await this.database.$transaction(async (tx) => {
        await this.validate(
          tx,
          input.catalogVersion,
          input.measurementCode,
          input,
        );
        return tx.userFitnessGoal.create({
          data: {
            userId,
            code: input.measurementCode,
            catalogVersion: input.catalogVersion,
            value: input.value,
            unit: input.unit,
          },
        });
      });
      return serializeGoal(goal);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          '이미 목표가 있는 항목입니다. 기존 목표를 수정해 주세요.',
        );
      throw error;
    }
  }

  async patch(userId: string, id: string, input: GoalPatchInput) {
    const goal = await this.database.$transaction(async (tx) => {
      // Lock before reading so concurrent partial writes validate the latest row.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ${this.database.table('user_fitness_goals')} WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw this.notFound();
      const current = await tx.userFitnessGoal.findFirstOrThrow({
        where: { id, userId },
      });
      const value = input.value ?? current.value.toFixed();
      const unit = input.unit ?? current.unit;
      await this.validate(tx, current.catalogVersion, current.code, {
        value,
        unit,
      });
      return tx.userFitnessGoal.update({
        where: { id, userId },
        data: { value, unit },
      });
    });
    return serializeGoal(goal);
  }

  async delete(userId: string, id: string) {
    const result = await this.database.userFitnessGoal.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw this.notFound();
  }

  private async validate(
    tx: Prisma.TransactionClient,
    catalogVersion: string,
    code: string,
    input: { value: string; unit: string },
  ) {
    const definition = await tx.measurementDefinition.findUnique({
      where: { catalogVersion_code: { catalogVersion, code } },
    });
    if (!definition)
      invalidUserInput([
        {
          field: 'measurementCode',
          message: '카탈로그 버전과 검사 코드를 확인해 주세요.',
        },
      ]);
    const errors = definitionValueErrors(input, definition);
    if (errors.length) invalidUserInput(errors);
  }

  private notFound() {
    return new NotFoundException('목표 체력을 찾을 수 없습니다.');
  }
}
