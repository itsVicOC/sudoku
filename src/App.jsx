import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Clock3,
  Eraser,
  Loader2,
  Medal,
  Pause,
  PencilLine,
  Play,
  RefreshCw,
  Trophy,
  Undo2,
  WifiOff,
} from 'lucide-react';
import { DIFFICULTIES, DIFFICULTY_BY_KEY } from './game/difficulties.js';
import {
  applyDigitToNotes,
  clearCellNotes,
  createEmptyNotes,
  getNoteDigits,
  hasNote,
  toggleNote,
} from './game/notes.js';
import {
  createProgressPayload,
  createUndoSnapshot,
  getElapsedMs,
  normalizeStoredProgress,
  pauseTimer,
  popUndoSnapshot,
  pushUndoSnapshot,
  resumeTimer,
  startTimer,
} from './game/progress.js';
import { generatePuzzle, isBoardComplete, isValidBoard } from './game/sudoku.js';
import {
  fetchLeaderboard,
  hasLeaderboardConfig,
  submitScore,
} from './services/leaderboard.js';
import { formatDuration, getPreviousDateKey, getShanghaiDateKey } from './utils/time.js';

const EMPTY_BOARD = Array(81).fill(0);
const PROGRESS_STORAGE_PREFIX = 'daily-sudoku-progress:';

function sameHouse(a, b) {
  if (a < 0 || b < 0) return false;
  const rowA = Math.floor(a / 9);
  const rowB = Math.floor(b / 9);
  const colA = a % 9;
  const colB = b % 9;
  const boxA = Math.floor(rowA / 3) * 3 + Math.floor(colA / 3);
  const boxB = Math.floor(rowB / 3) * 3 + Math.floor(colB / 3);
  return rowA === rowB || colA === colB || boxA === boxB;
}

function findFirstEditable(puzzle) {
  const index = puzzle.findIndex((value) => value === 0);
  return index === -1 ? 0 : index;
}

function hasConflicts(board) {
  const units = [];

  for (let index = 0; index < 9; index += 1) {
    units.push(Array.from({ length: 9 }, (_, col) => index * 9 + col));
    units.push(Array.from({ length: 9 }, (_, row) => row * 9 + index));
  }

  for (let box = 0; box < 9; box += 1) {
    const top = Math.floor(box / 3) * 3;
    const left = (box % 3) * 3;
    units.push(
      Array.from({ length: 9 }, (_, offset) => {
        const row = top + Math.floor(offset / 3);
        const col = left + (offset % 3);
        return row * 9 + col;
      }),
    );
  }

  return units.some((unit) => {
    const seen = new Set();

    for (const cell of unit) {
      const digit = board[cell];
      if (!digit) continue;
      if (seen.has(digit)) return true;
      seen.add(digit);
    }

    return false;
  });
}

function isSolved(board, solution) {
  return board.every((digit, index) => digit === solution[index]);
}

function normalizePlayerId(value) {
  return value.trim().slice(0, 16);
}

function getProgressStorageKey(puzzleKey) {
  return `${PROGRESS_STORAGE_PREFIX}${puzzleKey}`;
}

function readStoredProgress(puzzleKey, fixedCells) {
  try {
    const raw = window.localStorage.getItem(getProgressStorageKey(puzzleKey));
    if (!raw) return null;

    const payload = JSON.parse(raw);
    return normalizeStoredProgress(payload, puzzleKey, fixedCells);
  } catch {
    return null;
  }
}

function saveStoredProgress(puzzleKey, progress) {
  try {
    window.localStorage.setItem(
      getProgressStorageKey(puzzleKey),
      JSON.stringify(createProgressPayload(puzzleKey, progress)),
    );
  } catch {
    // Ignore private browsing or quota failures; the game still works without persistence.
  }
}

function clearStoredProgress(puzzleKey) {
  try {
    window.localStorage.removeItem(getProgressStorageKey(puzzleKey));
  } catch {
    // Ignore storage failures.
  }
}

function LeaderboardContent({ configured, emptyMessage, error, rows, status }) {
  if (!configured) return null;

  if (status === 'loading') {
    return (
      <div className="loading-list">
        <Loader2 size={18} aria-hidden="true" />
        <span>读取排行榜...</span>
      </div>
    );
  }

  if (status === 'error') {
    return <div className="notice danger">{error}</div>;
  }

  if (status === 'ready' && rows.length === 0) {
    return <div className="empty-list">{emptyMessage}</div>;
  }

  if (rows.length > 0) {
    return (
      <ol className="leaderboard-list">
        {rows.map((row, index) => (
          <li className="leaderboard-row" key={`${row.rank}-${row.player_id}-${row.time_ms}`}>
            <span className={index < 3 ? 'rank podium' : 'rank'}>
              {index < 3 ? <Medal size={16} aria-hidden="true" /> : row.rank}
            </span>
            <span className="player-id">{row.player_id}</span>
            <span className="score-time">{formatDuration(row.time_ms)}</span>
          </li>
        ))}
      </ol>
    );
  }

  return null;
}

export default function App() {
  const dateKey = useMemo(() => getShanghaiDateKey(), []);
  const maxHistoryDateKey = useMemo(() => getPreviousDateKey(dateKey), [dateKey]);
  const [difficultyKey, setDifficultyKey] = useState('easy');
  const [gameNonce, setGameNonce] = useState(0);
  const [isGenerating, setIsGenerating] = useState(true);
  const [puzzleData, setPuzzleData] = useState(null);
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [notes, setNotes] = useState(() => createEmptyNotes());
  const [noteMode, setNoteMode] = useState(false);
  const [selectedCell, setSelectedCell] = useState(0);
  const [runningStartedAt, setRunningStartedAt] = useState(null);
  const [accumulatedElapsedMs, setAccumulatedElapsedMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [hasStarted, setHasStarted] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finishedMs, setFinishedMs] = useState(null);
  const [message, setMessage] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState('loading');
  const [leaderboardError, setLeaderboardError] = useState('');
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [playerId, setPlayerId] = useState('');
  const [submitStatus, setSubmitStatus] = useState('idle');
  const [submitError, setSubmitError] = useState('');
  const [historyDateKey, setHistoryDateKey] = useState(maxHistoryDateKey);
  const [historyLeaderboard, setHistoryLeaderboard] = useState([]);
  const [historyLeaderboardStatus, setHistoryLeaderboardStatus] = useState('loading');
  const [historyLeaderboardError, setHistoryLeaderboardError] = useState('');

  const difficulty = DIFFICULTY_BY_KEY[difficultyKey];
  const fixedCells = puzzleData?.puzzle ?? EMPTY_BOARD;
  const solution = puzzleData?.analysis.solution ?? EMPTY_BOARD;
  const puzzleKey = puzzleData?.puzzleKey ?? `${dateKey}:${difficultyKey}`;
  const historyPuzzleKey = `${historyDateKey}:${difficultyKey}`;
  const isReadyToStart = Boolean(puzzleData) && !isGenerating && !hasStarted && finishedMs === null;
  const isGameActive = hasStarted && finishedMs === null && !isGenerating;
  const canPlay = isGameActive && !isPaused;
  const canTogglePause = isGameActive;
  const canUndo = canPlay && undoStack.length > 0;
  const canShowPuzzle = hasStarted || finishedMs !== null;
  const displayedTime = finishedMs ?? (hasStarted ? elapsedMs : 0);
  const configured = hasLeaderboardConfig();

  const loadLeaderboard = useCallback(async () => {
    if (!configured || !puzzleData) {
      setLeaderboardStatus(configured ? 'idle' : 'missing-config');
      setLeaderboard([]);
      return;
    }

    setLeaderboardStatus('loading');
    setLeaderboardError('');

    try {
      const rows = await fetchLeaderboard(difficultyKey, puzzleData.puzzleKey);
      setLeaderboard(Array.isArray(rows) ? rows : []);
      setLeaderboardStatus('ready');
    } catch (error) {
      setLeaderboard([]);
      setLeaderboardError(error instanceof Error ? error.message : '排行榜读取失败。');
      setLeaderboardStatus('error');
    }
  }, [configured, difficultyKey, puzzleData]);

  const loadHistoryLeaderboard = useCallback(async () => {
    if (!configured) {
      setHistoryLeaderboardStatus('missing-config');
      setHistoryLeaderboard([]);
      return;
    }

    setHistoryLeaderboardStatus('loading');
    setHistoryLeaderboardError('');

    try {
      const rows = await fetchLeaderboard(difficultyKey, historyPuzzleKey);
      setHistoryLeaderboard(Array.isArray(rows) ? rows : []);
      setHistoryLeaderboardStatus('ready');
    } catch (error) {
      setHistoryLeaderboard([]);
      setHistoryLeaderboardError(error instanceof Error ? error.message : '历史榜单读取失败。');
      setHistoryLeaderboardStatus('error');
    }
  }, [configured, difficultyKey, historyPuzzleKey]);

  useEffect(() => {
    let cancelled = false;
    setIsGenerating(true);
    setMessage('正在生成今日题目...');

    const timer = window.setTimeout(() => {
      const generated = generatePuzzle(dateKey, difficultyKey);

      if (cancelled) return;

      const savedProgress = readStoredProgress(generated.puzzleKey, generated.puzzle);

      setPuzzleData(generated);
      setBoard(savedProgress?.board ?? [...generated.puzzle]);
      setNotes(savedProgress?.notes ?? createEmptyNotes());
      setSelectedCell(findFirstEditable(generated.puzzle));
      setRunningStartedAt(savedProgress?.runningStartedAt ?? null);
      setAccumulatedElapsedMs(savedProgress?.accumulatedElapsedMs ?? 0);
      setIsPaused(Boolean(savedProgress?.isPaused));
      setUndoStack(savedProgress?.undoStack ?? []);
      setHasStarted(Boolean(savedProgress));
      setElapsedMs(savedProgress ? getElapsedMs(savedProgress) : 0);
      setFinishedMs(null);
      setMessage(
        savedProgress
          ? savedProgress.isPaused
            ? '已恢复暂停中的进度。'
            : '已恢复未完成进度。'
          : '题目已就绪。',
      );
      setIsGenerating(false);
      setNoteMode(false);
      setIsSubmitOpen(false);
      setSubmitStatus('idle');
      setSubmitError('');
    }, 30);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dateKey, difficultyKey, gameNonce]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    loadHistoryLeaderboard();
  }, [loadHistoryLeaderboard]);

  useEffect(() => {
    if (
      !puzzleData ||
      !hasStarted ||
      finishedMs !== null ||
      isGenerating ||
      isPaused ||
      runningStartedAt === null
    ) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setElapsedMs(getElapsedMs({ accumulatedElapsedMs, isPaused, runningStartedAt }));
    }, 120);

    return () => window.clearInterval(timer);
  }, [
    accumulatedElapsedMs,
    finishedMs,
    hasStarted,
    isGenerating,
    isPaused,
    puzzleData,
    runningStartedAt,
  ]);

  useEffect(() => {
    if (!puzzleData || isGenerating || finishedMs !== null || !hasStarted) {
      return;
    }

    saveStoredProgress(puzzleKey, {
      accumulatedElapsedMs,
      board,
      notes,
      hasStarted,
      isPaused,
      runningStartedAt,
      undoStack,
    });
  }, [
    accumulatedElapsedMs,
    board,
    finishedMs,
    hasStarted,
    isGenerating,
    isPaused,
    notes,
    puzzleData,
    puzzleKey,
    runningStartedAt,
    undoStack,
  ]);

  const handleRestart = () => {
    clearStoredProgress(`${dateKey}:${difficultyKey}`);
    setGameNonce((value) => value + 1);
  };

  const handleStart = () => {
    if (!puzzleData || isGenerating || hasStarted) return;

    const now = Date.now();
    const timer = startTimer(now);
    setAccumulatedElapsedMs(timer.accumulatedElapsedMs);
    setRunningStartedAt(timer.runningStartedAt);
    setIsPaused(timer.isPaused);
    setElapsedMs(0);
    setFinishedMs(null);
    setHasStarted(true);
    setNoteMode(false);
    setUndoStack([]);
    setSelectedCell(findFirstEditable(fixedCells));
    setMessage('');
  };

  const handlePauseToggle = () => {
    if (!canTogglePause) return;

    if (isPaused) {
      const timer = resumeTimer({ accumulatedElapsedMs, isPaused, runningStartedAt });
      setAccumulatedElapsedMs(timer.accumulatedElapsedMs);
      setRunningStartedAt(timer.runningStartedAt);
      setIsPaused(timer.isPaused);
      setMessage('');
      return;
    }

    const timer = pauseTimer({ accumulatedElapsedMs, isPaused, runningStartedAt });
    setAccumulatedElapsedMs(timer.accumulatedElapsedMs);
    setElapsedMs(timer.accumulatedElapsedMs);
    setRunningStartedAt(timer.runningStartedAt);
    setIsPaused(timer.isPaused);
    setNoteMode(false);
    setMessage('已暂停。');
  };

  const recordUndoSnapshot = useCallback(() => {
    const snapshot = createUndoSnapshot(board, notes, selectedCell);
    setUndoStack((current) => pushUndoSnapshot(current, snapshot));
  }, [board, notes, selectedCell]);

  const handleUndo = () => {
    if (!canUndo) return;

    const { snapshot, undoStack: nextUndoStack } = popUndoSnapshot(undoStack);
    if (!snapshot) return;

    setBoard(snapshot.board);
    setNotes(snapshot.notes);
    setSelectedCell(snapshot.selectedCell);
    setUndoStack(nextUndoStack);
    setMessage('已撤回上一步。');
  };

  const setDigit = useCallback(
    (digit) => {
      if (!canPlay) return;
      if (fixedCells[selectedCell]) return;

      if (noteMode) {
        if (board[selectedCell]) return;

        setNotes((current) => toggleNote(current, selectedCell, digit));
        setMessage('');
        return;
      }

      if (board[selectedCell] === digit) return;

      recordUndoSnapshot();
      setBoard((current) => {
        const next = [...current];
        next[selectedCell] = digit;
        return next;
      });
      setNotes((current) => applyDigitToNotes(current, selectedCell, digit));
      setMessage('');
    },
    [board, canPlay, fixedCells, noteMode, recordUndoSnapshot, selectedCell],
  );

  const clearCell = useCallback(() => {
    if (!canPlay) return;
    if (fixedCells[selectedCell]) return;

    const hasBoardValue = board[selectedCell] !== 0;
    const hasCellNotes = notes[selectedCell] !== 0;
    if ((noteMode && !hasCellNotes) || (!noteMode && !hasBoardValue && !hasCellNotes)) {
      return;
    }

    recordUndoSnapshot();

    if (!noteMode) {
      setBoard((current) => {
        if (current[selectedCell] === 0) return current;

        const next = [...current];
        next[selectedCell] = 0;
        return next;
      });
    }

    setNotes((current) => clearCellNotes(current, selectedCell));
    setMessage('');
  }, [board, canPlay, fixedCells, noteMode, notes, recordUndoSnapshot, selectedCell]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isSubmitOpen || !canPlay) return;

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        setDigit(Number(event.key));
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
        event.preventDefault();
        clearCell();
        return;
      }

      const row = Math.floor(selectedCell / 9);
      const col = selectedCell % 9;
      let next = selectedCell;

      if (event.key === 'ArrowUp') next = Math.max(0, row - 1) * 9 + col;
      if (event.key === 'ArrowDown') next = Math.min(8, row + 1) * 9 + col;
      if (event.key === 'ArrowLeft') next = row * 9 + Math.max(0, col - 1);
      if (event.key === 'ArrowRight') next = row * 9 + Math.min(8, col + 1);

      if (next !== selectedCell) {
        event.preventDefault();
        setSelectedCell(next);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canPlay, clearCell, isSubmitOpen, selectedCell, setDigit]);

  const handleFinish = () => {
    if (!puzzleData || isGenerating) return;

    if (!hasStarted || (runningStartedAt === null && !isPaused)) {
      setMessage('请先开始游戏。');
      return;
    }

    if (isPaused) {
      setMessage('请先继续游戏。');
      return;
    }

    if (!isValidBoard(board) || hasConflicts(board)) {
      setMessage('当前棋盘存在冲突。');
      return;
    }

    if (!isBoardComplete(board)) {
      setMessage('还没有填完整。');
      return;
    }

    if (!isSolved(board, solution)) {
      setMessage('还有数字不正确。');
      return;
    }

    const finalTime = getElapsedMs({ accumulatedElapsedMs, isPaused, runningStartedAt });
    setFinishedMs(finalTime);
    setAccumulatedElapsedMs(finalTime);
    setRunningStartedAt(null);
    setIsPaused(false);
    setElapsedMs(finalTime);
    setMessage('通关完成。');
    setNoteMode(false);
    setUndoStack([]);
    clearStoredProgress(puzzleKey);
    setIsSubmitOpen(true);
  };

  const handleHistoryDateChange = (event) => {
    const value = event.target.value;
    if (!value) return;

    setHistoryDateKey(value > maxHistoryDateKey ? maxHistoryDateKey : value);
  };

  const handleSubmitScore = async (event) => {
    event.preventDefault();
    const cleanId = normalizePlayerId(playerId);

    if (!cleanId) {
      setSubmitError('请输入 1-16 个字符的玩家 ID。');
      return;
    }

    if (!configured) {
      setSubmitError('Supabase 尚未配置，不能提交共享排行榜。');
      return;
    }

    setSubmitStatus('saving');
    setSubmitError('');

    try {
      await submitScore({
        playerId: cleanId,
        difficulty: difficultyKey,
        puzzleKey,
        timeMs: finishedMs,
      });
      setSubmitStatus('saved');
      setPlayerId(cleanId);
      setIsSubmitOpen(false);
      await loadLeaderboard();
    } catch (error) {
      setSubmitStatus('idle');
      setSubmitError(error instanceof Error ? error.message : '成绩提交失败。');
    }
  };

  return (
    <main className="app-shell">
      <section className="game-header" aria-label="游戏信息">
        <div>
          <p className="eyebrow">每日同题</p>
          <h1>数独挑战</h1>
        </div>
        <div className="header-metrics">
          <div className="metric">
            <CalendarDays size={18} aria-hidden="true" />
            <span>{dateKey}</span>
          </div>
          <div className="metric timer">
            <Clock3 size={18} aria-hidden="true" />
            <span>{formatDuration(displayedTime)}</span>
          </div>
        </div>
      </section>

      <section className="difficulty-tabs" aria-label="难度选择">
        {DIFFICULTIES.map((item) => (
          <button
            className={item.key === difficultyKey ? 'difficulty-tab active' : 'difficulty-tab'}
            key={item.key}
            type="button"
            onClick={() => setDifficultyKey(item.key)}
          >
            <span>{item.label}</span>
            <small>{item.tagline}</small>
          </button>
        ))}
      </section>

      <div className="workspace">
        <section className="play-area" aria-label="数独棋盘">
          <div className="board-toolbar">
            <div>
              <p className="difficulty-name">{difficulty.label}</p>
              <p className="puzzle-key">{puzzleKey}</p>
            </div>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                disabled={!canTogglePause}
                type="button"
                onClick={handlePauseToggle}
                title={isPaused ? '继续游戏' : '暂停游戏'}
                aria-label={isPaused ? '继续游戏' : '暂停游戏'}
              >
                {isPaused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={handleRestart}
                title="重新开始今日题目"
                aria-label="重新开始今日题目"
              >
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="board-wrap">
            {isGenerating ? (
              <div className="loading-board">
                <Loader2 size={32} aria-hidden="true" />
                <span>正在生成唯一解题目</span>
              </div>
            ) : (
              <div className="sudoku-stage">
                <div
                  className={canShowPuzzle ? 'sudoku-board' : 'sudoku-board pending'}
                  role="grid"
                  aria-label="数独棋盘"
                >
                  {board.map((digit, cell) => {
                    const fixed = canShowPuzzle && Boolean(fixedCells[cell]);
                    const selected = canShowPuzzle && selectedCell === cell;
                    const related = canShowPuzzle && sameHouse(selectedCell, cell);
                    const selectedDigit = canShowPuzzle ? board[selectedCell] : 0;
                    const sameDigit = canShowPuzzle && digit && selectedDigit && digit === selectedDigit;
                    const noteDigits = canShowPuzzle && !digit ? getNoteDigits(notes[cell]) : [];
                    const className = [
                      'cell',
                      fixed ? 'fixed' : 'editable',
                      selected ? 'selected' : '',
                      related ? 'related' : '',
                      sameDigit ? 'same-digit' : '',
                      noteDigits.length > 0 ? 'has-notes' : '',
                      (cell + 1) % 3 === 0 && (cell + 1) % 9 !== 0 ? 'box-right' : '',
                      Math.floor(cell / 9) % 3 === 2 && cell < 72 ? 'box-bottom' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <button
                        aria-disabled={!canPlay}
                        aria-label={[
                          `第 ${Math.floor(cell / 9) + 1} 行第 ${(cell % 9) + 1} 列`,
                          canShowPuzzle && digit ? `数字 ${digit}` : '',
                          noteDigits.length > 0 ? `候选 ${noteDigits.join('、')}` : '',
                        ]
                          .filter(Boolean)
                          .join('，')}
                        className={className}
                        key={cell}
                        role="gridcell"
                        tabIndex={canPlay ? 0 : -1}
                        type="button"
                        onClick={() => {
                          if (canPlay) setSelectedCell(cell);
                        }}
                      >
                        {canShowPuzzle && digit ? (
                          <span className="cell-digit">{digit}</span>
                        ) : (
                          canShowPuzzle &&
                          noteDigits.length > 0 && (
                            <span className="notes-grid" aria-hidden="true">
                              {Array.from({ length: 9 }, (_, index) => index + 1).map((noteDigit) => (
                                <span key={noteDigit}>{hasNote(notes[cell], noteDigit) ? noteDigit : ''}</span>
                              ))}
                            </span>
                          )
                        )}
                      </button>
                    );
                  })}
                </div>

                {isReadyToStart && (
                  <div className="start-overlay">
                    <div className="start-panel">
                      <p className="ready-title">今日题目已就绪</p>
                      <button className="start-button" type="button" onClick={handleStart}>
                        <Play size={20} aria-hidden="true" />
                        开始游戏
                      </button>
                    </div>
                  </div>
                )}

                {isPaused && (
                  <div className="pause-overlay">
                    <div className="pause-panel">
                      <Clock3 size={34} aria-hidden="true" />
                      <p className="pause-title">已暂停</p>
                      <p className="pause-time">{formatDuration(displayedTime)}</p>
                      <button className="start-button" type="button" onClick={handlePauseToggle}>
                        <Play size={20} aria-hidden="true" />
                        继续游戏
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="number-pad" aria-label="数字输入">
            {Array.from({ length: 9 }, (_, index) => index + 1).map((digit) => (
              <button
                className="number-button"
                disabled={!canPlay}
                key={digit}
                type="button"
                onClick={() => setDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              className="number-button undo-button"
              disabled={!canUndo}
              type="button"
              onClick={handleUndo}
              title="撤回上一步"
              aria-label="撤回上一步"
            >
              <Undo2 size={20} aria-hidden="true" />
            </button>
            <button
              className={noteMode ? 'number-button note-toggle active' : 'number-button note-toggle'}
              disabled={!canPlay}
              type="button"
              onClick={() => setNoteMode((value) => !value)}
              title="笔记模式"
              aria-label={noteMode ? '关闭笔记模式' : '开启笔记模式'}
              aria-pressed={noteMode}
            >
              <PencilLine size={18} aria-hidden="true" />
              <span>笔记</span>
            </button>
            <button
              className="number-button clear"
              disabled={!canPlay}
              type="button"
              onClick={clearCell}
              title="清除"
              aria-label="清除"
            >
              <Eraser size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="action-row">
            <button className="primary-button" disabled={!canPlay} type="button" onClick={handleFinish}>
              <Check size={18} aria-hidden="true" />
              提交完成
            </button>
            <span className="status-line">{message}</span>
          </div>
        </section>

        <aside className="leaderboard-panel" aria-label="排行榜">
          <section className="leaderboard-section" aria-label="今日排行榜">
            <div className="panel-title">
              <div>
                <p className="eyebrow">今日榜单</p>
                <h2>{difficulty.label}</h2>
              </div>
              <Trophy size={24} aria-hidden="true" />
            </div>

            {!configured && (
              <div className="notice">
                <WifiOff size={18} aria-hidden="true" />
                <span>配置 Supabase 环境变量后启用全网共享排行榜。</span>
              </div>
            )}

            <LeaderboardContent
              configured={configured}
              emptyMessage="今天还没有成绩。"
              error={leaderboardError}
              rows={leaderboard}
              status={leaderboardStatus}
            />

            <div className="rules">
              <span>同一 ID 只保留最快成绩。</span>
              <span>每日 00:00 按中国时区换题。</span>
            </div>
          </section>

          <section className="leaderboard-section history-section" aria-label="历史排行榜">
            <div className="panel-title history-panel-title">
              <div>
                <p className="eyebrow">历史榜单</p>
                <h2>{difficulty.label}</h2>
                <p className="puzzle-key">{historyPuzzleKey}</p>
              </div>
              <input
                aria-label="历史榜单日期"
                className="history-date-input"
                max={maxHistoryDateKey}
                type="date"
                value={historyDateKey}
                onChange={handleHistoryDateChange}
              />
            </div>

            <LeaderboardContent
              configured={configured}
              emptyMessage="这天还没有成绩。"
              error={historyLeaderboardError}
              rows={historyLeaderboard}
              status={historyLeaderboardStatus}
            />
          </section>
        </aside>
      </div>

      {isSubmitOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="score-modal" onSubmit={handleSubmitScore}>
            <div>
              <p className="eyebrow">通关成绩</p>
              <h2>{formatDuration(finishedMs)}</h2>
            </div>
            <label htmlFor="player-id">玩家 ID</label>
            <input
              autoFocus
              id="player-id"
              maxLength={16}
              placeholder="1-16 个字符"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
            />
            {submitError && <p className="form-error">{submitError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setIsSubmitOpen(false)}>
                暂不提交
              </button>
              <button className="primary-button" disabled={submitStatus === 'saving'} type="submit">
                {submitStatus === 'saving' ? '提交中...' : '提交榜单'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
