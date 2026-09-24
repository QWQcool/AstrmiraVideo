/**
 * 一次性运维：清理线上的剪辑产物（V9 修复 2026-09-24 的线上数据收尾）。
 *
 * 背景：2026-09-24 起剪辑产物不再进历史成片（`/api/history` 默认 `edit_script IS NULL`），
 * 但**线上已有的剪辑任务记录与文件仍在**。本脚本删除它们。
 *
 * 用法（在 app 容器里跑，cwd=/app/backend 以便 require 到 better-sqlite3）：
 *   node /tmp/cleanup-edits.cjs            # dry-run：只列出，不删
 *   node /tmp/cleanup-edits.cjs --confirm  # 真删
 *
 * 删除范围（保守）：
 *   - `tasks` 表里 `edit_script IS NOT NULL` 的记录（剪辑任务）
 *   - 对应成片 `outputs/<taskId>.mp4` 与缩略图 `outputs/thumbs/<taskId>.jpg`
 *   - 孤儿幂等键（指向已删任务的）
 * **不删**：抽帧资产（`outputs/assets/`）—— 它们可能被其他生成任务引用为首帧/尾帧，
 *            删掉会毁掉那些任务的参考图。
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const CONFIRM = process.argv.includes('--confirm');
const DB = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'app.db') : '/app/data/app.db';
const OUTPUTS = process.env.OUTPUT_DIR || '/app/outputs';

if (!fs.existsSync(DB)) {
  console.error(`数据库不存在：${DB}`);
  process.exit(1);
}

const db = new Database(DB, { readonly: !CONFIRM });

const edits = db
  .prepare("SELECT task_id, status, created_at FROM tasks WHERE edit_script IS NOT NULL ORDER BY created_at")
  .all();

console.log(`剪辑任务数：${edits.length}`);
for (const e of edits) {
  console.log(`  · ${e.task_id.slice(0, 8)}  ${e.status.padEnd(9)}  ${new Date(e.created_at).toISOString()}`);
}

if (!CONFIRM) {
  console.log('\n(dry-run：加 --confirm 才会真删)');
  db.close();
  process.exit(0);
}

const delTasks = db.prepare('DELETE FROM tasks WHERE edit_script IS NOT NULL').run();
const delKeys = db
  .prepare('DELETE FROM idempotency_keys WHERE task_id NOT IN (SELECT task_id FROM tasks)')
  .run();
db.close();

let removedFiles = 0;
for (const e of edits) {
  for (const rel of [`${e.task_id}.mp4`, path.join('thumbs', `${e.task_id}.jpg`)]) {
    const p = path.join(OUTPUTS, rel);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      removedFiles += 1;
    }
  }
}

console.log(`\n✓ 已删：任务记录 ${delTasks.changes} · 孤儿幂等键 ${delKeys.changes} · 文件 ${removedFiles}`);
