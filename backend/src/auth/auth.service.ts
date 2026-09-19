import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

const publicUserSelect = {
  id: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} as const;
type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export function serializeUser(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async register(email: string, password: string) {
    const passwordHash = await this.passwords.hash(password);
    const refreshToken = this.tokens.newRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtl * 1000);
    let user;
    try {
      user = await this.database.user.create({
        data: {
          email,
          password: passwordHash,
          sessions: {
            create: {
              expiresAt,
              refreshTokens: {
                create: {
                  tokenHash: this.tokens.hashRefreshToken(refreshToken),
                },
              },
            },
          },
        },
        select: { ...publicUserSelect, sessions: { select: { id: true } } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('이미 가입된 이메일입니다.');
      }
      throw error;
    }
    return this.result(user, user.sessions[0].id, expiresAt, refreshToken);
  }

  async login(email: string, password: string) {
    const user = await this.database.user.findUnique({ where: { email } });
    const matches = await this.passwords.matches(user?.password, password);
    if (!user || !matches)
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    const refreshToken = this.tokens.newRefreshToken();
    const session = await this.database.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtl * 1000),
        refreshTokens: {
          create: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
        },
      },
    });
    return this.result(user, session.id, session.expiresAt, refreshToken);
  }

  async refresh(refreshToken: string | undefined) {
    if (!this.tokens.isRefreshToken(refreshToken)) throw this.invalidSession();
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const nextToken = this.tokens.newRefreshToken();
    const session = await this.database.$transaction(async (tx) => {
      const previous = await tx.authRefreshToken.findUnique({
        where: { tokenHash },
      });
      if (!previous) return null;
      const now = new Date();
      // The parent update takes a row lock shared by refresh and logout. Recheck
      // token usage under that lock so concurrent rotations cannot both succeed.
      const active = await tx.authSession.updateMany({
        where: {
          id: previous.sessionId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: null },
      });
      if (active.count === 0) return null;
      const consumed = await tx.authRefreshToken.updateMany({
        where: { tokenHash, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count === 0) {
        await tx.authSession.update({
          where: { id: previous.sessionId },
          data: { revokedAt: now },
        });
        // Return, rather than throw, so replay revocation commits.
        return null;
      }
      await tx.authRefreshToken.create({
        data: {
          tokenHash: this.tokens.hashRefreshToken(nextToken),
          sessionId: previous.sessionId,
        },
      });
      return tx.authSession.findUniqueOrThrow({
        where: { id: previous.sessionId },
        include: { user: { select: publicUserSelect } },
      });
    });
    if (!session) throw this.invalidSession();
    return this.result(session.user, session.id, session.expiresAt, nextToken);
  }

  async logout(refreshToken: string | undefined, authorization?: string) {
    const token = this.tokens.isRefreshToken(refreshToken)
      ? await this.database.authRefreshToken.findUnique({
          where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
        })
      : null;
    if (token) {
      await this.database.authSession.updateMany({
        where: { id: token.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else if (authorization) {
      const claims = await this.bearerClaims(authorization);
      await this.database.authSession.updateMany({
        where: { id: claims.sessionId, userId: claims.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async authenticate(authorization: string | undefined) {
    const claims = await this.bearerClaims(authorization);
    const session = await this.database.authSession.findFirst({
      where: {
        id: claims.sessionId,
        userId: claims.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: publicUserSelect } },
    });
    if (!session) throw this.invalidSession();
    return serializeUser(session.user);
  }

  private bearerClaims(authorization: string | undefined) {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
    if (!match || match[1].length > 4096) throw this.invalidSession();
    return this.tokens.verify(match[1]);
  }

  private async result(
    user: PublicUser,
    sessionId: string,
    expiresAt: Date,
    refreshToken: string,
  ) {
    return {
      body: {
        user: serializeUser(user),
        ...(await this.tokens.issue(user.id, sessionId, expiresAt)),
      },
      refreshToken,
      expiresAt,
    };
  }

  private invalidSession() {
    return new UnauthorizedException(
      '로그인이 필요하거나 세션이 만료되었습니다.',
    );
  }
}
