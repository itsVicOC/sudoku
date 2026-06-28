const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_API_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_API_KEY);
}

function endpoint(functionName) {
  return `${SUPABASE_URL}/rest/v1/rpc/${functionName}`;
}

async function callRpc(functionName, payload) {
  if (!isConfigured()) {
    throw new Error('Supabase 尚未配置，无法读取或提交共享排行榜。');
  }

  const headers = {
    apikey: SUPABASE_API_KEY,
    'Content-Type': 'application/json',
  };

  if (!SUPABASE_API_KEY.startsWith('sb_publishable_')) {
    headers.Authorization = `Bearer ${SUPABASE_API_KEY}`;
  }

  const response = await fetch(endpoint(functionName), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase 请求失败：${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export function hasLeaderboardConfig() {
  return isConfigured();
}

export async function fetchLeaderboard(difficulty, puzzleKey) {
  return callRpc('get_leaderboard', {
    difficulty_input: difficulty,
    puzzle_key_input: puzzleKey,
  });
}

export async function submitScore({ playerId, difficulty, puzzleKey, timeMs }) {
  return callRpc('submit_score', {
    player_id_input: playerId,
    difficulty_input: difficulty,
    puzzle_key_input: puzzleKey,
    time_ms_input: timeMs,
  });
}
