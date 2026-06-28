import assert from 'node:assert/strict';
import test from 'node:test';
import { DIFFICULTIES } from '../src/game/difficulties.js';
import { analyzePuzzle, generatePuzzle } from '../src/game/sudoku.js';
import { getShanghaiDateKey } from '../src/utils/time.js';

test('Shanghai date key uses the requested calendar day', () => {
  const date = new Date('2026-06-27T16:30:00.000Z');
  assert.equal(getShanghaiDateKey(date), '2026-06-28');
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
