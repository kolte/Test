import { ArgumentsHost, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

/**
 * Minimal stand-ins for the bits of `ArgumentsHost`/`Response`/`Request`
 * the filter actually touches (`switchToHttp().getResponse/getRequest`,
 * `response.status(...).json(...)`, `request.method`/`.url`) — same
 * "fake just enough of the interface" approach as the `FakePrisma`s
 * elsewhere in this codebase, just for Express's HTTP types instead of
 * Prisma's.
 */
function makeHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const request = { method: 'POST', url: '/desktop/work/start' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter (#28)', () => {
  let filter: AllExceptionsFilter;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // The filter logs unexpected (non-HttpException) crashes server-side -
    // silence + spy on it so the test output stays clean and we can assert
    // it actually fired without it polluting stderr.
    loggerErrorSpy = jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('passes a hand-thrown { code, message } domain exception through verbatim, adding statusCode', () => {
    const { host, status, json } = makeHost();

    filter.catch(
      new NotFoundException({ code: 'WORK_SESSION_NOT_FOUND', message: 'No matching work session was found for this account.' }),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'WORK_SESSION_NOT_FOUND',
      message: 'No matching work session was found for this account.',
    });
  });

  it('preserves codes from every HTTP family already in use (401 auth, 400 domain 400s)', () => {
    const { host: authHost, json: authJson } = makeHost();
    filter.catch(new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }), authHost);
    expect(authJson).toHaveBeenCalledWith({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });

    const { host: actionHost, json: actionJson } = makeHost();
    filter.catch(
      new BadRequestException({ code: 'ACTION_MISSING_SESSION_REFERENCE', message: 'Request must include sessionId or clientSessionId.' }),
      actionHost,
    );
    expect(actionJson).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'ACTION_MISSING_SESSION_REFERENCE',
      message: 'Request must include sessionId or clientSessionId.',
    });
  });

  it('codes ValidationPipe rejections as VALIDATION_ERROR and joins the per-field message array into one string', () => {
    const { host, status, json } = makeHost();

    // This is exactly the shape Nest's ValidationPipe throws: a
    // BadRequestException whose response is { statusCode, message: string[], error }.
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['email must be an email', 'password should not be empty'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'email must be an email; password should not be empty',
    });
  });

  it('derives a SCREAMING_SNAKE_CASE code from the HTTP-status phrase for un-coded Nest exceptions (e.g. an unmapped route)', () => {
    const { host, status, json } = makeHost();

    // What Nest sends for a request to a route nothing handles.
    filter.catch(new NotFoundException({ statusCode: 404, message: 'Cannot GET /desktop/nonexistent', error: 'Not Found' }), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Cannot GET /desktop/nonexistent',
    });
  });

  it('handles a bare-string HttpException (no object payload at all)', () => {
    const { host, status, json } = makeHost();

    filter.catch(new UnauthorizedException('Unauthorized'), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });
  });

  it('masks an unexpected (non-HttpException) crash behind a generic 500 INTERNAL_SERVER_ERROR body and logs the real cause', () => {
    const { host, status, json } = makeHost();

    filter.catch(new Error('Connection terminated unexpectedly (raw Prisma/pg error)'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
    // The real message must never reach the client - only the log.
    expect(json).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Prisma') }));
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Connection terminated unexpectedly'),
      expect.any(String),
    );
  });

  it('also masks non-Error thrown values (e.g. a thrown string/object) behind the same generic 500 body', () => {
    const { host, status, json } = makeHost();

    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    filter.catch('a thrown string, not an Error', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  });
});
