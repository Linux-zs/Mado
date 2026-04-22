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

export function synchronizeMarkdownContent(input: {
  currentContent: string;
  hasPendingChanges: boolean;
  synchronizedSnapshot: string | null;
  serializedMarkdown: string;
  baselineBlockCount: number;
  fidelityBlockLimit: number;
  fidelityLengthLimit: number;
  preserveContent: (serializedMarkdown: string) => string;
}): {
  decision: MarkdownSyncDecision;
  nextContent: string;
} {
  const decision = resolveMarkdownSyncDecision({
    hasPendingChanges: input.hasPendingChanges,
    synchronizedSnapshot: input.synchronizedSnapshot,
    serializedMarkdown: input.serializedMarkdown,
    baselineBlockCount: input.baselineBlockCount,
    fidelityBlockLimit: input.fidelityBlockLimit,
    fidelityLengthLimit: input.fidelityLengthLimit
  });

  if (decision === 'skip') {
    return {
      decision,
      nextContent: input.currentContent
    };
  }

  return {
    decision,
    nextContent:
      decision === 'preserve'
        ? input.preserveContent(input.serializedMarkdown)
        : input.serializedMarkdown
  };
}
