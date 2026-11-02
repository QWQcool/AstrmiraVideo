import {
  AUDIO_MODES,
  AUDIO_VOICES,
  DEFAULT_AUDIO_VOICE,
  type AudioMode,
} from '@astrmira/shared';
import { STORAGE_KEYS, readLocal, writeLocal, type StorageAccess } from '../lib/storage';

/**
 * 声音面板的**偏好记忆**（V2.112）。
 *
 * ## 只记三样，不记内容
 * 记 `mode` / `voice` / `style` —— 它们是"我怎么配声音"的偏好；**不记**台词与配乐描述，
 * 那是这一条片子的内容，换个片子还留着会让人误以为写过了。
 *
 * **也不记 `seconds`**：时长默认跟着片子走（`contentEndFrame / fps`），
 * 把上一部 30s 片的时长记到这一部 5s 片上是个坏默认 —— 用户会得到一段被裁到 5s 的配乐，
 * 却以为"我要了 30 秒"。
 *
 * ## 读的时候必须逐字段校验
 * 本地存储是**用户可编辑的**：老版本可能存了已下架的音色 id，或者被手改成 `"mode":"foo"`。
 * 一律回落默认值，**不抛异常**（抛了就是整块面板白屏）。
 */

export interface AudioPrefs {
  mode: AudioMode;
  voice: string;
  style: string;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  mode: 'tts',
  voice: DEFAULT_AUDIO_VOICE,
  style: '',
};

/** 情绪/风格指令最长留多少（与服务端的上限无关，这里只防一条误粘贴的长文本把存储撑坏） */
const MAX_STYLE_CHARS = 120;

/** 注：显式标成 `Set<string>` —— 音色 id 是字面量联合，直接 `new Set(...)` 会收窄成那个联合，`has(string)` 就过不去 */
const VOICE_IDS: Set<string> = new Set(AUDIO_VOICES.map((entry) => entry.id));

function isAudioMode(value: unknown): value is AudioMode {
  return typeof value === 'string' && (AUDIO_MODES as readonly string[]).includes(value);
}

/** 把存储里的原始字符串解析成可信的偏好（坏值逐个回落，不整体丢弃） */
export function parseAudioPrefs(raw: string | null, fallback: AudioPrefs = DEFAULT_AUDIO_PREFS): AudioPrefs {
  if (raw === null || raw.trim() === '') return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (parsed === null || typeof parsed !== 'object') return fallback;
  const source = parsed as Partial<Record<keyof AudioPrefs, unknown>>;

  return {
    mode: isAudioMode(source.mode) ? source.mode : fallback.mode,
    // 音色可能因为版本更迭消失：认不出来就用默认，而不是留一个发不出去的 id
    voice:
      typeof source.voice === 'string' && VOICE_IDS.has(source.voice) ? source.voice : fallback.voice,
    style: typeof source.style === 'string' ? source.style.slice(0, MAX_STYLE_CHARS) : fallback.style,
  };
}

export function readAudioPrefs(access: StorageAccess, fallback?: AudioPrefs): AudioPrefs {
  return parseAudioPrefs(readLocal(access, STORAGE_KEYS.audioPrefs), fallback);
}

export function writeAudioPrefs(access: StorageAccess, prefs: AudioPrefs): void {
  writeLocal(access, STORAGE_KEYS.audioPrefs, JSON.stringify(prefs));
}

/** 只在真的变了才写（面板每次输入都会触发 effect，不做比较会一秒写十几次存储） */
export function audioPrefsEqual(left: AudioPrefs, right: AudioPrefs): boolean {
  return left.mode === right.mode && left.voice === right.voice && left.style === right.style;
}
