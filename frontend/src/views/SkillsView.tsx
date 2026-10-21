import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_SKILLS,
  type SkillCategory,
  type SkillManifest,
} from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { useTranslate, type MessageKey } from '../lib/i18n';
import { staggerStyle } from '../lib/motion';
import {
  SKILL_CATEGORY_KEYS,
  isSkillEnabled,
  loadSkillLibrary,
  saveSkillLibrary,
  setSkillEnabled,
} from '../lib/skills';

/**
 * 技能库（S6-A2）。
 *
 * 这一片只做“看得见、找得到、能启停、能看详情”：
 * - 数据来自 `BUILTIN_SKILLS`（S6-A1 的 54 条内置迁移）；
 * - 启停/本地库写 `astrmira.skills.v1`，不新增 API/表；
 * - **不在这里应用技能**；应用与草稿填充是 S6-A3，避免“点一下就把提示词改了”的假动作。
 *
 * 卡片沿用配方库的 `.recipe-*` 视觉，但详情是独立面板，不复制旧 RecipesView。
 */

const ORIGIN_KEYS: Record<SkillManifest['origin'], MessageKey> = {
  recipe: 'skills.origin.recipe',
  template: 'skills.origin.template',
  user: 'skills.origin.user',
};

type CategoryFilter = SkillCategory | 'all';

function matches(skill: SkillManifest, category: CategoryFilter, query: string): boolean {
  if (category !== 'all' && skill.category !== category) return false;
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [skill.name, skill.summary, skill.prompt, ...skill.triggers]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function SkillsView() {
  const t = useTranslate();
  const [loaded] = useState(() => loadSkillLibrary());
  const [library, setLibrary] = useState(loaded.library);
  const [corrupt, setCorrupt] = useState(loaded.corrupt);
  const [dirty, setDirty] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) saveSkillLibrary(library);
  }, [dirty, library]);

  const skills = useMemo(
    () => BUILTIN_SKILLS.filter((skill) => matches(skill, category, query)),
    [category, query],
  );
  const enabledCount = useMemo(
    () => BUILTIN_SKILLS.filter((skill) => isSkillEnabled(library, skill.id)).length,
    [library],
  );
  const selected = selectedId === null
    ? undefined
    : BUILTIN_SKILLS.find((skill) => skill.id === selectedId);
  const selectedEnabled = selected === undefined ? true : isSkillEnabled(library, selected.id);

  const toggle = (id: string): void => {
    setDirty(true);
    setCorrupt(false);
    setLibrary((previous) => setSkillEnabled(previous, id, !isSkillEnabled(previous, id)));
  };

  return (
    <section className="wb-page">
      <div className="wb-page-head wb-page-head-row">
        <div>
          <h1 className="wb-page-title">{t('skills.title')}</h1>
          <Eyebrow tone="gold">Skills</Eyebrow>
        </div>
        <span className="wb-note">{t('skills.intro')}</span>
      </div>

      {corrupt ? (
        <p className="wb-alert" role="status">
          {t('skills.storageCorrupt')}
        </p>
      ) : null}

      <div className="lib-toolbar">
        <label className="wb-field lib-search">
          <input
            className="wb-input"
            data-testid="skills-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('skills.search.placeholder')}
            aria-label={t('skills.search.aria')}
          />
        </label>

        <div className="chips" role="group" aria-label={t('skills.filter.aria')}>
          <button
            type="button"
            className="lib-chip"
            data-testid="skills-category-all"
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            {t('skills.filter.all')}
          </button>
          {(Object.keys(SKILL_CATEGORY_KEYS) as SkillCategory[]).map((key) => (
            <button
              key={key}
              type="button"
              className="lib-chip"
              data-testid={`skills-category-${key}`}
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {t(SKILL_CATEGORY_KEYS[key])}
            </button>
          ))}
        </div>

        <span className="wb-note" style={{ marginLeft: 'auto' }}>
          {t('skills.count', {
            shown: skills.length,
            total: BUILTIN_SKILLS.length,
            enabled: enabledCount,
          })}
        </span>
      </div>

      {selected === undefined ? null : (
        <aside className="skills-detail" data-testid="skill-detail" aria-label={t('skills.detail.title')}>
          <div className="skills-detail-head">
            <div>
              <h2 className="skills-detail-title">{selected.name}</h2>
              <div className="skills-detail-meta">
                <span className="recipe-tag recipe-tag--gold">
                  {t(SKILL_CATEGORY_KEYS[selected.category])}
                </span>
                <span className="recipe-tag">{t(ORIGIN_KEYS[selected.origin])}</span>
                <span className="recipe-tag">
                  {selectedEnabled ? t('skills.enabled') : t('skills.disabled')}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="wb-btn"
              aria-label={t('skills.detail.close')}
              onClick={() => setSelectedId(null)}
            >
              ×
            </button>
          </div>

          <p className="skills-detail-summary">{selected.summary}</p>

          <div className="skills-detail-grid">
            <section>
              <h3 className="skills-detail-label">{t('skills.detail.prompt')}</h3>
              <p className="skills-detail-prompt">{selected.prompt}</p>
            </section>
            <section>
              <h3 className="skills-detail-label">{t('skills.detail.params')}</h3>
              <div className="skills-detail-meta">
                {selected.params.aspectRatio === undefined ? null : (
                  <span className="recipe-tag">
                    {t('skills.detail.aspect')} {selected.params.aspectRatio}
                  </span>
                )}
                {selected.params.resolutionTier === undefined ? null : (
                  <span className="recipe-tag">
                    {t('skills.detail.resolution')} {selected.params.resolutionTier}
                  </span>
                )}
                {selected.params.durationSec === undefined ? null : (
                  <span className="recipe-tag">
                    {t('skills.detail.duration')}{' '}
                    {t('skills.detail.seconds', { seconds: selected.params.durationSec })}
                  </span>
                )}
              </div>
              <h3 className="skills-detail-label">{t('skills.detail.modes')}</h3>
              <div className="skills-detail-meta">
                {selected.modes.map((mode) => (
                  <span className="recipe-tag" key={mode}>
                    {mode}
                  </span>
                ))}
              </div>
            </section>
          </div>

          <h3 className="skills-detail-label">{t('skills.detail.notes')}</h3>
          {selected.notes.length === 0 ? (
            <p className="wb-note">{t('skills.detail.noNotes')}</p>
          ) : (
            <ul className="recipe-card-pitfalls">
              {selected.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          <div className="skills-detail-actions">
            <button
              type="button"
              className="wb-btn wb-btn-gold"
              data-testid="skill-detail-toggle"
              aria-pressed={selectedEnabled}
              onClick={() => toggle(selected.id)}
            >
              {selectedEnabled ? t('skills.disable') : t('skills.enable')}
            </button>
          </div>
        </aside>
      )}

      {skills.length === 0 ? (
        <p className="wb-note">{t('skills.empty')}</p>
      ) : (
        <div className="recipe-grid">
          {skills.map((skill, index) => {
            const enabled = isSkillEnabled(library, skill.id);
            return (
              <article
                className="recipe-card"
                key={skill.id}
                data-testid={`skill-card-${skill.id}`}
                style={staggerStyle(index)}
              >
                <div className="recipe-card-top">
                  <span className="recipe-card-title">{skill.name}</span>
                  <span className="recipe-tag recipe-tag--gold">
                    {t(SKILL_CATEGORY_KEYS[skill.category])}
                  </span>
                  <span className="recipe-tag">{skill.modes.join(' · ')}</span>
                </div>

                <p className="recipe-card-skeleton">{skill.summary}</p>

                {skill.notes.length === 0 ? null : (
                  <ul className="recipe-card-pitfalls">
                    {skill.notes.slice(0, 2).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}

                <div className="recipe-card-foot">
                  <span className="recipe-tag">{t(ORIGIN_KEYS[skill.origin])}</span>
                  <span className="recipe-tag">
                    {enabled ? t('skills.enabled') : t('skills.disabled')}
                  </span>
                  <span className="recipe-card-actions">
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() => setSelectedId(skill.id)}
                    >
                      {t('skills.card.detail')}
                    </button>
                    <button
                      type="button"
                      className="wb-btn"
                      data-testid={`skill-toggle-${skill.id}`}
                      aria-pressed={enabled}
                      onClick={() => toggle(skill.id)}
                    >
                      {enabled ? t('skills.disable') : t('skills.enable')}
                    </button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
