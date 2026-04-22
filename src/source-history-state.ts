export type SourceHistorySnapshot = {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
};

export type SourceHistoryState = {
  snapshot: SourceHistorySnapshot;
  undoStack: SourceHistorySnapshot[];
  redoStack: SourceHistorySnapshot[];
};

export function createSourceHistoryState(snapshot: SourceHistorySnapshot): SourceHistoryState {
  return {
    snapshot,
    undoStack: [],
    redoStack: []
  };
}

function trimSnapshotStack(
  stack: SourceHistorySnapshot[],
  limit: number
): SourceHistorySnapshot[] {
  if (stack.length <= limit) {
    return stack;
  }

  return stack.slice(stack.length - limit);
}

export function recordSourceHistorySnapshot(
  state: SourceHistoryState,
  nextSnapshot: SourceHistorySnapshot,
  limit: number
): SourceHistoryState {
  if (state.snapshot.content === nextSnapshot.content) {
    return state;
  }

  return {
    snapshot: nextSnapshot,
    undoStack: trimSnapshotStack([...state.undoStack, state.snapshot], limit),
    redoStack: []
  };
}

export function stepSourceHistoryState(
  state: SourceHistoryState,
  direction: 'undo' | 'redo',
  limit: number
): { state: SourceHistoryState; snapshot: SourceHistorySnapshot | null } {
  if (direction === 'undo') {
    const nextSnapshot = state.undoStack.at(-1) ?? null;

    if (!nextSnapshot) {
      return { state, snapshot: null };
    }

    return {
      snapshot: nextSnapshot,
      state: {
        snapshot: nextSnapshot,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: trimSnapshotStack([...state.redoStack, state.snapshot], limit)
      }
    };
  }

  const nextSnapshot = state.redoStack.at(-1) ?? null;

  if (!nextSnapshot) {
    return { state, snapshot: null };
  }

  return {
    snapshot: nextSnapshot,
    state: {
      snapshot: nextSnapshot,
      undoStack: trimSnapshotStack([...state.undoStack, state.snapshot], limit),
      redoStack: state.redoStack.slice(0, -1)
    }
  };
}
