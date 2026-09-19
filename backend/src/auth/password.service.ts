import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash: string;

  async onModuleInit() {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async matches(storedHash: string | null | undefined, password: string) {
    const usableHash = storedHash?.startsWith('$argon2id$') ? storedHash : null;
    try {
      const matches = await verify(usableHash ?? this.dummyHash, password);
      return usableHash !== null && matches;
    } catch {
      // Manual DB entries or corrupted hashes must never become plain-text logins.
      await verify(this.dummyHash, password);
      return false;
    }
  }
}
