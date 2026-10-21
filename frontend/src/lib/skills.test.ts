import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SKILLS,
  INDUSTRY_TEMPLATES,
  RECIPE_CARDS,
  SkillLibrarySchema,
  SkillManifestSchema,
  emptySkillLibrary,
  findSkill,
  skillFromRecipe,
  skillFromTemplate,
} from '@astrmira/shared';
import {
  SKILL_STORAGE_KEY,
  findSkillInLibrary,
  isSkillEnabled,
  loadSkillLibrary,
  saveSkillLibrary,
  setSkillEnabled,
} from './skills';

/**
 * S6-A1：技能 manifest 的结构校验与内置迁移。
 *
 * 这一层只证明“数据能安全地交给技能库/Agent”，不证明 UI 已接线：
 * - 内置技能必须覆盖现有配方 + 行业模板，提示词逐字不变；
 * - 自建技能不得与内置 id 冲突、不得冒充内置 origin；
 * - 本地库默认值可解析，坏数据必须拒绝。
 */

function customSkill(overrides: Record<string, unknown> = {}) {
  return SkillManifestSchema.parse({
    version: 1,
    id: 'user-my-look',
    name: '我的风格',
    summary: '我自己的镜头风格',
    category: 'mood',
    origin: 'user',
    triggers: ['我的风格'],
    prompt: '暖色逆光，浅景深，缓慢推近。',
    params: {},
    modes: ['t2v'],
    requiresImage: false,
    notes: [],
    ...overrides,
  });
}

describe('S6-A1 · 内置技能迁移', () => {
  it('覆盖全部配方 + 行业模板，id 唯一', () => {
    expect(BUILTIN_SKILLS).toHaveLength(RECIPE_CARDS.length + INDUSTRY_TEMPLATES.length);
    const ids = BUILTIN_SKILLS.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条都通过 schema，且 prompt 与源数据逐字一致', () => {
    for (const recipe of RECIPE_CARDS) {
      const skill = findSkill(recipe.id);
      expect(skill, recipe.id).toBeDefined();
      expect(skill?.prompt).toBe(recipe.skeleton);
      expect(skill?.origin).toBe('recipe');
      expect(skill?.name).toBe(recipe.title);
      expect(skill?.modes).toEqual(recipe.modes);
    }
    for (const template of INDUSTRY_TEMPLATES) {
      const skill = findSkill(template.id);
      expect(skill, template.id).toBeDefined();
      expect(skill?.prompt).toBe(template.skeleton);
      expect(skill?.summary).toBe(template.summary);
      expect(skill?.origin).toBe('template');
      expect(skill?.params).toMatchObject({
        aspectRatio: template.aspectRatio,
        resolutionTier: template.resolutionTier,
        durationSec: template.durationSec,
      });
      expect(skill?.industry).toBe(template.industry);
    }
  });

  it('所有内置 manifest 可再次 parse（没有隐藏的宽类型）', () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(() => SkillManifestSchema.parse(skill)).not.toThrow();
      expect(skill.prompt.trim().length).toBeGreaterThan(0);
      expect(skill.triggers.length).toBeGreaterThan(0);
      expect(skill.modes.length).toBeGreaterThan(0);
    }
  });

  it('迁移函数不覆盖源字段：recipe/template 的 prompt 都来自原文', () => {
    const recipe = RECIPE_CARDS[0];
    const template = INDUSTRY_TEMPLATES[0];
    expect(recipe).toBeDefined();
    expect(template).toBeDefined();
    if (recipe) expect(skillFromRecipe(recipe).prompt).toBe(recipe.skeleton);
    if (template) expect(skillFromTemplate(template).prompt).toBe(template.skeleton);
  });

  it('findSkill：命中返回同一份数据，未知/undefined 返回 undefined', () => {
    const first = BUILTIN_SKILLS[0];
    expect(first).toBeDefined();
    expect(findSkill(first?.id)?.prompt).toBe(first?.prompt);
    expect(findSkill('no-such-skill')).toBeUndefined();
    expect(findSkill(undefined)).toBeUndefined();
  });
});

describe('S6-A1 · 本地技能库 schema', () => {
  it('空库可解析，默认没有自定义/停用项', () => {
    const empty = emptySkillLibrary();
    expect(() => SkillLibrarySchema.parse(empty)).not.toThrow();
    expect(empty.custom).toEqual([]);
    expect(empty.disabledIds).toEqual([]);
  });

  it('自建技能：origin=user 可保存；缺省字段补默认值', () => {
    const skill = customSkill();
    const library = SkillLibrarySchema.parse({ version: 1, custom: [skill] });
    expect(library.custom).toHaveLength(1);
    expect(library.custom[0]?.origin).toBe('user');
    expect(library.custom[0]?.params).toEqual({});
    expect(library.disabledIds).toEqual([]);
  });

  it('自建技能不得与内置 id 冲突', () => {
    const builtin = BUILTIN_SKILLS[0];
    expect(builtin).toBeDefined();
    if (!builtin) return;
    const skill = customSkill({ id: builtin.id });
    expect(() => SkillLibrarySchema.parse({ version: 1, custom: [skill] })).toThrow();
  });

  it('自建技能不得冒充 recipe/template origin', () => {
    const skill = customSkill({ origin: 'recipe' });
    expect(() => SkillLibrarySchema.parse({ version: 1, custom: [skill] })).toThrow();
  });

  it('自建技能 id 重复会被拒绝', () => {
    const skill = customSkill();
    expect(() => SkillLibrarySchema.parse({ version: 1, custom: [skill, skill] })).toThrow();
  });

  it('非法 id / 空 prompt / 空 triggers 会被 schema 拒绝', () => {
    expect(() => customSkill({ id: 'Bad_ID' })).toThrow();
    expect(() => customSkill({ prompt: '   ' })).toThrow();
    expect(() => customSkill({ triggers: [] })).toThrow();
  });
});

describe('S6-A2 · 本地启停与读取', () => {
  function memoryStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial));
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      key: (index: number) => [...data.keys()][index] ?? null,
      removeItem: (key: string) => data.delete(key),
      setItem: (key: string, value: string) => data.set(key, value),
    };
  }

  it('默认启用；setSkillEnabled 只改 disabledIds，可反复启停', () => {
    let library = emptySkillLibrary();
    expect(isSkillEnabled(library, 'camera-push-in-slow')).toBe(true);
    library = setSkillEnabled(library, 'camera-push-in-slow', false);
    expect(isSkillEnabled(library, 'camera-push-in-slow')).toBe(false);
    library = setSkillEnabled(library, 'camera-push-in-slow', true);
    expect(isSkillEnabled(library, 'camera-push-in-slow')).toBe(true);
    expect(library.custom).toEqual([]);
  });

  it('空存储 = 默认库；合法 JSON = 原样恢复；坏 JSON = 空库 + corrupt', () => {
    const empty = loadSkillLibrary(memoryStorage());
    expect(empty.corrupt).toBe(false);
    expect(empty.library.disabledIds).toEqual([]);

    const valid = loadSkillLibrary(
      memoryStorage({
        [SKILL_STORAGE_KEY]: JSON.stringify({
          version: 1,
          custom: [],
          disabledIds: ['camera-push-in-slow'],
        }),
      }),
    );
    expect(valid.corrupt).toBe(false);
    expect(valid.library.disabledIds).toEqual(['camera-push-in-slow']);

    const broken = loadSkillLibrary(memoryStorage({ [SKILL_STORAGE_KEY]: '{not json' }));
    expect(broken.corrupt).toBe(true);
    expect(broken.library.disabledIds).toEqual([]);
  });

  it('saveSkillLibrary 写回同一份 schema 数据', () => {
    const storage = memoryStorage();
    const library = setSkillEnabled(emptySkillLibrary(), 'camera-push-in-slow', false);
    expect(saveSkillLibrary(library, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(SKILL_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 1,
      disabledIds: ['camera-push-in-slow'],
    });
  });

  it('findSkillInLibrary 同时找内置与自建；未知返回 undefined', () => {
    const custom = customSkill();
    const library = SkillLibrarySchema.parse({ version: 1, custom: [custom] });
    expect(findSkillInLibrary(library, 'camera-push-in-slow')?.origin).toBe('recipe');
    expect(findSkillInLibrary(library, custom.id)?.name).toBe('我的风格');
    expect(findSkillInLibrary(library, 'no-such-skill')).toBeUndefined();
  });
});
