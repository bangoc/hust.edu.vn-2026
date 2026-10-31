'use strict';

const { z } = require('zod');
const { InvalidRequestError } = require('../../domain/errors/invalid-request-error');

const loadRequestSchema = z
  .object({
    url: z.string().trim().min(1, 'url không được để trống').max(8192, 'url quá dài'),
    force: z.boolean().optional(),
  })
  .strict();

function parseLoadRequest(body) {
  const parsed = loadRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidRequestError('Body của /load không hợp lệ', {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return {
    url: parsed.data.url,
    force: parsed.data.force ?? false,
  };
}

module.exports = { loadRequestSchema, parseLoadRequest };
