export type DirectoryRefreshCommitResult = {
  nextCurrentDirectoryPath: string | null;
  shouldPersistCurrentDirectoryPath: boolean;
};

export function resolveDirectoryRefreshCommit(input: {
  previousCurrentDirectoryPath: string | null;
  nextDirectoryPath: string | null;
  outcome: 'clear' | 'success' | 'failure';
}): DirectoryRefreshCommitResult {
  if (input.outcome === 'clear') {
    return {
      nextCurrentDirectoryPath: null,
      shouldPersistCurrentDirectoryPath: true
    };
  }

  if (input.outcome === 'success') {
    return {
      nextCurrentDirectoryPath: input.nextDirectoryPath,
      shouldPersistCurrentDirectoryPath: true
    };
  }

  return {
    nextCurrentDirectoryPath: input.previousCurrentDirectoryPath,
    shouldPersistCurrentDirectoryPath: false
  };
}
