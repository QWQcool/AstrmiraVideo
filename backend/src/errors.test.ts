import { describe, expect, it } from 'vitest';
import type { ErrorCode, ErrorDisposition } from '@astrmira/shared';
import {
  ERROR_DISPOSITION,
  ProviderFailureError,
  assertErrorMappingComplete,
  createErrorResponse,
  createTaskError,
  dispositionOf,
  listErrorCodes,
  resolveTaskError,
} from './errors.js';
import { MediaProbeError } from './lib/ffmpeg.js';

/**
 * S3：三态错误码穷举与归属规则（CONTRACT §6 / AC7）。
 *
 * 这里是「UPSTREAM_ERROR（明确返回）vs UNCERTAIN_RESULT（无响应 / 中断）」这条分界的
 * 唯一自动化保障——它失效则防线 7 失效（付费上游会被静默重试）。
 */

/** CONTRACT §6 表的人工副本（只用于比对，不参与实现） */
const CONTRACT_TABLE: Record<ErrorCode, ErrorDisposition> = {
  PROVIDER_UNAVAILABLE: 'terminal',
  GPU_BUSY: 'retryable',
  RATE_LIMITED: 'retryable',
  INVALID_ASSET: 'terminal',
  PROMPT_REJECTED: 'terminal',
  UPSTREAM_ERROR: 'retryable',
  UNCERTAIN_RESULT: 'uncertain',
  TASK_NOT_FOUND: 'terminal',
  DISK_FULL: 'terminal',
  LLM_NOT_CONFIGURED: 'terminal',
  KEY_INVALID: 'terminal',
  KEY_MISSING: 'terminal',
  // V2.3（V9 · B9）：剪辑台引用的码在 V2.2 里漏登记，B9 补齐（见 CONTRACT §6 的说明）
  INVALID_REQUEST: 'terminal',
};

describe('三态映射表（CONTRACT §6，13 个码全覆盖）', () => {
  it('契约码数量为 13（V1.8：9 原有 + 3；V2.3 补 `INVALID_REQUEST`）', () => {
    // 数量断言是刻意的"闸门"：加码必须同时改这里与 CONTRACT §6（两处都改才算数）
    expect(listErrorCodes()).toHaveLength(13);
  });

  it('每个码的处置与 CONTRACT §6 表逐条一致', () => {
    for (const code of listErrorCodes()) {
      expect(ERROR_DISPOSITION[code], `码 ${code} 的处置不一致`).toBe(CONTRACT_TABLE[code]);
    }
  });

  it('运行时自检通过（防手写漂移）', () => {
    expect(() => assertErrorMappingComplete()).not.toThrow();
  });

  it('整个契约里只有一个 uncertain 码：UNCERTAIN_RESULT', () => {
    const uncertainCodes = listErrorCodes().filter((c) => ERROR_DISPOSITION[c] === 'uncertain');
    expect(uncertainCodes).toEqual(['UNCERTAIN_RESULT']);
  });

  it('disposition 一律取自映射表，调用方无法自造', () => {
    expect(createErrorResponse('RATE_LIMITED').disposition).toBe('retryable');
    expect(createErrorResponse('DISK_FULL').disposition).toBe('terminal');
    expect(createTaskError('UNCERTAIN_RESULT').disposition).toBe('uncertain');
    expect(dispositionOf('LLM_NOT_CONFIGURED')).toBe('terminal');
  });

  it('V1.8 新增的三个码都在表里且均为 terminal', () => {
    for (const code of ['LLM_NOT_CONFIGURED', 'KEY_INVALID', 'KEY_MISSING'] as const) {
      expect(ERROR_DISPOSITION[code]).toBe('terminal');
    }
  });
});

describe('resolveTaskError · 归属规则（CONTRACT §6 硬规则 2，V1.8 适用范围）', () => {
  it('护栏：未进入提交阶段时，uncertain 必须降级为 UPSTREAM_ERROR（重试无副作用）', () => {
    const err = new ProviderFailureError('UNCERTAIN_RESULT', '注入：结果不明');

    const resolved = resolveTaskError(err, { submissionAttempted: false });

    expect(resolved.code).toBe('UPSTREAM_ERROR');
    expect(resolved.disposition).toBe('retryable');
  });

  it('已进入提交阶段时，同一错误保持 UNCERTAIN_RESULT（无法排除上游已受理）', () => {
    const err = new ProviderFailureError('UNCERTAIN_RESULT', '注入：结果不明');

    const resolved = resolveTaskError(err, { submissionAttempted: true });

    expect(resolved.code).toBe('UNCERTAIN_RESULT');
    expect(resolved.disposition).toBe('uncertain');
  });

  it('未归类的异常：未进入提交阶段 → UPSTREAM_ERROR；已进入 → UNCERTAIN_RESULT', () => {
    const boom = new Error('socket hang up');

    expect(resolveTaskError(boom, { submissionAttempted: false }).code).toBe('UPSTREAM_ERROR');
    expect(resolveTaskError(boom, { submissionAttempted: true }).code).toBe('UNCERTAIN_RESULT');
  });

  it('上游明确返回错误（4xx/5xx 响应体可读）→ 两种上下文都归 UPSTREAM_ERROR', () => {
    const err = new ProviderFailureError('UPSTREAM_ERROR', '上游返回 502');

    for (const submissionAttempted of [true, false]) {
      const resolved = resolveTaskError(err, { submissionAttempted });
      expect(resolved.code).toBe('UPSTREAM_ERROR');
      expect(resolved.disposition).toBe('retryable');
    }
  });

  it('媒体探测失败 → INVALID_ASSET（terminal），与提交阶段无关', () => {
    const err = new MediaProbeError('broken.mp4', new Error('moov atom not found'));

    for (const submissionAttempted of [true, false]) {
      const resolved = resolveTaskError(err, { submissionAttempted });
      expect(resolved.code).toBe('INVALID_ASSET');
      expect(resolved.disposition).toBe('terminal');
    }
  });

  it('分界可测：同一上下文下，「明确返回」与「无响应」必须落到不同 code', () => {
    const explicit = resolveTaskError(new ProviderFailureError('UPSTREAM_ERROR', '502'), {
      submissionAttempted: true,
    });
    const silent = resolveTaskError(new Error('timeout'), { submissionAttempted: true });

    expect(explicit.code).not.toBe(silent.code);
    expect(explicit.disposition).toBe('retryable');
    expect(silent.disposition).toBe('uncertain');
  });

  it('防恒真抽查：故意把上游错误声称为 uncertain 时，护栏仍会拦住（未进入提交场景）', () => {
    // 若有人把 UPSTREAM_ERROR 强行标成 uncertain，未进入提交阶段时不得放行 uncertain
    const mislabeled = new ProviderFailureError('UPSTREAM_ERROR', '接口抖动', 'uncertain');

    const resolved = resolveTaskError(mislabeled, { submissionAttempted: false });

    expect(resolved.disposition).toBe('retryable');
  });
});
