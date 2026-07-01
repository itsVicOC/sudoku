export const PROGRESS_STORAGE_VERSION = 2;
export const MAX_UNDO_STACK = 100;

export function isBoardShape(value) {
  return (
    Array.isArray(value) &&
    value.length === 81 &&
    value.every((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9)
  );
}

function normalizeElapsed(value) {
  const elapsed = Number(value);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function sanitizeSelectedCell(value) {
  return Number.isInteger(value) && value >= 0 && value < 81 ? value : 0;
}

export function sanitizeNotes(value, board, fixedCells) {
  return Array.from({ length: 81 }, (_, index) => {
    if (fixedCells[index] || board[index]) return 0;

    const mask = Array.isArray(value) ? value[index] : 0;
    return Number.isInteger(mask) ? mask & 0x1ff : 0;
  });
}

export function getElapsedMs(timer, now = Date.now()) {
  const accumulatedElapsedMs = normalizeElapsed(timer?.accumulatedElapsedMs) ?? 0;

  if (timer?.isPaused || !Number.isFinite(timer?.runningStartedAt)) {
    return accumulatedElapsedMs;
  }

  return accumulatedElapsedMs + Math.max(0, now - timer.runningStartedAt);
}

export function startTimer(now = Date.now()) {
  return {
    accumulatedElapsedMs: 0,
    isPaused: false,
    runningStartedAt: now,
  };
}

export function pauseTimer(timer, now = Date.now()) {
  return {
    accumulatedElapsedMs: getElapsedMs(timer, now),
    isPaused: true,
    runningStartedAt: null,
  };
}

export function resumeTimer(timer, now = Date.now()) {
  return {
    accumulatedElapsedMs: getElapsedMs(timer, now),
    isPaused: false,
    runningStartedAt: now,
  };
}

export function createUndoSnapshot(board, notes, selectedCell) {
  return {
    board: [...board],
    notes: [...notes],
    selectedCell: sanitizeSelectedCell(selectedCell),
  };
}

export function pushUndoSnapshot(stack, snapshot) {
  const next = [...(Array.isArray(stack) ? stack : []), snapshot];
  return next.slice(-MAX_UNDO_STACK);
}

export function popUndoSnapshot(stack) {
  if (!Array.isArray(stack) || stack.length === 0) {
    return { snapshot: null, undoStack: [] };
  }

  return {
    snapshot: stack[stack.length - 1],
    undoStack: stack.slice(0, -1),
  };
}

function sanitizeUndoStack(value, fixedCells) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((snapshot) => snapshot && isBoardShape(snapshot.board))
    .map((snapshot) => {
      const board = snapshot.board.map((digit, index) =>
        fixedCells[index] ? fixedCells[index] : digit,
      );

      return {
        board,
        notes: sanitizeNotes(snapshot.notes, board, fixedCells),
        selectedCell: sanitizeSelectedCell(snapshot.selectedCell),
      };
    })
    .slice(-MAX_UNDO_STACK);
}

export function normalizeStoredProgress(payload, puzzleKey, fixedCells, now = Date.now()) {
  if (!payload || payload.puzzleKey !== puzzleKey || !isBoardShape(payload.board)) {
    return null;
  }

  if (fixedCells.some((digit, index) => digit && payload.board[index] !== digit)) {
    return null;
  }

  if (payload.hasStarted !== true) return null;

  const board = payload.board.map((digit, index) => (fixedCells[index] ? fixedCells[index] : digit));
  const notes = sanitizeNotes(payload.notes, board, fixedCells);

  if (payload.version === 1) {
    const startedAt = Number(payload.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

    return {
      accumulatedElapsedMs: 0,
      board,
      hasStarted: true,
      isPaused: false,
      notes,
      runningStartedAt: startedAt,
      undoStack: [],
    };
  }

  if (payload.version !== PROGRESS_STORAGE_VERSION) return null;

  const accumulatedElapsedMs = normalizeElapsed(payload.accumulatedElapsedMs);
  if (accumulatedElapsedMs === null) return null;

  const isPaused = payload.isPaused === true;
  const runningStartedAt = isPaused ? null : Number(payload.runningStartedAt);

  if (!isPaused && (!Number.isFinite(runningStartedAt) || runningStartedAt <= 0)) {
    return null;
  }

  return {
    accumulatedElapsedMs,
    board,
    hasStarted: true,
    isPaused,
    notes,
    runningStartedAt,
    undoStack: sanitizeUndoStack(payload.undoStack, fixedCells),
  };
}

export function createProgressPayload(puzzleKey, progress) {
  return {
    version: PROGRESS_STORAGE_VERSION,
    puzzleKey,
    board: progress.board,
    notes: progress.notes,
    hasStarted: progress.hasStarted,
    isPaused: progress.isPaused,
    accumulatedElapsedMs: progress.accumulatedElapsedMs,
    runningStartedAt: progress.runningStartedAt,
    undoStack: progress.undoStack,
  };
}
