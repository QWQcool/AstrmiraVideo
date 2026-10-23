#!/usr/bin/env node
/**
 * 外部媒体导入器（S7-D8 / P2）
 *
 * 用途：把即梦等外部作品的**单个**图片/视频下载、校验、必要时转码，再上传到本站。
 * 不做批量抓取，不接受用户提供的任意服务端 URL；这是本地运维脚本，不是公网 API。
 *
 * 环境变量：
 *   SOURCE_URL     必填；签名媒体 URL
 *   SOURCE_REFERER 可选；默认即梦工作区
 *   SITE_BASE      默认 https://43.228.79.210
 *   SITE_AUTH      必填；Basic 认证的 user:pass
 *   PROJECT_ID     必填；本站项目 id
 *   HISTORY=1      可选；上传后调用 /api/history/import
 *   TITLE/SOURCE_NAME 可选；历史标题/来源名
 *
 * 规则：
 *   - 视频 ≤100MB 直接下载；>100MB 用 ffmpeg 远程转码（不落大文件）
 *   - 非 H.264 视频转码；音频保留 AAC
 *   - 上传失败不写历史
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SOURCE_URL = process.env.SOURCE_URL;
const SITE_BASE = process.env.SITE_BASE ?? 'https://43.228.79.210';
const SITE_AUTH = process.env.SITE_AUTH;
const PROJECT_ID = process.env.PROJECT_ID;
const MAX_BYTES = 100 * 1024 * 1024;
const REFERER =
  process.env.SOURCE_REFERER ??
  'https://jimeng.jianying.com/ai-tool/generate?workspace=23643819589132';

if (!SOURCE_URL || !SITE_AUTH || !PROJECT_ID) {
  console.error('需要 SOURCE_URL / SITE_AUTH / PROJECT_ID');
  process.exit(2);
}

const basic = `Basic ${Buffer.from(SITE_AUTH).toString('base64')}`;
const workDir = mkdtempSync(path.join(tmpdir(), 'astrmira-import-'));
const downloaded = path.join(workDir, 'source.mp4');
const converted = path.join(workDir, 'converted.mp4');

function ffprobe(file) {
  try {
    const raw = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'json', file],
      { encoding: 'utf8' },
    );
    return JSON.parse(raw).streams?.[0]?.codec_name ?? null;
  } catch {
    return null;
  }
}

async function download(url) {
  const response = await fetch(url, {
    headers: {
      referer: REFERER,
      origin: 'https://jimeng.jianying.com',
      'user-agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) {
    console.log(`源文件 ${(length / 1024 / 1024).toFixed(1)}MB > 100MB，改为远程转码`);
    return null;
  }
  const body = Buffer.from(await response.arrayBuffer());
  writeFileSync(downloaded, body);
  return downloaded;
}

function transcode(file, remote = false) {
  const args = ['-y', '-nostdin'];
  if (remote) {
    args.push(
      '-headers',
      `Referer: ${REFERER}\r\nOrigin: https://jimeng.jianying.com\r\nUser-Agent: Mozilla/5.0\r\n`,
      '-i',
      SOURCE_URL,
    );
  } else {
    args.push('-i', file);
  }
  args.push(
    '-vf',
    'scale=1280:-2',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '26',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    converted,
  );
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  return converted;
}

async function upload(filePath, fileName) {
  const form = new FormData();
  form.append('projectId', PROJECT_ID);
  form.append('file', new Blob([readFileSync(filePath)]), fileName);
  const response = await fetch(`${SITE_BASE}/api/upload`, {
    method: 'POST',
    headers: { authorization: basic },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`上传失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text).assets?.[0];
}

async function importHistory(asset) {
  const response = await fetch(`${SITE_BASE}/api/history/import`, {
    method: 'POST',
    headers: { authorization: basic, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      items: [
        {
          assetId: asset.assetId,
          kind: asset.kind,
          title: process.env.TITLE ?? '外部导入素材',
          source: process.env.SOURCE_NAME ?? 'external',
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`历史导入失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

try {
  let file = await download(SOURCE_URL);
  if (file === null) {
    file = transcode(null, true);
  } else {
    const codec = ffprobe(file);
    console.log('probe codec:', codec, 'bytes:', statSync(file).size);
    if (codec !== 'h264' || statSync(file).size > MAX_BYTES) {
      console.log('编码或体积不满足，转码');
      file = transcode(file);
    }
  }
  const asset = await upload(file, path.basename(file));
  console.log('uploaded:', asset);
  if (process.env.HISTORY === '1') {
    console.log('history:', await importHistory(asset));
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
