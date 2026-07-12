import { DIFFICULTY_BY_KEY } from './difficulties.js';
import { createPrng, shuffle } from './prng.js';

const SIZE = 9;
const CELL_COUNT = 81;
const ALL_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ALL_MASK = 0b1111111110;
const MAX_GENERATION_SECONDS = 7;

const ROW_UNITS = Array.from({ length: SIZE }, (_, row) =>
  Array.from({ length: SIZE }, (_, col) => row * SIZE + col),
);
const COL_UNITS = Array.from({ length: SIZE }, (_, col) =>
  Array.from({ length: SIZE }, (_, row) => row * SIZE + col),
);
const BOX_UNITS = Array.from({ length: SIZE }, (_, box) => {
  const top = Math.floor(box / 3) * 3;
  const left = (box % 3) * 3;

  return Array.from({ length: SIZE }, (_, index) => {
    const row = top + Math.floor(index / 3);
    const col = left + (index % 3);
    return row * SIZE + col;
  });
});

const UNITS = [...ROW_UNITS, ...COL_UNITS, ...BOX_UNITS];
const CELL_UNITS = Array.from({ length: CELL_COUNT }, (_, cell) =>
  UNITS.filter((unit) => unit.includes(cell)),
);
const PEERS = Array.from({ length: CELL_COUNT }, (_, cell) => {
  const peers = new Set();

  for (const unit of CELL_UNITS[cell]) {
    for (const peer of unit) {
      if (peer !== cell) peers.add(peer);
    }
  }

  return [...peers];
});

function rowOf(cell) {
  return Math.floor(cell / SIZE);
}

function colOf(cell) {
  return cell % SIZE;
}

function boxOf(cell) {
  return Math.floor(rowOf(cell) / 3) * 3 + Math.floor(colOf(cell) / 3);
}

function bitForDigit(digit) {
  return 1 << digit;
}

function maskToDigits(mask) {
  const digits = [];

  for (let digit = 1; digit <= 9; digit += 1) {
    if (mask & bitForDigit(digit)) digits.push(digit);
  }

  return digits;
}

function bitCount(mask) {
  let count = 0;
  let value = mask;

  while (value) {
    value &= value - 1;
    count += 1;
  }

  return count;
}

function usedMask(board, cell) {
  let mask = 0;

  for (const peer of PEERS[cell]) {
    const digit = board[peer];
    if (digit) mask |= bitForDigit(digit);
  }

  return mask;
}

function candidateMask(board, cell) {
  if (board[cell]) return 0;
  return ALL_MASK & ~usedMask(board, cell);
}

export function getCandidates(board, cell) {
  return maskToDigits(candidateMask(board, cell));
}

export function isBoardComplete(board) {
  return board.every(Boolean) && isValidBoard(board);
}

export function isValidBoard(board) {
  return UNITS.every((unit) => {
    const seen = new Set();

    for (const cell of unit) {
      const digit = board[cell];
      if (!digit) continue;
      if (seen.has(digit)) return false;
      seen.add(digit);
    }

    return true;
  });
}

export function getConflictCells(board) {
  const conflicts = new Set();

  for (const unit of UNITS) {
    const cellsByDigit = new Map();

    for (const cell of unit) {
      const digit = board[cell];
      if (!digit) continue;

      const cells = cellsByDigit.get(digit) ?? [];
      cells.push(cell);
      cellsByDigit.set(digit, cells);
    }

    for (const cells of cellsByDigit.values()) {
      if (cells.length > 1) {
        cells.forEach((cell) => conflicts.add(cell));
      }
    }
  }

  return conflicts;
}

function chooseEmptyCell(board) {
  let bestCell = -1;
  let bestMask = 0;
  let bestCount = 10;

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (board[cell]) continue;

    const mask = candidateMask(board, cell);
    const count = bitCount(mask);

    if (count === 0) return { cell, mask, count };
    if (count < bestCount) {
      bestCell = cell;
      bestMask = mask;
      bestCount = count;
    }
  }

  return { cell: bestCell, mask: bestMask, count: bestCount };
}

function fillSolvedBoard(board, random) {
  const { cell, mask, count } = chooseEmptyCell(board);
  if (cell === -1) return true;
  if (count === 0) return false;

  for (const digit of shuffle(maskToDigits(mask), random)) {
    board[cell] = digit;
    if (fillSolvedBoard(board, random)) return true;
    board[cell] = 0;
  }

  return false;
}

export function generateSolvedBoard(seed) {
  const random = createPrng(`${seed}:solution`);
  const board = Array(CELL_COUNT).fill(0);

  fillSolvedBoard(board, random);
  return board;
}

function countSolutionsRecursive(board, limit, random, state) {
  if (state.count >= limit) return;

  const { cell, mask, count } = chooseEmptyCell(board);
  if (cell === -1) {
    state.count += 1;
    state.solution = [...board];
    return;
  }
  if (count === 0) return;

  const digits = random ? shuffle(maskToDigits(mask), random) : maskToDigits(mask);

  for (const digit of digits) {
    board[cell] = digit;
    countSolutionsRecursive(board, limit, random, state);
    board[cell] = 0;
    if (state.count >= limit) return;
  }
}

export function countSolutions(board, limit = 2, seed = '') {
  const copy = [...board];
  const state = { count: 0, solution: null };
  const random = seed ? createPrng(`${seed}:count`) : null;

  if (!isValidBoard(copy)) return state;
  countSolutionsRecursive(copy, limit, random, state);
  return state;
}

function computeCandidateMasks(board) {
  return Array.from({ length: CELL_COUNT }, (_, cell) => candidateMask(board, cell));
}

function assignDigit(board, cell, digit) {
  board[cell] = digit;
}

function applyNakedSingles(board) {
  const masks = computeCandidateMasks(board);
  const fills = [];

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (board[cell]) continue;
    const mask = masks[cell];
    if (bitCount(mask) === 1) {
      fills.push([cell, maskToDigits(mask)[0]]);
    }
  }

  for (const [cell, digit] of fills) assignDigit(board, cell, digit);
  return fills.length;
}

function applyHiddenSingles(board) {
  const masks = computeCandidateMasks(board);
  const fills = new Map();

  for (const unit of UNITS) {
    for (const digit of ALL_DIGITS) {
      const bit = bitForDigit(digit);
      const cells = unit.filter((cell) => !board[cell] && (masks[cell] & bit));

      if (cells.length === 1) fills.set(cells[0], digit);
    }
  }

  for (const [cell, digit] of fills) assignDigit(board, cell, digit);
  return fills.size;
}

function eliminateNakedSets(board, size) {
  const masks = computeCandidateMasks(board);
  let eliminations = 0;

  for (const unit of UNITS) {
    const groups = new Map();

    for (const cell of unit) {
      if (board[cell]) continue;
      const mask = masks[cell];
      const count = bitCount(mask);
      if (count >= 2 && count <= size) {
        const key = String(mask);
        const cells = groups.get(key) || [];
        cells.push(cell);
        groups.set(key, cells);
      }
    }

    for (const [maskKey, cells] of groups) {
      const mask = Number(maskKey);
      if (cells.length !== size || bitCount(mask) !== size) continue;

      for (const cell of unit) {
        if (board[cell] || cells.includes(cell)) continue;
        const overlap = masks[cell] & mask;
        if (overlap) {
          masks[cell] &= ~mask;
          eliminations += bitCount(overlap);
        }
      }
    }
  }

  return eliminations;
}

function eliminatePointingPairs(board) {
  const masks = computeCandidateMasks(board);
  let eliminations = 0;

  for (let box = 0; box < SIZE; box += 1) {
    const boxCells = BOX_UNITS[box];

    for (const digit of ALL_DIGITS) {
      const bit = bitForDigit(digit);
      const cells = boxCells.filter((cell) => !board[cell] && (masks[cell] & bit));
      if (cells.length < 2) continue;

      const rows = new Set(cells.map(rowOf));
      const cols = new Set(cells.map(colOf));

      if (rows.size === 1) {
        const row = [...rows][0];
        for (const cell of ROW_UNITS[row]) {
          if (boxOf(cell) !== box && !board[cell] && (masks[cell] & bit)) {
            masks[cell] &= ~bit;
            eliminations += 1;
          }
        }
      }

      if (cols.size === 1) {
        const col = [...cols][0];
        for (const cell of COL_UNITS[col]) {
          if (boxOf(cell) !== box && !board[cell] && (masks[cell] & bit)) {
            masks[cell] &= ~bit;
            eliminations += 1;
          }
        }
      }
    }
  }

  return eliminations;
}

function logicalScore(board) {
  const working = [...board];
  let score = 0;
  let iterations = 0;
  let progress = true;

  while (progress && !isBoardComplete(working) && iterations < 200) {
    iterations += 1;
    progress = false;

    const nakedSingles = applyNakedSingles(working);
    if (nakedSingles) {
      score += nakedSingles * 1;
      progress = true;
      continue;
    }

    const hiddenSingles = applyHiddenSingles(working);
    if (hiddenSingles) {
      score += hiddenSingles * 3;
      progress = true;
    }
  }

  const patternScore =
    eliminateNakedSets(working, 2) * 7 +
    eliminateNakedSets(working, 3) * 11 +
    eliminatePointingPairs(working) * 10;

  return {
    board: working,
    score: score + patternScore,
    solved: isBoardComplete(working),
    remaining: working.filter((digit) => !digit).length,
  };
}

function searchDifficulty(board, depth = 0, state = { nodes: 0, maxDepth: 0, solved: false }) {
  if (state.nodes > 5000) return state;

  const { cell, mask, count } = chooseEmptyCell(board);
  if (cell === -1) {
    state.solved = true;
    state.maxDepth = Math.max(state.maxDepth, depth);
    return state;
  }
  if (count === 0) return state;

  state.nodes += 1;
  state.maxDepth = Math.max(state.maxDepth, depth + 1);

  for (const digit of maskToDigits(mask)) {
    board[cell] = digit;
    searchDifficulty(board, depth + 1, state);
    board[cell] = 0;
    if (state.solved || state.nodes > 5000) break;
  }

  return state;
}

export function analyzePuzzle(board) {
  const solutionState = countSolutions(board, 2);
  if (solutionState.count !== 1) {
    return {
      unique: false,
      solvedByLogic: false,
      score: Number.POSITIVE_INFINITY,
      searchDepth: Number.POSITIVE_INFINITY,
      searchNodes: Number.POSITIVE_INFINITY,
      solution: null,
    };
  }

  const logical = logicalScore(board);
  const search = logical.solved
    ? { nodes: 0, maxDepth: 0, solved: true }
    : searchDifficulty([...logical.board]);
  const emptyCells = board.filter((digit) => !digit).length;
  const candidateMasks = computeCandidateMasks(board).filter((mask, index) => !board[index] && mask);
  const candidatePressure =
    candidateMasks.reduce((total, mask) => total + bitCount(mask), 0) /
    Math.max(1, candidateMasks.length);
  const clueScarcity = Math.pow(emptyCells, 1.42);
  const branchPenalty = search.nodes * 18 + search.maxDepth * 70 + logical.remaining * 4;

  return {
    unique: true,
    solvedByLogic: logical.solved,
    score: Math.round(logical.score + clueScarcity + candidatePressure * 14 + branchPenalty),
    searchDepth: search.maxDepth,
    searchNodes: search.nodes,
    solution: solutionState.solution,
  };
}

function inRange(value, [min, max]) {
  return value >= min && value <= max;
}

function meetsDifficulty(analysis, puzzle, difficulty) {
  const clues = puzzle.filter(Boolean).length;

  if (!analysis.unique) return false;
  if (!inRange(clues, difficulty.clueRange)) return false;
  if (!inRange(analysis.score, difficulty.scoreRange)) return false;
  if (difficulty.requireSearch && analysis.searchDepth < 1) return false;
  if (!difficulty.requireSearch && analysis.searchDepth > difficulty.maxSearchDepth) return false;
  if (analysis.searchDepth > difficulty.maxSearchDepth) return false;
  return true;
}

function carvePuzzle(solution, difficulty, seed) {
  const random = createPrng(`${seed}:carve`);
  const board = [...solution];
  const cells = shuffle(Array.from({ length: CELL_COUNT }, (_, index) => index), random);
  let clues = CELL_COUNT;
  let best = null;

  for (const cell of cells) {
    if (clues <= difficulty.targetClues) break;

    const previous = board[cell];
    board[cell] = 0;

    const state = countSolutions(board, 2, `${seed}:unique:${cell}`);
    if (state.count !== 1) {
      board[cell] = previous;
      continue;
    }

    clues -= 1;
    const analysis = analyzePuzzle(board);
    best = { puzzle: [...board], analysis };
  }

  if (best) return best;

  return {
    puzzle: board,
    analysis: analyzePuzzle(board),
  };
}

function fallbackPuzzle(solution, difficulty, seed) {
  const random = createPrng(`${seed}:fallback`);
  const board = [...solution];
  const cells = shuffle(Array.from({ length: CELL_COUNT }, (_, index) => index), random);
  const minimumClues = difficulty.clueRange[0];
  let clues = CELL_COUNT;
  let lastUnique = null;

  for (const cell of cells) {
    if (clues <= minimumClues) break;
    const previous = board[cell];
    board[cell] = 0;
    const analysis = analyzePuzzle(board);

    if (!analysis.unique) {
      board[cell] = previous;
      continue;
    }

    clues -= 1;
    lastUnique = { puzzle: [...board], analysis };
  }

  return lastUnique || { puzzle: board, analysis: analyzePuzzle(board) };
}

export function generatePuzzle(dateKey, difficultyKey) {
  const difficulty = DIFFICULTY_BY_KEY[difficultyKey];
  if (!difficulty) throw new Error(`Unknown difficulty: ${difficultyKey}`);

  const start = typeof performance === 'undefined' ? Date.now() : performance.now();
  let best = null;

  for (let attempt = 0; attempt < difficulty.attempts; attempt += 1) {
    const seed = `${dateKey}:${difficulty.key}:${attempt}`;
    const solution = generateSolvedBoard(seed);
    const candidate = carvePuzzle(solution, difficulty, seed);
    const elapsed =
      (typeof performance === 'undefined' ? Date.now() : performance.now()) - start;

    if (meetsDifficulty(candidate.analysis, candidate.puzzle, difficulty)) {
      return {
        ...candidate,
        difficulty: difficulty.key,
        puzzleKey: `${dateKey}:${difficulty.key}`,
        seed,
        generatedByFallback: false,
      };
    }

    if (
      candidate.analysis.unique &&
      inRange(candidate.puzzle.filter(Boolean).length, difficulty.clueRange) &&
      (!best || Math.abs(candidate.analysis.score - difficulty.scoreRange[0]) < Math.abs(best.analysis.score - difficulty.scoreRange[0]))
    ) {
      best = candidate;
    }

    if (elapsed > MAX_GENERATION_SECONDS * 1000 && best) break;
  }

  const seed = `${dateKey}:${difficulty.key}:stable-fallback`;
  const solution = generateSolvedBoard(seed);
  const fallback = best || fallbackPuzzle(solution, difficulty, seed);

  return {
    ...fallback,
    difficulty: difficulty.key,
    puzzleKey: `${dateKey}:${difficulty.key}`,
    seed,
    generatedByFallback: true,
  };
}

export function formatBoard(board) {
  return board
    .map((digit, index) => {
      const value = digit || '.';
      return (index + 1) % 9 === 0 ? `${value}\n` : String(value);
    })
    .join('');
}
