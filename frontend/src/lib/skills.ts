import {
  emptySkillLibrary,
  SkillLibrarySchema,
  type SkillCategory,
  type SkillLibrary,
} from '@astrmira/shared';
import type { MessageKey } from './i18n';
import { RECIPE_CATEGORY_KEYS } from './recipes';

/** 技能库本地持久化键；S6-A 不新增服务端表/接口。 */
export const SKILL_STORAGE_KEY = 'astrmira.skills.v1';

/** 类别文案：六个配方类别沿用已有键，行业模板单独一条。 */
export const SKILL_CATEGORY_KEYS: Record<SkillCategory, MessageKey> = {
  ...RECIPE_CATEGORY_KEYS,
  industry: 'skills.category.industry',
};

export interface LoadedSkillLibrary {
  library: SkillLibrary;
  /** 本地值损坏时为 true：界面要如实提示，不静默覆盖用户数据。 */
  corrupt: boolean;
}

/**
 * 读取本地技能库。
 *
 * 空存储 = 默认（全部内置启用）；坏值 = 返回空库 + corrupt 标记，
 * 由界面决定是否提示/重置，不在读取函数里悄悄写回。
 */
export function loadSkillLibrary(storage: Storage | undefined = globalThis.localStorage): LoadedSkillLibrary {
  if (storage === undefined) return { library: emptySkillLibrary(), corrupt: false };
  const raw = storage.getItem(SKILL_STORAGE_KEY);
  if (raw === null || raw.trim() === '') return { library: emptySkillLibrary(), corrupt: false };
  try {
    return { library: SkillLibrarySchema.parse(JSON.parse(raw)), corrupt: false };
  } catch {
    return { library: emptySkillLibrary(), corrupt: true };
  }
}

export function saveSkillLibrary(
  library: SkillLibrary,
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(SKILL_STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

/** 启停只改 disabledIds；不删除 custom，也不改内置数据。 */
export function setSkillEnabled(
  library: SkillLibrary,
  id: string,
  enabled: boolean,
): SkillLibrary {
  const disabled = new Set(library.disabledIds);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  return { ...library, disabledIds: [...disabled] };
}

export function isSkillEnabled(library: SkillLibrary, id: string): boolean {
  return !library.disabledIds.includes(id);
}
