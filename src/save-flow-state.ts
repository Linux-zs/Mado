export type SaveOperationKind = 'save' | 'saveAs';

export type SaveFlowDecision = {
  adoptsSavedDocument: boolean;
  syncsSavedFileIntoCurrentDirectory: boolean;
};

export function resolveSaveFlowDecision(input: {
  operation: SaveOperationKind;
  isUntitled: boolean;
  activeFilePath: string | null;
  currentDirectoryPath: string | null;
  savedDirectoryPath: string;
}): SaveFlowDecision {
  return {
    adoptsSavedDocument:
      input.operation === 'save' || input.isUntitled || input.activeFilePath === null,
    syncsSavedFileIntoCurrentDirectory:
      input.currentDirectoryPath !== null && input.currentDirectoryPath === input.savedDirectoryPath
  };
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === 'string' && error.length > 0 ? error : fallback;
}
