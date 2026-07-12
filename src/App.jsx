import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
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
import {
  generatePuzzle,
  getConflictCells,
  isBoardComplete,
  isValidBoard,
} from './game/sudoku.js';
import {
  fetchLeaderboard,
  hasLeaderboardConfig,
  submitScore,
} from './services/leaderboard.js';
import { formatDuration, getPreviousDateKey, getShanghaiDateKey } from './utils/time.js';

const EMPTY_BOARD = Array(81).fill(0);
const PROGRESS_STORAGE_PREFIX = 'daily-sudoku-progress:';
const PLAYER_ID_STORAGE_KEY = 'daily-sudoku-player-id';

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

function isSolved(board, solution) {
  return board.every((digit, index) => digit === solution[index]);
}

function readStoredPlayerId() {
  try {
    return normalizePlayerId(window.localStorage.getItem(PLAYER_ID_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

function saveStoredPlayerId(playerId) {
  try {
    window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, playerId);
  } catch {
    // Ignore storage failures; the score submission still succeeds.
  }
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

function Dialog({ children, className, labelledBy, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusable = () =>
      dialog
        ? [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
        : [];

    const focusable = getFocusable();
    (focusable[0] ?? dialog)?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const currentFocusable = getFocusable();
      if (currentFocusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={className}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
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
  const boardRef = useRef(null);
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
  const [playerId, setPlayerId] = useState(readStoredPlayerId);
  const [submitStatus, setSubmitStatus] = useState('idle');
  const [submitError, setSubmitError] = useState('');
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
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
  const displayedTimerText = formatDuration(displayedTime, {
    showHundredths: finishedMs !== null,
  });
  const conflictCells = useMemo(() => getConflictCells(board), [board]);
  const isDialogOpen = isSubmitOpen || confirmation !== null;
  const configured = hasLeaderboardConfig();
  const pendingDifficulty = confirmation?.difficultyKey
    ? DIFFICULTY_BY_KEY[confirmation.difficultyKey]
    : null;

  const loadLeaderboard = useCallback(async ({ silent = false } = {}) => {
    if (!configured || !puzzleData) {
      setLeaderboardStatus(configured ? 'idle' : 'missing-config');
      setLeaderboard([]);
      return;
    }

    if (!silent) {
      setLeaderboardStatus('loading');
      setLeaderboardError('');
    }

    try {
      const rows = await fetchLeaderboard(difficultyKey, puzzleData.puzzleKey);
      setLeaderboard(Array.isArray(rows) ? rows : []);
      setLeaderboardStatus('ready');
    } catch (error) {
      if (silent) return;
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
      setScoreSubmitted(false);
      setConfirmation(null);
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
    if (!configured || !puzzleData) return undefined;

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadLeaderboard({ silent: true });
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [configured, loadLeaderboard, puzzleData]);

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
    }, 250);

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

  const restartGame = useCallback(() => {
    clearStoredProgress(`${dateKey}:${difficultyKey}`);
    setGameNonce((value) => value + 1);
  }, [dateKey, difficultyKey]);

  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const closeSubmitDialog = useCallback(() => setIsSubmitOpen(false), []);

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

  const pauseCurrentGame = useCallback(() => {
    if (!canTogglePause || isPaused) return;
    const timer = pauseTimer({ accumulatedElapsedMs, isPaused, runningStartedAt });
    setAccumulatedElapsedMs(timer.accumulatedElapsedMs);
    setElapsedMs(timer.accumulatedElapsedMs);
    setRunningStartedAt(timer.runningStartedAt);
    setIsPaused(timer.isPaused);
    setNoteMode(false);
    setMessage('已暂停。');
  }, [accumulatedElapsedMs, canTogglePause, isPaused, runningStartedAt]);

  const handlePauseToggle = () => {
    if (!canTogglePause) return;

    if (!isPaused) {
      pauseCurrentGame();
      return;
    }

    const timer = resumeTimer({ accumulatedElapsedMs, isPaused, runningStartedAt });
    setAccumulatedElapsedMs(timer.accumulatedElapsedMs);
    setRunningStartedAt(timer.runningStartedAt);
    setIsPaused(timer.isPaused);
    setMessage('');
  };

  const requestRestart = () => {
    if (isGameActive || (finishedMs !== null && !scoreSubmitted)) {
      if (!isPaused && isGameActive) pauseCurrentGame();
      setConfirmation({ type: 'restart' });
      return;
    }

    restartGame();
  };

  const handleDifficultySelect = (nextDifficultyKey) => {
    if (nextDifficultyKey === difficultyKey || isGenerating) return;

    if (isGameActive || (finishedMs !== null && !scoreSubmitted)) {
      if (!isPaused && isGameActive) pauseCurrentGame();
      setConfirmation({ type: 'difficulty', difficultyKey: nextDifficultyKey });
      return;
    }

    setDifficultyKey(nextDifficultyKey);
  };

  const confirmPendingAction = () => {
    if (confirmation?.type === 'difficulty') {
      setDifficultyKey(confirmation.difficultyKey);
      setConfirmation(null);
      return;
    }

    if (confirmation?.type === 'restart') {
      setConfirmation(null);
      restartGame();
    }
  };

  const recordUndoSnapshot = useCallback(() => {
    const snapshot = createUndoSnapshot(board, notes, selectedCell);
    setUndoStack((current) => pushUndoSnapshot(current, snapshot));
  }, [board, notes, selectedCell]);

  const handleUndo = useCallback(() => {
    if (!canUndo) return;

    const { snapshot, undoStack: nextUndoStack } = popUndoSnapshot(undoStack);
    if (!snapshot) return;

    setBoard(snapshot.board);
    setNotes(snapshot.notes);
    setSelectedCell(snapshot.selectedCell);
    setUndoStack(nextUndoStack);
    setMessage('已撤回上一步。');
  }, [canUndo, undoStack]);

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
      const nextBoard = [...board];
      nextBoard[selectedCell] = digit;
      setBoard(nextBoard);
      setNotes((current) => applyDigitToNotes(current, selectedCell, digit));
      setMessage(
        getConflictCells(nextBoard).has(selectedCell)
          ? '这个数字与当前行、列或宫内的数字冲突。'
          : '',
      );
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
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)
      ) {
        return;
      }
      if (isDialogOpen || !canPlay) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setNoteMode((value) => !value);
        setMessage('');
        return;
      }

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
        window.requestAnimationFrame(() => {
          boardRef.current?.querySelector(`[data-cell="${next}"]`)?.focus();
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canPlay, clearCell, handleUndo, isDialogOpen, selectedCell, setDigit]);

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

    if (!isValidBoard(board) || conflictCells.size > 0) {
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
    setScoreSubmitted(false);
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
      saveStoredPlayerId(cleanId);
      setScoreSubmitted(true);
      setMessage('成绩已提交至今日榜单。');
      setIsSubmitOpen(false);
      await loadLeaderboard({ silent: true });
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
            <span>{displayedTimerText}</span>
          </div>
        </div>
      </section>

      <section className="difficulty-tabs" aria-label="难度选择">
        {DIFFICULTIES.map((item) => (
          <button
            className={item.key === difficultyKey ? 'difficulty-tab active' : 'difficulty-tab'}
            aria-pressed={item.key === difficultyKey}
            key={item.key}
            type="button"
            onClick={() => handleDifficultySelect(item.key)}
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
                onClick={requestRestart}
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
                  aria-hidden={isPaused || undefined}
                  className={canShowPuzzle ? 'sudoku-board' : 'sudoku-board pending'}
                  inert={isPaused}
                  ref={boardRef}
                  role="grid"
                  aria-label="数独棋盘"
                >
                  {board.map((digit, cell) => {
                    const fixed = canShowPuzzle && Boolean(fixedCells[cell]);
                    const selected = canShowPuzzle && selectedCell === cell;
                    const related = canShowPuzzle && sameHouse(selectedCell, cell);
                    const selectedDigit = canShowPuzzle ? board[selectedCell] : 0;
                    const sameDigit = canShowPuzzle && digit && selectedDigit && digit === selectedDigit;
                    const conflict = canShowPuzzle && conflictCells.has(cell);
                    const noteDigits = canShowPuzzle && !digit ? getNoteDigits(notes[cell]) : [];
                    const className = [
                      'cell',
                      fixed ? 'fixed' : 'editable',
                      selected ? 'selected' : '',
                      related ? 'related' : '',
                      sameDigit ? 'same-digit' : '',
                      conflict ? 'conflict' : '',
                      noteDigits.length > 0 ? 'has-notes' : '',
                      (cell + 1) % 3 === 0 && (cell + 1) % 9 !== 0 ? 'box-right' : '',
                      Math.floor(cell / 9) % 3 === 2 && cell < 72 ? 'box-bottom' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <button
                        aria-disabled={!canPlay}
                        aria-invalid={conflict || undefined}
                        aria-label={[
                          `第 ${Math.floor(cell / 9) + 1} 行第 ${(cell % 9) + 1} 列`,
                          canShowPuzzle && digit ? `数字 ${digit}` : '',
                          conflict ? '存在冲突' : '',
                          noteDigits.length > 0 ? `候选 ${noteDigits.join('、')}` : '',
                        ]
                          .filter(Boolean)
                          .join('，')}
                        className={className}
                        data-cell={cell}
                        key={cell}
                        role="gridcell"
                        tabIndex={canPlay && selected ? 0 : -1}
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
                  <div aria-labelledby="pause-title" className="pause-overlay" role="region">
                    <div className="pause-panel">
                      <Clock3 size={34} aria-hidden="true" />
                      <p className="pause-title" id="pause-title">已暂停</p>
                      <p className="pause-time">{displayedTimerText}</p>
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

          <div className="control-area">
            <div className="number-pad" aria-label="数字输入">
              {Array.from({ length: 9 }, (_, index) => index + 1).map((digit) => (
                <button
                  aria-label={`输入数字 ${digit}`}
                  className="number-button"
                  disabled={!canPlay}
                  key={digit}
                  type="button"
                  onClick={() => setDigit(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
            <div className="tool-pad" aria-label="棋盘工具">
              <button
                className="tool-button undo-button"
                disabled={!canUndo}
                type="button"
                onClick={handleUndo}
                title="撤回上一步（Ctrl/Cmd + Z）"
                aria-label="撤回上一步"
              >
                <Undo2 size={20} aria-hidden="true" />
                <span>撤回</span>
              </button>
              <button
                className={noteMode ? 'tool-button note-toggle active' : 'tool-button note-toggle'}
                disabled={!canPlay}
                type="button"
                onClick={() => setNoteMode((value) => !value)}
                title="笔记模式（N）"
                aria-label={noteMode ? '关闭笔记模式' : '开启笔记模式'}
                aria-pressed={noteMode}
              >
                <PencilLine size={18} aria-hidden="true" />
                <span>笔记</span>
              </button>
              <button
                className="tool-button clear"
                disabled={!canPlay}
                type="button"
                onClick={clearCell}
                title="清除"
                aria-label="清除"
              >
                <Eraser size={20} aria-hidden="true" />
                <span>清除</span>
              </button>
            </div>
          </div>

          <div className="action-row">
            {finishedMs !== null ? (
              <div className="result-actions">
                <button
                  className="primary-button"
                  disabled={scoreSubmitted}
                  type="button"
                  onClick={() => setIsSubmitOpen(true)}
                >
                  {scoreSubmitted ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <Trophy size={18} aria-hidden="true" />
                  )}
                  {scoreSubmitted ? '成绩已提交' : '提交成绩'}
                </button>
                <button className="secondary-button" type="button" onClick={requestRestart}>
                  <RefreshCw size={17} aria-hidden="true" />
                  再来一局
                </button>
              </div>
            ) : (
              <button className="primary-button" disabled={!canPlay} type="button" onClick={handleFinish}>
                <Check size={18} aria-hidden="true" />
                提交完成
              </button>
            )}
            <span aria-live="polite" className="status-line" role="status">{message}</span>
          </div>
        </section>

        <aside className="leaderboard-panel" aria-label="排行榜">
          <section className="leaderboard-section" aria-label="今日排行榜">
            <div className="panel-title">
              <div>
                <p className="eyebrow">今日榜单</p>
                <h2>{difficulty.label}</h2>
              </div>
              <div className="panel-actions">
                <button
                  aria-label="刷新今日排行榜"
                  className="icon-button compact"
                  disabled={!configured || leaderboardStatus === 'loading'}
                  onClick={() => loadLeaderboard()}
                  title="刷新今日排行榜"
                  type="button"
                >
                  {leaderboardStatus === 'loading' ? (
                    <Loader2 className="spin-icon" size={17} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={17} aria-hidden="true" />
                  )}
                </button>
                <Trophy size={24} aria-hidden="true" />
              </div>
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
        <Dialog className="score-modal" labelledBy="score-dialog-title" onClose={closeSubmitDialog}>
          <form onSubmit={handleSubmitScore}>
            <div>
              <p className="eyebrow">通关成绩</p>
              <h2 id="score-dialog-title">{formatDuration(finishedMs)}</h2>
            </div>
            <label htmlFor="player-id">玩家 ID</label>
            <input
              autoComplete="nickname"
              id="player-id"
              maxLength={16}
              placeholder="1-16 个字符"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
            />
            {submitError && <p className="form-error">{submitError}</p>}
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={submitStatus === 'saving'}
                type="button"
                onClick={closeSubmitDialog}
              >
                暂不提交
              </button>
              <button className="primary-button" disabled={submitStatus === 'saving'} type="submit">
                {submitStatus === 'saving' ? '提交中...' : '提交榜单'}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {confirmation && (
        <Dialog className="confirm-modal" labelledBy="confirm-dialog-title" onClose={closeConfirmation}>
          <AlertTriangle size={30} aria-hidden="true" />
          <div>
            <p className="eyebrow">确认操作</p>
            <h2 id="confirm-dialog-title">
              {confirmation.type === 'difficulty' ? `切换到${pendingDifficulty?.label}` : '重新开始今日题目'}
            </h2>
          </div>
          <p className="confirm-copy">
            {confirmation.type === 'difficulty'
              ? '当前进度已经保存并暂停，切换后可以稍后回来继续。'
              : finishedMs !== null && !scoreSubmitted
                ? '当前成绩还没有提交到排行榜，重新开始后将无法再次提交这次成绩。'
                : '当前填写进度和计时将被清除。'}
          </p>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={closeConfirmation}>
              返回
            </button>
            <button className="danger-button" type="button" onClick={confirmPendingAction}>
              {confirmation.type === 'difficulty' ? '确认切换' : '重新开始'}
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
