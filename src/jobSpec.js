const ALLOWED_LANGUAGES = ['ja', 'en'];

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function validateJob(job) {
  const errors = [];
  if (!job || typeof job !== 'object') {
    return { ok: false, errors: ['job payload must be an object'] };
  }

  if (!isString(job.job_type)) {
    errors.push('job_type must be a non-empty string');
  }
  if (!isString(job.goal)) {
    errors.push('goal must be a non-empty string');
  }
  if (!job.inputs || typeof job.inputs !== 'object') {
    errors.push('inputs must be an object');
  }
  if (!job.constraints || typeof job.constraints !== 'object') {
    errors.push('constraints must be an object');
  }
  if (!Array.isArray(job.acceptance_criteria) || job.acceptance_criteria.length === 0) {
    errors.push('acceptance_criteria must be a non-empty array');
  }
  if (!job.provenance || typeof job.provenance !== 'object') {
    errors.push('provenance must be an object');
  }
  if (!isString(job.run_mode)) {
    errors.push('run_mode must be a non-empty string');
  }
  if (!Array.isArray(job.expected_artifacts) || job.expected_artifacts.length === 0) {
    errors.push('expected_artifacts must be a non-empty array');
  }

  if (job.inputs) {
    if (!isString(job.inputs.message)) {
      errors.push('inputs.message must be a non-empty string');
    }
    if (!isString(job.inputs.target_path)) {
      errors.push('inputs.target_path must be a non-empty string');
    }
  }

  if (job.constraints) {
    if (!isStringArray(job.constraints.allowed_paths) || job.constraints.allowed_paths.length === 0) {
      errors.push('constraints.allowed_paths must be a non-empty array of strings');
    }
    if (typeof job.constraints.max_files_changed !== 'number') {
      errors.push('constraints.max_files_changed must be a number');
    }
    if (typeof job.constraints.no_destructive_ops !== 'boolean') {
      errors.push('constraints.no_destructive_ops must be a boolean');
    }
  }

  const language = isString(job.output_language) ? job.output_language.toLowerCase() : '';
  if (!ALLOWED_LANGUAGES.includes(language)) {
    errors.push('output_language must be "ja" or "en"');
  }

  if (job.job_type === 'integration_hub.phase2.docs_update') {
    if (!isString(job.inputs.doc_path)) {
      errors.push('docs_update requires inputs.doc_path');
    }
    if (!isString(job.inputs.instruction)) {
      errors.push('docs_update requires inputs.instruction');
    }
  }

  if (job.job_type === 'integration_hub.phase2.repo_patch') {
    if (!isString(job.inputs.instruction)) {
      errors.push('repo_patch requires inputs.instruction');
    }
    if (!isStringArray(job.inputs.allowed_paths) || job.inputs.allowed_paths.length === 0) {
      errors.push('repo_patch requires inputs.allowed_paths array');
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateJob,
  ALLOWED_LANGUAGES
};
