import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATFORM_PRESET_ID,
  PLATFORM_PRESETS,
  buildDeliverableFileName,
  buildDeliverableManifest,
  buildDeliverablePackageName,
  findPlatformPreset,
  presetWarnings,
  sanitizeFileSegment,
  type TaskProgress,
} from '@astrmira/shared';
import { planDeliverablePackage } from './deliverablePackage';
import { buildZipStore, crc32, readZipEntryNames, uniqueName } from './zipStore';

/**
 * 交付包（V2.13 / 台账 B49）。
 *
 * 三组断言，对应三类最容易出错、又最值得钉住的东西：
 * ① **ZIP 的字节事实**（魔数 / CRC32 标准校验值 / 中央目录条目名 / 同名去重）；
 * ② **文件命名**（Windows 非法字符 / 空语义兜底 / 序号补零 / 日期戳）；
 * ③ **交付计划**（清单内容与勾选项一致、规格告警只提示不阻断）。
 */

const preset = findPlatformPreset(DEFAULT_PLATFORM_PRESET_ID)!;

function task(over: Partial<TaskProgress> & { taskId: string }): TaskProgress {
  return {
    status: 'succeeded',
    progressPercent: 100,
    createdAt: 1_700_000_000_000,
    requestSnapshot: {
      prompt: '雨夜街头的霓虹',
      mode: 't2v',
      aspectRatio: '9:16',
      provider: 'fixture-local',
      params: { durationSec: 5 },
    },
    ...over,
  } as TaskProgress;
}

describe('§14-① ZIP 字节事实（store-only 写入器）', () => {
  it('CRC32 命中标准校验值（"123456789" → 0xCBF43926）', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf4_3926);
  });

  it('空数据 CRC = 0（ZIP 约定：空条目不报错）', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('写出可被读回的包：魔数正确 + 中央目录条目名与人给的一致', () => {
    const bytes = buildZipStore([
      { name: 'a.mp4', data: new Uint8Array([1, 2, 3]) },
      { name: '子目录/交付清单.json', data: new TextEncoder().encode('{"a":1}') },
    ]);
    // 本地文件头魔数 PK\x03\x04
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // 结尾 22 字节 EOCD 魔数 PK\x05\x06
    expect(Array.from(bytes.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(readZipEntryNames(bytes)).toEqual(['a.mp4', '子目录/交付清单.json']);
  });

  it('空包也能写（只有 EOCD，条目数为 0）—— 不许崩', () => {
    const bytes = buildZipStore([]);
    expect(bytes.length).toBe(22);
    expect(readZipEntryNames(bytes)).toEqual([]);
  });

  it('同名去重：第二个 `a.mp4` 变 `a (2).mp4`（否则解压互相覆盖）', () => {
    const used = new Set<string>();
    expect(uniqueName('a.mp4', used)).toBe('a.mp4');
    expect(uniqueName('a.mp4', used)).toBe('a (2).mp4');
    expect(uniqueName('a.mp4', used)).toBe('a (3).mp4');
    // 无扩展名与多点文件名都要能处理
    expect(uniqueName('noext', used)).toBe('noext');
    expect(uniqueName('noext', used)).toBe('noext (2)');
    expect(uniqueName('a.b.mp4', used)).toBe('a.b.mp4');
  });

  it('包里内容可被逐字节核对（偏移与长度自洽）', () => {
    const payload = new TextEncoder().encode('hello 交付');
    const bytes = buildZipStore([{ name: 'x.txt', data: payload }]);
    // 本地头 30 字节 + 文件名 'x.txt'(5) 之后就是内容
    expect(Array.from(bytes.slice(35, 35 + payload.length))).toEqual(Array.from(payload));
    // UTF-8 标志位（0x0800）必须在：否则 Windows 会把中文名解成乱码
    const flags = bytes[6]! | (bytes[7]! << 8);
    expect((flags & 0x0800) !== 0).toBe(true);
  });
});

describe('§14-② 命名（能直接落进 Windows / macOS）', () => {
  it('归一化：Windows 非法字符与空白折叠，首尾点/横线去掉', () => {
    expect(sanitizeFileSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeFileSegment('  ..雨夜 街头.. ')).toBe('雨夜-街头');
    expect(sanitizeFileSegment('\u0000\u0007')).toBe('');
  });

  it('超长截断，且截断后不留尾随横线（保留扩展名的前提）', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五';
    const cut = sanitizeFileSegment(long, 10);
    expect(cut.length).toBeLessThanOrEqual(10);
    expect(cut.endsWith('-')).toBe(false);
  });

  it('命名模板：项目-日期-序号-档位-语义.mp4；序号按总数补零', () => {
    const name = buildDeliverableFileName({
      preset,
      projectName: '双十一 · 主推片',
      semantic: '霓虹倒影',
      taskId: 'abcdefgh-1111',
      index: 2,
      total: 12,
      ext: 'mp4',
      date: new Date(2026, 9, 10),
    });
    expect(name).toBe('双十一-主推片-20261010-02-抖音竖屏-霓虹倒影.mp4');
  });

  it('空语义 / 空项目名都有兜底（不许出现 `--.mp4` 这种文件名）', () => {
    const name = buildDeliverableFileName({
      preset,
      projectName: '   ',
      semantic: '',
      taskId: 'abcdefgh-1111',
      index: 1,
      total: 1,
      ext: 'mp4',
      date: new Date(2026, 9, 10),
    });
    expect(name).toBe('project-20261010-1-抖音竖屏-abcdefgh.mp4');
  });

  it('包名：项目-日期-档位-N条.zip', () => {
    expect(
      buildDeliverablePackageName({
        projectName: '双十一 主推片',
        preset,
        count: 3,
        date: new Date(2026, 9, 10),
      }),
    ).toBe('双十一-主推片-20261010-抖音竖屏-3条.zip');
  });

  it('预设清单：每条的 basis 都非空（未经实测的数字必须说清来源）', () => {
    for (const item of PLATFORM_PRESETS) {
      expect(item.basis.trim().length).toBeGreaterThan(0);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
    expect(PLATFORM_PRESETS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('§14-③ 规格对齐（只提示，不转码）与交付计划', () => {
  it('画幅不一致 / 超时长 / 分辨率偏低各有对应告警', () => {
    expect(presetWarnings({ aspectRatio: '16:9' }, preset)[0]).toContain('不转码');
    expect(presetWarnings({ durationSec: 90 }, preset)[0]).toContain('超过');
    expect(presetWarnings({ width: 640, height: 360 }, preset)[0]).toContain('低于');
    // 全对齐 → 没有话说（**不硬凑告警**）
    expect(presetWarnings({ aspectRatio: '9:16', durationSec: 5 }, preset)).toEqual([]);
  });

  it('计划：文件名与清单逐条一致，序号跟传入顺序（= 界面看到的顺序）', () => {
    const plan = planDeliverablePackage(
      [
        task({ taskId: 'aaaaaaaa-1', outputVideoUrl: '/media/aaaaaaaa-1.mp4' }),
        task({
          taskId: 'bbbbbbbb-2',
          thumbnailUrl: '/media/thumbs/bbbbbbbb-2.jpg',
          outputVideoUrl: '/media/bbbbbbbb-2.mp4',
          requestSnapshot: {
            prompt: '暖光客厅',
            mode: 't2v',
            aspectRatio: '9:16',
            provider: 'fixture-local',
            params: { durationSec: 6 },
          },
        }),
      ],
      {
        preset,
        projectName: '乐米 · 样片',
        projectId: 'default',
        includeVideo: true,
        includeProject: false,
        includeCover: true,
        includeManifest: true,
        date: new Date(2026, 9, 10),
      },
    );

    expect(plan.items[0]!.videoFileName).toBe('乐米-样片-20261010-1-抖音竖屏-雨夜街头的霓虹.mp4');
    expect(plan.items[1]!.videoFileName).toBe('乐米-样片-20261010-2-抖音竖屏-暖光客厅.mp4');
    expect(plan.items[0]!.coverFileName).toBe(''); // 没有封面 → 空串，不编一个名字
    expect(plan.items[1]!.coverFileName).toBe('乐米-样片-20261010-2-抖音竖屏-暖光客厅.cover.jpg');
    expect(plan.manifestFileName).toBe('交付清单.json');
    // 条目数 = 2 条成片 + 1 个封面 + 1 份清单
    expect(plan.plannedEntryCount).toBe(4);
    expect(plan.manifest.items[1]!.fileName).toBe(plan.items[1]!.videoFileName);
    expect(plan.manifest.items[0]!.packaged).toBe(true);
  });

  it('关掉成片 → 清单如实标 `packaged: false`（清单比包大时能解释得清）', () => {
    const plan = planDeliverablePackage([task({ taskId: 'aaaaaaaa-1' })], {
      preset,
      projectName: 'P',
      projectId: 'default',
      includeVideo: false,
      includeProject: false,
      includeCover: false,
      includeManifest: true,
    });
    expect(plan.plannedEntryCount).toBe(1);
    expect(plan.manifest.items[0]!.packaged).toBe(false);
    expect(plan.manifest.notes.join(' ')).toContain('清单内引用');
  });

  it('清单带着口径说明（金额是预估 + 未做转码）', () => {
    const manifest = buildDeliverableManifest({
      project: { projectId: 'default', name: 'P' },
      preset,
      items: [],
      generatedAt: 0,
    });
    expect(manifest.notes.join(' ')).toContain('以火山方舟控制台账单为准');
    expect(manifest.notes.join(' ')).toContain('未做平台转码');
    expect(manifest.manifestVersion).toBe(1);
  });
});
