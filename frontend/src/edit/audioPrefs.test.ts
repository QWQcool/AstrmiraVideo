import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, type StorageAccess, type StorageLike } from '../lib/storage';
import {
  DEFAULT_AUDIO_PREFS,
  audioPrefsEqual,
  parseAudioPrefs,
  readAudioPrefs,
  writeAudioPrefs,
} from './audioPrefs';

/**
 * 声音面板的偏好记忆（V2.112）。
 *
 * 重点不在"能存能取"，而在**坏数据不能把面板弄白**：本地存储是用户可编辑的，
 * 老版本可能留着已下架的音色 id，手改一下就能是任意字符串。
 */

function memoryStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const store: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  const access: StorageAccess = { local: store };
  return { access, data };
}

describe('声音面板偏好（V2.112）', () => {
  it('没存过 → 默认（配音 + 冰糖 + 空风格）', () => {
    expect(readAudioPrefs({})).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('存了再读 → 原样回来', () => {
    const { access } = memoryStore();
    writeAudioPrefs(access, { mode: 'bgm', voice: '茉莉', style: '纪录片旁白，低沉克制' });
    expect(readAudioPrefs(access)).toEqual({
      mode: 'bgm',
      voice: '茉莉',
      style: '纪录片旁白，低沉克制',
    });
  });

  it('坏 JSON / 非对象 → 默认，不抛', () => {
    expect(parseAudioPrefs('{不是 JSON')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('"字符串"')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('null')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parseAudioPrefs('')).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('未知模式 / 已下架音色 → 各自回落默认（不整体丢弃）', () => {
    // 音色认不出来，但风格是好的 —— 好的字段要留下，别把整条记录丢掉
    const parsed = parseAudioPrefs(
      JSON.stringify({ mode: 'karaoke', voice: '某个已下架音色', style: '温柔的钢琴' }),
    );
    expect(parsed.mode).toBe(DEFAULT_AUDIO_PREFS.mode);
    expect(parsed.voice).toBe(DEFAULT_AUDIO_PREFS.voice);
    expect(parsed.style).toBe('温柔的钢琴');
  });

  it('风格指令超长会截断（防一次误粘贴把存储撑坏）', () => {
    const long = '钢'.repeat(500);
    expect(parseAudioPrefs(JSON.stringify({ style: long })).style).toHaveLength(120);
  });

  it('读写都不碰内容与时长（只记模式/音色/风格）', () => {
    const { access, data } = memoryStore();
    writeAudioPrefs(access, { mode: 'sfx', voice: 'Mia', style: '' });
    const raw = data.get(STORAGE_KEYS.audioPrefs) ?? '';
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['mode', 'style', 'voice']);
  });

  it('存储不可用（隐私模式）时静默降级', () => {
    expect(() => writeAudioPrefs({}, { mode: 'tts', voice: '冰糖', style: '' })).not.toThrow();
    expect(readAudioPrefs({}).mode).toBe(DEFAULT_AUDIO_PREFS.mode);
  });

  it('比较函数只认这三个字段的等价', () => {
    expect(
      audioPrefsEqual(
        { mode: 'bgm', voice: '冰糖', style: '' },
        { mode: 'bgm', voice: '冰糖', style: '' },
      ),
    ).toBe(true);
    expect(
      audioPrefsEqual(
        { mode: 'bgm', voice: '冰糖', style: '' },
        { mode: 'bgm', voice: '冰糖', style: '轻快' },
      ),
    ).toBe(false);
  });
});
