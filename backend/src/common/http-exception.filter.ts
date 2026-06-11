import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * The JSON shape every error response from this API uses, regardless of
 * origin: a hand-thrown domain exception (e.g. `WORK_SESSION_NOT_FOUND`),
 * Nest's `ValidationPipe` rejecting a malformed body, an unmapped route,
 * or an unexpected crash.
 *
 * `code` is the machine-readable SCREAMING_SNAKE_CASE identifier used
 * throughout this codebase (`INVALID_CREDENTIALS`, `WORK_SESSION_NOT_FOUND`,
 * `EVENT_MISSING_SESSION_REFERENCE`, ...). `statusCode` and `message` are
 * the conventional HTTP-error fields clients and Nest expect.
 */
export interface StandardErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Global exception filter that normalizes all error responses to
 * `{ statusCode, code, message }`, regardless of how the error was raised.
 *
 * Without this filter, hand-thrown domain exceptions
 * (`new BadRequestException({ code, message })`) and framework-generated
 * errors (`ValidationPipe`, 404s, uncaught exceptions) produce different
 * body shapes — the former emits `{ code, message }` with no statusCode;
 * the latter emits `{ statusCode, message, error }` with no code. A client
 * that wants to branch on `body.code` would have to detect which shape it
 * received before it could read the code.
 *
 * `@Catch()` with no argument intercepts everything — HttpExceptions from
 * Nest/ValidationPipe/guards/controllers, plain Errors, and anything else —
 * and funnels all of them through one consistent body shape. Registered
 * globally via `app.useGlobalFilters(new AllExceptionsFilter())` in main.ts.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toStandardErrorBody(exception);

    // Log unexpected errors server-side — the client only ever sees the
    // generic INTERNAL_SERVER_ERROR body, so this is the only record of
    // what actually went wrong.
    if (!(exception instanceof HttpException)) {
      // Log the real message and stack; body.message is deliberately
      // generic and detail-free.
      const detail = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled exception on ${request.method} ${request.url}: ${detail}`, stack);
    }

    response.status(body.statusCode).json(body);
  }

  private toStandardErrorBody(exception: unknown): StandardErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();
      return {
        statusCode,
        code: this.extractCode(payload) ?? this.fallbackCode(statusCode, payload),
        message: this.extractMessage(payload) ?? exception.message,
      };
    }

    // Unexpected crash — generic response; real cause is in the log above.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    };
  }

  /**
   * Hand-thrown domain exceptions in this codebase pass an object shaped
   * like `{ code: 'SOME_CODE', message: '...' }` as the HttpException
   * response body. This method recognizes and preserves those codes verbatim
   * so the SCREAMING_SNAKE_CASE contract is not altered in transit.
   */
  private extractCode(payload: unknown): string | undefined {
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'code' in payload &&
      typeof (payload as { code: unknown }).code === 'string'
    ) {
      return (payload as { code: string }).code;
    }
    return undefined;
  }

  /**
   * Derives a code for Nest-generated payloads (validation failures, 404s,
   * bare UnauthorizedException, ...) that carry no `code` field — only
   * `{ statusCode, message, error }`, where `error` is an HTTP-status phrase
   * like `"Bad Request"` or `"Not Found"`. The phrase is converted to
   * SCREAMING_SNAKE_CASE so the result reads as one family with hand-written
   * codes, falling back to `HttpStatus[statusCode]` when Nest's payload is
   * unrecognized.
   *
   * 400s from ValidationPipe (recognizable by `message` being a string[])
   * are given the more specific code `VALIDATION_ERROR` rather than the
   * generic `BAD_REQUEST` shared with hand-thrown 400s that already carry
   * their own specific code.
   */
  private fallbackCode(statusCode: number, payload: unknown): string {
    if (statusCode === HttpStatus.BAD_REQUEST && this.isValidationPipePayload(payload)) {
      return 'VALIDATION_ERROR';
    }

    const phrase = this.errorPhrase(payload);
    if (phrase) {
      return this.shoutingSnakeCase(phrase);
    }

    return HttpStatus[statusCode] ?? 'ERROR';
  }

  private isValidationPipePayload(payload: unknown): boolean {
    return (
      payload !== null &&
      typeof payload === 'object' &&
      Array.isArray((payload as { message?: unknown }).message)
    );
  }

  private errorPhrase(payload: unknown): string | undefined {
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
    ) {
      return (payload as { error: string }).error;
    }
    return undefined;
  }

  private shoutingSnakeCase(phrase: string): string {
    return phrase
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Extracts and flattens the error message to a single string.
   * ValidationPipe's string[] of per-field complaints is joined so callers
   * never need to handle "message is sometimes a string, sometimes an array".
   */
  private extractMessage(payload: unknown): string | undefined {
    if (payload === null || payload === undefined) {
      return undefined;
    }
    if (typeof payload === 'string') {
      return payload;
    }
    if (typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
        return (message as string[]).join('; ');
      }
    }
    return undefined;
  }
}
