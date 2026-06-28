import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  Clock3,
  Eraser,
  Loader2,
  Medal,
  RefreshCw,
  Trophy,
  WifiOff,
} from 'lucide-react';
import { DIFFICULTIES, DIFFICULTY_BY_KEY } from './game/difficulties.js';
import { generatePuzzle, isBoardComplete, isValidBoard } from './game/sudoku.js';
import {
  fetchLeaderboard,
  hasLeaderboardConfig,
  submitScore,
} from './services/leaderboard.js';
import { formatDuration, getShanghaiDateKey } from './utils/time.js';

const EMPTY_BOARD = Array(81).fill(0);

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

export default function App() {
  const dateKey = useMemo(() => getShanghaiDateKey(), []);
  const [difficultyKey, setDifficultyKey] = useState('easy');
  const [gameNonce, setGameNonce] = useState(0);
  const [isGenerating, setIsGenerating] = useState(true);
  const [puzzleData, setPuzzleData] = useState(null);
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [selectedCell, setSelectedCell] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
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
  const boardRef = useRef(null);

  const difficulty = DIFFICULTY_BY_KEY[difficultyKey];
  const fixedCells = puzzleData?.puzzle ?? EMPTY_BOARD;
  const solution = puzzleData?.analysis.solution ?? EMPTY_BOARD;
  const puzzleKey = puzzleData?.puzzleKey ?? `${dateKey}:${difficultyKey}`;
  const displayedTime = finishedMs ?? elapsedMs;
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

  useEffect(() => {
    let cancelled = false;
    setIsGenerating(true);
    setMessage('正在生成今日题目...');

    const timer = window.setTimeout(() => {
      const generated = generatePuzzle(dateKey, difficultyKey);

      if (cancelled) return;

      setPuzzleData(generated);
      setBoard([...generated.puzzle]);
      setSelectedCell(findFirstEditable(generated.puzzle));
      setStartedAt(Date.now());
      setElapsedMs(0);
      setFinishedMs(null);
      setMessage(generated.generatedByFallback ? '已生成稳定唯一解题目。' : '');
      setIsGenerating(false);
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
    if (!puzzleData || finishedMs !== null || isGenerating) return undefined;

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 120);

    return () => window.clearInterval(timer);
  }, [finishedMs, isGenerating, puzzleData, startedAt]);

  const setDigit = useCallback(
    (digit) => {
      if (!puzzleData || finishedMs !== null) return;
      if (fixedCells[selectedCell]) return;

      setBoard((current) => {
        const next = [...current];
        next[selectedCell] = digit;
        return next;
      });
      setMessage('');
    },
    [finishedMs, fixedCells, puzzleData, selectedCell],
  );

  const clearCell = useCallback(() => setDigit(0), [setDigit]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isSubmitOpen) return;

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
  }, [clearCell, isSubmitOpen, selectedCell, setDigit]);

  const handleFinish = () => {
    if (!puzzleData || isGenerating) return;

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

    const finalTime = Date.now() - startedAt;
    setFinishedMs(finalTime);
    setElapsedMs(finalTime);
    setMessage('通关完成。');
    setIsSubmitOpen(true);
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
            <button
              className="icon-button"
              type="button"
              onClick={() => setGameNonce((value) => value + 1)}
              title="重新开始今日题目"
              aria-label="重新开始今日题目"
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="board-wrap">
            {isGenerating ? (
              <div className="loading-board">
                <Loader2 size={32} aria-hidden="true" />
                <span>正在生成唯一解题目</span>
              </div>
            ) : (
              <div className="sudoku-board" ref={boardRef} role="grid" aria-label="数独棋盘">
                {board.map((digit, cell) => {
                  const fixed = Boolean(fixedCells[cell]);
                  const selected = selectedCell === cell;
                  const related = sameHouse(selectedCell, cell);
                  const sameDigit = digit && digit === board[selectedCell];
                  const className = [
                    'cell',
                    fixed ? 'fixed' : 'editable',
                    selected ? 'selected' : '',
                    related ? 'related' : '',
                    sameDigit ? 'same-digit' : '',
                    (cell + 1) % 3 === 0 && (cell + 1) % 9 !== 0 ? 'box-right' : '',
                    Math.floor(cell / 9) % 3 === 2 && cell < 72 ? 'box-bottom' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <button
                      aria-label={`第 ${Math.floor(cell / 9) + 1} 行第 ${(cell % 9) + 1} 列`}
                      className={className}
                      key={cell}
                      role="gridcell"
                      type="button"
                      onClick={() => setSelectedCell(cell)}
                    >
                      {digit || ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="number-pad" aria-label="数字输入">
            {Array.from({ length: 9 }, (_, index) => index + 1).map((digit) => (
              <button
                className="number-button"
                disabled={isGenerating || finishedMs !== null}
                key={digit}
                type="button"
                onClick={() => setDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              className="number-button clear"
              disabled={isGenerating || finishedMs !== null}
              type="button"
              onClick={clearCell}
              title="清除"
              aria-label="清除"
            >
              <Eraser size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="action-row">
            <button className="primary-button" type="button" onClick={handleFinish}>
              <Check size={18} aria-hidden="true" />
              提交完成
            </button>
            <span className="status-line">{message}</span>
          </div>
        </section>

        <aside className="leaderboard-panel" aria-label="今日排行榜">
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

          {leaderboardStatus === 'loading' && configured && (
            <div className="loading-list">
              <Loader2 size={18} aria-hidden="true" />
              <span>读取排行榜...</span>
            </div>
          )}

          {leaderboardStatus === 'error' && (
            <div className="notice danger">{leaderboardError}</div>
          )}

          {leaderboardStatus === 'ready' && leaderboard.length === 0 && (
            <div className="empty-list">今天还没有成绩。</div>
          )}

          {leaderboard.length > 0 && (
            <ol className="leaderboard-list">
              {leaderboard.map((row, index) => (
                <li className="leaderboard-row" key={`${row.player_id}-${row.time_ms}`}>
                  <span className={index < 3 ? 'rank podium' : 'rank'}>
                    {index < 3 ? <Medal size={16} aria-hidden="true" /> : row.rank}
                  </span>
                  <span className="player-id">{row.player_id}</span>
                  <span className="score-time">{formatDuration(row.time_ms)}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="rules">
            <span>同一 ID 只保留最快成绩。</span>
            <span>每日 00:00 按中国时区换题。</span>
          </div>
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
