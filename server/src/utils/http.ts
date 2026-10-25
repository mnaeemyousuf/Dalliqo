import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forwards rejected promises from async handlers to the error middleware. */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  opts: { message?: string; status?: number; meta?: PageMeta | Record<string, unknown> } = {},
): void {
  res.status(opts.status ?? 200).json({
    success: true,
    data,
    ...(opts.message ? { message: opts.message } : {}),
    ...(opts.meta ? { meta: opts.meta } : {}),
  });
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
