import assert from 'node:assert/strict';
import test from 'node:test';
import { DIFFICULTIES } from '../src/game/difficulties.js';
import {
  applyDigitToNotes,
  clearCellNotes,
  createEmptyNotes,
  hasNote,
  toggleNote,
} from '../src/game/notes.js';
import {
  MAX_UNDO_STACK,
  createUndoSnapshot,
  getElapsedMs,
  normalizeStoredProgress,
  pauseTimer,
  popUndoSnapshot,
  pushUndoSnapshot,
  resumeTimer,
  startTimer,
} from '../src/game/progress.js';
import { analyzePuzzle, generatePuzzle } from '../src/game/sudoku.js';
import { addDaysToDateKey, getPreviousDateKey, getShanghaiDateKey } from '../src/utils/time.js';

test('Shanghai date key uses the requested calendar day', () => {
  const date = new Date('2026-06-27T16:30:00.000Z');
  assert.equal(getShanghaiDateKey(date), '2026-06-28');
});

test('date keys can move across month and year boundaries', () => {
  assert.equal(addDaysToDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysToDateKey('2025-12-31', 1), '2026-01-01');
  assert.equal(getPreviousDateKey('2026-01-01'), '2025-12-31');
});

test('daily puzzle generation is stable for the same date and difficulty', () => {
  const first = generatePuzzle('2026-06-28', 'easy');
  const second = generatePuzzle('2026-06-28', 'easy');

  assert.deepEqual(first.puzzle, second.puzzle);
  assert.deepEqual(first.analysis.solution, second.analysis.solution);
  assert.equal(first.puzzleKey, '2026-06-28:easy');
});

test('different dates produce different puzzles', () => {
  const first = generatePuzzle('2026-06-28', 'easy');
  const second = generatePuzzle('2026-06-29', 'easy');

  assert.notDeepEqual(first.puzzle, second.puzzle);
});

test('all configured difficulties produce unique puzzles inside clue ranges', () => {
  for (const difficulty of DIFFICULTIES) {
    const generated = generatePuzzle('2026-06-28', difficulty.key);
    const analysis = analyzePuzzle(generated.puzzle);
    const clues = generated.puzzle.filter(Boolean).length;

    assert.equal(analysis.unique, true, `${difficulty.key} should be unique`);
    assert.ok(
      clues >= difficulty.clueRange[0] && clues <= difficulty.clueRange[1],
      `${difficulty.key} clue count ${clues} should be within ${difficulty.clueRange.join('-')}`,
    );
    assert.ok(
      analysis.score >= difficulty.scoreRange[0] || generated.generatedByFallback,
      `${difficulty.key} score ${analysis.score} should reach the lower band`,
    );
    assert.ok(
      analysis.score <= difficulty.scoreRange[1] || generated.generatedByFallback,
      `${difficulty.key} score ${analysis.score} should stay under the upper band`,
    );
  }
});

test('note helpers toggle and clear candidate digits', () => {
  let notes = createEmptyNotes();

  notes = toggleNote(notes, 10, 5);
  assert.equal(hasNote(notes[10], 5), true);

  notes = toggleNote(notes, 10, 5);
  assert.equal(hasNote(notes[10], 5), false);

  notes = toggleNote(notes, 10, 3);
  notes = clearCellNotes(notes, 10);
  assert.equal(notes[10], 0);
});

test('applying a digit clears same-unit candidate notes', () => {
  let notes = createEmptyNotes();

  notes = toggleNote(notes, 0, 5);
  notes = toggleNote(notes, 1, 5);
  notes = toggleNote(notes, 9, 5);
  notes = toggleNote(notes, 10, 5);
  notes = toggleNote(notes, 40, 5);

  const next = applyDigitToNotes(notes, 0, 5);

  assert.equal(hasNote(next[0], 5), false);
  assert.equal(hasNote(next[1], 5), false);
  assert.equal(hasNote(next[9], 5), false);
  assert.equal(hasNote(next[10], 5), false);
  assert.equal(hasNote(next[40], 5), true);
});

test('timer helpers pause and resume without counting paused time', () => {
  const started = startTimer(1000);
  assert.equal(getElapsedMs(started, 2500), 1500);

  const paused = pauseTimer(started, 2500);
  assert.equal(paused.accumulatedElapsedMs, 1500);
  assert.equal(paused.isPaused, true);
  assert.equal(getElapsedMs(paused, 8000), 1500);

  const resumed = resumeTimer(paused, 9000);
  assert.equal(resumed.accumulatedElapsedMs, 1500);
  assert.equal(resumed.isPaused, false);
  assert.equal(getElapsedMs(resumed, 9800), 2300);
});

test('undo helpers restore the latest board snapshot and cap history', () => {
  const notes = createEmptyNotes();
  const firstBoard = Array(81).fill(0);
  const secondBoard = Array(81).fill(0);
  secondBoard[10] = 4;

  let undoStack = [];
  undoStack = pushUndoSnapshot(undoStack, createUndoSnapshot(firstBoard, notes, 10));
  undoStack = pushUndoSnapshot(undoStack, createUndoSnapshot(secondBoard, notes, 11));

  const popped = popUndoSnapshot(undoStack);
  assert.equal(popped.snapshot.board[10], 4);
  assert.equal(popped.snapshot.selectedCell, 11);
  assert.equal(popped.undoStack.length, 1);

  undoStack = [];
  for (let index = 0; index < MAX_UNDO_STACK + 12; index += 1) {
    undoStack = pushUndoSnapshot(undoStack, createUndoSnapshot(firstBoard, notes, index % 81));
  }
  assert.equal(undoStack.length, MAX_UNDO_STACK);
});

test('stored progress can migrate legacy v1 payloads and keep paused v2 time frozen', () => {
  const fixedCells = Array(81).fill(0);
  fixedCells[0] = 8;
  const board = [...fixedCells];
  board[10] = 5;

  const legacy = normalizeStoredProgress(
    {
      version: 1,
      puzzleKey: '2026-07-01:easy',
      board,
      notes: createEmptyNotes(),
      hasStarted: true,
      startedAt: 1000,
    },
    '2026-07-01:easy',
    fixedCells,
    5000,
  );

  assert.equal(legacy.runningStartedAt, 1000);
  assert.equal(legacy.accumulatedElapsedMs, 0);
  assert.equal(getElapsedMs(legacy, 5000), 4000);

  const paused = normalizeStoredProgress(
    {
      version: 2,
      puzzleKey: '2026-07-01:easy',
      board,
      notes: createEmptyNotes(),
      hasStarted: true,
      isPaused: true,
      accumulatedElapsedMs: 3200,
      runningStartedAt: null,
      undoStack: [createUndoSnapshot(board, createEmptyNotes(), 10)],
    },
    '2026-07-01:easy',
    fixedCells,
    999999,
  );

  assert.equal(paused.isPaused, true);
  assert.equal(getElapsedMs(paused, 999999), 3200);
  assert.equal(paused.undoStack.length, 1);
});
