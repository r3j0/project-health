import {
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type {
  CallHandler,
  CanActivate,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import multer from 'multer';
import { from, lastValueFrom } from 'rxjs';
import { AccessTokenGuard } from '../../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../../auth/auth.guards.js';
import { AuthRateLimitService } from '../../auth/auth-rate-limit.service.js';
import { API_V1 } from '../../config/api-version.js';
import { ExtractionConfig } from './extraction.config.js';
import { extractionError, withinDeadline } from './extraction-error.js';
import { ExtractionService } from './extraction.service.js';

type ExtractionRequest = AuthenticatedRequest & {
  extractionSignal: AbortSignal;
};

@Injectable()
export class ExtractionGuard implements CanActivate {
  constructor(
    @Inject(ExtractionConfig) private readonly config: ExtractionConfig,
    @Inject(AuthRateLimitService) private readonly limits: AuthRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const options = this.config.get();
    const request = context.switchToHttp().getRequest<ExtractionRequest>();
    try {
      // Persisted counters work across sessions, restarts and backend replicas.
      await this.limits.consume(
        `ocr:minute:${request.user.id}`,
        options.perMinute,
        60,
      );
      await this.limits.consume(
        `ocr:day:${request.user.id}`,
        options.perDay,
        86_400,
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        const original = error.getResponse() as { retry_after: number };
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('Retry-After', original.retry_after);
        throw new HttpException(
          {
            statusCode: 429,
            code: 'EXTRACTION_RATE_LIMITED',
            message: '사진 추출 요청이 너무 많습니다.',
            retry_after: original.retry_after,
          },
          429,
        );
      }
      throw error;
    }
    return true;
  }
}

@Injectable()
export class ExtractionUploadInterceptor implements NestInterceptor {
  private active = 0;
  constructor(
    @Inject(ExtractionConfig) private readonly config: ExtractionConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    return from(this.run(context, next));
  }

  private async run(context: ExecutionContext, next: CallHandler) {
    const options = this.config.get();
    if (this.active >= options.maxConcurrent)
      throw extractionError(503, 'EXTRACTION_BUSY');
    const request = context.switchToHttp().getRequest<ExtractionRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    if (!request.is('multipart/form-data'))
      throw extractionError(400, 'MULTIPART_REQUIRED');
    this.active++;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.requestTimeoutMs,
    );
    request.extractionSignal = controller.signal;
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: options.maxImageBytes,
        files: 1,
        fields: 1,
        parts: 2,
        fieldSize: 100,
        fieldNameSize: 100,
      },
    }).single('image');
    try {
      await withinDeadline(
        new Promise<void>((resolve, reject) => {
          upload(request, response, (error: unknown) => {
            if (!error) return resolve();
            reject(
              error instanceof multer.MulterError &&
                error.code === 'LIMIT_FILE_SIZE'
                ? extractionError(413, 'IMAGE_TOO_LARGE')
                : extractionError(400, 'INVALID_MULTIPART'),
            );
          });
        }),
        controller.signal,
      );
      return await withinDeadline(
        lastValueFrom(next.handle()),
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
      response.removeListener('close', disconnect);
      if (controller.signal.aborted && !request.complete) {
        request.unpipe();
        request.resume();
      }
      controller.abort();
      // Multer removes buffer while cleaning up rejected multi-file uploads.
      request.file?.buffer?.fill(0);
      delete request.file;
      this.active--;
    }
  }
}

@Controller({ path: 'measurements/extract', version: API_V1 })
@UseGuards(AccessTokenGuard, ExtractionGuard)
export class ExtractionController {
  constructor(
    @Inject(ExtractionService) private readonly extraction: ExtractionService,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(ExtractionUploadInterceptor)
  extract(@Req() request: ExtractionRequest) {
    return this.extraction.extract(
      request.file,
      request.body as unknown,
      request.extractionSignal,
    );
  }
}
