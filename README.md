# 每日数独

一个部署到 GitHub Pages 的 React + Vite 数独游戏。题目按中国时区每日刷新，每个难度当天固定同一题，排行榜通过 Supabase 免费托管项目全网共享。

## 功能

- 四个难度：简单、业余、高手、骨灰级
- 每日同题：同一天同一难度所有玩家拿到同一道题
- 固定种子生成：刷新页面不会改变当日题目
- 唯一解校验：生成过程中用求解器确认题目唯一解
- 难度评分：结合线索数、候选压力、逻辑推进和搜索复杂度
- 极简交互：选格、填数、清除、计时、提交完成
- 暂停游戏：暂停时计时停止，棋盘被遮罩保护
- 撤回操作：可撤回上一步数字输入或清除
- 笔记模式：挑战中可记录候选数字，刷新后保留未完成进度
- 共享排行榜：每个难度和每日题目独立榜单，同一 ID 只保留最快成绩
- 历史榜单：默认展示上一日成绩，也可选择过去日期查看

## 本地开发

```bash
npm install
npm run dev
```

测试生成器：

```bash
npm test
```

构建 GitHub Pages 产物：

```bash
npm run build
```

## Supabase 配置

1. 创建 Supabase 免费项目。
2. 在 Supabase SQL Editor 执行 [supabase/schema.sql](./supabase/schema.sql)。
3. 复制项目的 Project URL 和 anon public key。
4. 本地创建 `.env.local`：

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-public-key
```

GitHub Pages 部署时，在仓库 `Settings -> Secrets and variables -> Actions` 配置：

- Variable: `VITE_SUPABASE_URL`
- Secret: `VITE_SUPABASE_PUBLISHABLE_KEY`

新版 Supabase Dashboard 里显示的 `publishable key` 就是前端要用的 key。旧版 `anon` key 仍可作为 `VITE_SUPABASE_ANON_KEY` 使用，但 Supabase 已将它标记为 legacy。

## GitHub Pages

仓库按 `itsVicOC/sudoku` 设计，Vite base 已配置为 `/sudoku/`。推送到 `main` 后，GitHub Actions 会构建并部署到：

```text
https://itsvicoc.github.io/sudoku/
```

如果仓库名不是 `sudoku`，需要同步修改 [vite.config.js](./vite.config.js) 中的 `base`。

## 排行榜安全边界

项目采用休闲防作弊：RLS 拒绝匿名用户直接改表，前端只调用 `submit_score` 和 `get_leaderboard` RPC，数据库会校验 ID、难度、题目 key 和成绩范围。由于 GitHub Pages 是纯静态前端，匿名 key 必须暴露给浏览器，所以无法彻底阻止懂技术的人伪造成绩。
