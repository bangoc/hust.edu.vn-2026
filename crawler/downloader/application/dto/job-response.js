'use strict';

function toJobResponse(job, { contentRef = null, deduplicated = null } = {}) {
  const result = job.result ?? {};

  return {
    job_id: job.jobId,
    status: job.status,
    url: job.url,
    final_url: result.finalUrl ?? job.error?.finalUrl ?? null,
    url_key: job.urlKey,
    format: result.format ?? null,
    content_type: result.contentType ?? null,
    extension: result.extension ?? null,
    encoding: result.objectKey ? 'ref' : null,
    content_ref: contentRef,
    object_key: result.objectKey ?? null,
    size: result.size ?? null,
    sha256: result.sha256 ?? null,
    http_status: result.httpStatus ?? null,
    fetched_at: result.fetchedAt ?? null,
    deduplicated: deduplicated ?? result.deduplicated ?? false,
    not_modified: result.notModified ?? false,
    auth_required: result.authRequired ?? (job.error?.code === 'auth_required'),
    manifest_invalid: result.manifestInvalid ?? false,
    redownloaded: result.redownloaded ?? false,
    content_changed: result.contentChanged ?? false,
    duplicate_content: result.duplicateContent ?? false,
    forced: result.forced ?? job.force,
    previous_sha256: result.previousSha256 ?? null,
    previous_fetched_at: result.previousFetchedAt ?? null,
    // null: chưa cấu hình READER_URL hoặc job chưa xong; true/false: đã/không chuyển được.
    forwarded: result.forwarded ?? null,
    forward_error: result.forwardError ?? null,
    error: job.error ? { code: job.error.code, message: job.error.message } : null,
  };
}

function toLoadResponse(job, { deduplicated = false } = {}) {
  return {
    job_id: job.jobId,
    status: job.status,
    status_url: `/jobs/${job.jobId}`,
    deduplicated,
  };
}

module.exports = { toJobResponse, toLoadResponse };
