export type MarkdownSyncDecision = 'skip' | 'preserve' | 'replace';

export function resolveMarkdownSyncDecision(input: {
  hasPendingChanges: boolean;
  synchronizedSnapshot: string | null;
  serializedMarkdown: string;
  baselineBlockCount: number;
  fidelityBlockLimit: number;
  fidelityLengthLimit: number;
}): MarkdownSyncDecision {
  if (!input.hasPendingChanges && input.synchronizedSnapshot === input.serializedMarkdown) {
    return 'skip';
  }

  return input.baselineBlockCount <= input.fidelityBlockLimit &&
    input.serializedMarkdown.length <= input.fidelityLengthLimit
    ? 'preserve'
    : 'replace';
}
