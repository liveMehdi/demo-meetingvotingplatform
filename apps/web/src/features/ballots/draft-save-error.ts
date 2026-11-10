export function draftSaveError(
  error: Error,
  editing: boolean,
  needsRetry: boolean,
) {
  const message = `${error.message} Your entries are still here.`;

  if (needsRetry) {
    return `${message} Retry below to check whether the draft saved.`;
  }

  if (editing && "status" in error && error.status === 409) {
    return `${message} Cancel editing to load the latest version.`;
  }

  return message;
}
