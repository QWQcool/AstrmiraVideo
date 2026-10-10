import { describe, expect, it } from 'vitest';
import {
  AspectRatioSchema,
  INDUSTRY_TEMPLATES,
  IndustryTemplateSchema,
  findIndustryTemplate,
  GenerationModeSchema,
} from '@astrmira/shared';

/**
 * 行业模板（V2.23 / 台账 B71）。
 *
 * 数据即产品：模板是**销售材料**，写错一条就是当场演示翻车。这里把三件事钉住 ——
 * ① 形状合法（能被界面安全消费）；② id 唯一（否则 key 与跳转都失去意义）；
 * ③ **每条都有出处与使用要点**（不许出现"看起来很专业但没依据"的模板）。
 */
describe('行业模板（B71）', () => {
  it('每条都通过 schema（含画幅 / 模式 / 清晰度枚举）', () => {
    expect(INDUSTRY_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const template of INDUSTRY_TEMPLATES) {
      const parsed = IndustryTemplateSchema.safeParse(template);
      expect(parsed.success, `${template.id} 形状不合法`).toBe(true);
      // 枚举值必须真在契约里（防手写错字，如 '9x16' / 't2v ' 之类）
      expect(AspectRatioSchema.safeParse(template.aspectRatio).success).toBe(true);
      expect(GenerationModeSchema.safeParse(template.recommendedMode).success).toBe(true);
    }
  });

  it('id 唯一（chips 的 key 与深链接都靠它）', () => {
    const ids = INDUSTRY_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条的提示词骨架 / 说明 / 使用要点 / 出处都不为空（不许无源之谈）', () => {
    for (const template of INDUSTRY_TEMPLATES) {
      expect(template.skeleton.length, `${template.id} 骨架太短`).toBeGreaterThan(30);
      expect(template.summary.length).toBeGreaterThan(10);
      expect(template.notes.length, `${template.id} 缺少使用要点`).toBeGreaterThan(0);
      expect(template.source.length, `${template.id} 缺少出处`).toBeGreaterThan(0);
      expect(template.durationSec).toBeGreaterThan(0);
    }
  });

  it('纪律写进了骨架：不出现文字/logo（中文与 logo 一律后置）', () => {
    for (const template of INDUSTRY_TEMPLATES) {
      expect(template.skeleton).toContain('logo');
    }
  });

  it('findIndustryTemplate：命中返回对象、未命中返回 null（不抛）', () => {
    expect(findIndustryTemplate(INDUSTRY_TEMPLATES[0]!.id)?.industry).toBe(
      INDUSTRY_TEMPLATES[0]!.industry,
    );
    expect(findIndustryTemplate('nope')).toBeNull();
  });
});
