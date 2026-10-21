import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_SKILLS,
  SkillManifestSchema,
  type AspectRatio,
  type GenerationMode,
  type SkillCategory,
  type SkillManifest,
} from '@astrmira/shared';
import { Eyebrow } from '../components/Eyebrow';
import { useTranslate, type MessageKey } from '../lib/i18n';
import { staggerStyle } from '../lib/motion';
import { navigate } from '../lib/router';
import { RESOLUTION_TIERS } from '../lib/format';
import {
  SKILL_CATEGORY_KEYS,
  SKILL_MODE_KEYS,
  isSkillEnabled,
  loadSkillLibrary,
  saveSkillLibrary,
  setSkillEnabled,
} from '../lib/skills';

/**
 * 技能库（S6-A2/A3）。
 *
 * - 内置 54 条技能 + 本机自建技能；启停/自建都只写 `astrmira.skills.v1`，零 API/表；
 * - 详情只“应用”到创作草稿（提示词 + 参数），**不提交生成**；
 * - 自建技能用结构化表单，不执行任意脚本/URL；能力不足在 CreateView 应用时明确拒绝。
 *
 * 卡片沿用配方库 `.recipe-*` 视觉；详情/表单是独立面板，不复制旧 RecipesView。
 */

const ORIGIN_KEYS: Record<SkillManifest['origin'], MessageKey> = {
  recipe: 'skills.origin.recipe',
  template: 'skills.origin.template',
  user: 'skills.origin.user',
};

const ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];
const MODES = Object.keys(SKILL_MODE_KEYS) as GenerationMode[];

type CategoryFilter = SkillCategory | 'all';

interface SkillDraft {
  name: string;
  summary: string;
  prompt: string;
  category: SkillCategory;
  modes: GenerationMode[];
  aspectRatio: AspectRatio;
  resolutionTier: (typeof RESOLUTION_TIERS)[number];
  durationSec: string;
  triggers: string;
  notes: string;
  requiresImage: boolean;
}

function emptyDraft(): SkillDraft {
  return {
    name: '',
    summary: '',
    prompt: '',
    category: 'mood',
    modes: ['t2v'],
    aspectRatio: '16:9',
    resolutionTier: '720p',
    durationSec: '5',
    triggers: '',
    notes: '',
    requiresImage: false,
  };
}

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
  const [editor, setEditor] = useState<SkillDraft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) saveSkillLibrary(library);
  }, [dirty, library]);

  const allSkills = useMemo(
    () => [...BUILTIN_SKILLS, ...library.custom],
    [library.custom],
  );
  const skills = useMemo(
    () => allSkills.filter((skill) => matches(skill, category, query)),
    [allSkills, category, query],
  );
  const enabledCount = useMemo(
    () => allSkills.filter((skill) => isSkillEnabled(library, skill.id)).length,
    [allSkills, library],
  );
  const selected =
    selectedId === null ? undefined : allSkills.find((skill) => skill.id === selectedId);
  const selectedEnabled = selected === undefined ? true : isSkillEnabled(library, selected.id);

  const toggle = (id: string): void => {
    setDirty(true);
    setCorrupt(false);
    setStatus(null);
    setLibrary((previous) => setSkillEnabled(previous, id, !isSkillEnabled(previous, id)));
  };

  const openEditor = (): void => {
    setEditor(emptyDraft());
    setEditorError(null);
    setStatus(null);
  };

  const saveSkill = (): void => {
    if (editor === null) return;
    const triggers = editor.triggers
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    const notes = editor.notes
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    const durationSec = editor.durationSec.trim() === '' ? undefined : Number(editor.durationSec);
    const manifest = {
      version: 1 as const,
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: editor.name,
      summary: editor.summary,
      category: editor.category,
      origin: 'user' as const,
      triggers: triggers.length === 0 ? [editor.name] : triggers,
      prompt: editor.prompt,
      params: {
        aspectRatio: editor.aspectRatio,
        resolutionTier: editor.resolutionTier,
        ...(durationSec === undefined ? {} : { durationSec }),
      },
      modes: editor.modes,
      requiresImage: editor.requiresImage,
      notes,
    };
    const parsed = SkillManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      setEditorError(t('skills.editor.invalid'));
      return;
    }
    setLibrary((previous) => ({
      ...previous,
      custom: [...previous.custom, parsed.data],
    }));
    setDirty(true);
    setCorrupt(false);
    setEditor(null);
    setEditorError(null);
    setSelectedId(parsed.data.id);
    setStatus(t('skills.editor.created', { name: parsed.data.name }));
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
      {status === null ? null : (
        <p className="wb-alert" role="status">
          {status}
        </p>
      )}

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
            total: allSkills.length,
            enabled: enabledCount,
          })}
        </span>
        <button type="button" className="wb-btn" data-testid="skill-new" onClick={openEditor}>
          {t('skills.new')}
        </button>
      </div>

      {editor === null ? null : (
        <form
          className="skills-editor"
          data-testid="skill-editor"
          onSubmit={(event) => {
            event.preventDefault();
            saveSkill();
          }}
        >
          <div className="skills-editor-head">
            <h2 className="skills-detail-title">{t('skills.editor.title')}</h2>
            <button
              type="button"
              className="wb-btn"
              aria-label={t('skills.editor.cancel')}
              onClick={() => setEditor(null)}
            >
              ×
            </button>
          </div>

          {editorError === null ? null : (
            <p className="wb-alert" role="alert">
              {editorError}
            </p>
          )}

          <div className="skills-editor-grid">
            <label className="wb-field">
              <span className="wb-label">{t('skills.editor.name')}</span>
              <input
                className="wb-input"
                data-testid="skill-name"
                value={editor.name}
                maxLength={80}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              />
            </label>
            <label className="wb-field">
              <span className="wb-label">{t('skills.editor.category')}</span>
              <select
                className="wb-input"
                value={editor.category}
                onChange={(event) =>
                  setEditor({ ...editor, category: event.target.value as SkillCategory })
                }
              >
                {(Object.keys(SKILL_CATEGORY_KEYS) as SkillCategory[]).map((key) => (
                  <option key={key} value={key}>
                    {t(SKILL_CATEGORY_KEYS[key])}
                  </option>
                ))}
              </select>
            </label>
            <label className="wb-field skills-editor-wide">
              <span className="wb-label">{t('skills.editor.summary')}</span>
              <input
                className="wb-input"
                data-testid="skill-summary"
                value={editor.summary}
                maxLength={240}
                onChange={(event) => setEditor({ ...editor, summary: event.target.value })}
              />
            </label>
            <label className="wb-field skills-editor-wide">
              <span className="wb-label">{t('skills.editor.prompt')}</span>
              <textarea
                className="wb-input skills-editor-textarea"
                data-testid="skill-prompt"
                rows={5}
                value={editor.prompt}
                onChange={(event) => setEditor({ ...editor, prompt: event.target.value })}
              />
            </label>
            <label className="wb-field">
              <span className="wb-label">{t('skills.editor.aspect')}</span>
              <select
                className="wb-input"
                value={editor.aspectRatio}
                onChange={(event) =>
                  setEditor({ ...editor, aspectRatio: event.target.value as AspectRatio })
                }
              >
                {ASPECTS.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label className="wb-field">
              <span className="wb-label">{t('skills.editor.resolution')}</span>
              <select
                className="wb-input"
                value={editor.resolutionTier}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    resolutionTier: event.target.value as SkillDraft['resolutionTier'],
                  })
                }
              >
                {RESOLUTION_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </label>
            <label className="wb-field">
              <span className="wb-label">{t('skills.editor.duration')}</span>
              <input
                className="wb-input"
                type="number"
                min={1}
                step={1}
                value={editor.durationSec}
                onChange={(event) => setEditor({ ...editor, durationSec: event.target.value })}
              />
            </label>
            <label className="wb-field">
              <span className="wb-label">{t('skills.editor.triggers')}</span>
              <input
                className="wb-input"
                data-testid="skill-triggers"
                value={editor.triggers}
                placeholder={t('skills.editor.triggersHint')}
                onChange={(event) => setEditor({ ...editor, triggers: event.target.value })}
              />
            </label>
            <fieldset className="wb-field skills-editor-wide skills-editor-checks">
              <legend className="wb-label">{t('skills.editor.modes')}</legend>
              {MODES.map((mode) => (
                <label key={mode} className="wb-checkbox-inline">
                  <input
                    type="checkbox"
                    data-testid={`skill-mode-${mode}`}
                    checked={editor.modes.includes(mode)}
                    onChange={(event) => {
                      const modes = event.target.checked
                        ? [...editor.modes, mode]
                        : editor.modes.filter((item) => item !== mode);
                      setEditor({ ...editor, modes });
                    }}
                  />
                  {t(SKILL_MODE_KEYS[mode])}
                </label>
              ))}
            </fieldset>
            <label className="wb-field skills-editor-wide">
              <span className="wb-label">{t('skills.editor.notes')}</span>
              <textarea
                className="wb-input skills-editor-textarea"
                rows={3}
                value={editor.notes}
                placeholder={t('skills.editor.notesHint')}
                onChange={(event) => setEditor({ ...editor, notes: event.target.value })}
              />
            </label>
            <label className="wb-checkbox-inline skills-editor-wide">
              <input
                type="checkbox"
                checked={editor.requiresImage}
                onChange={(event) => setEditor({ ...editor, requiresImage: event.target.checked })}
              />
              {t('skills.editor.requiresImage')}
            </label>
          </div>

          <div className="skills-editor-actions">
            <button type="button" className="wb-btn" onClick={() => setEditor(null)}>
              {t('skills.editor.cancel')}
            </button>
            <button type="submit" className="wb-btn wb-btn-gold" data-testid="skill-save">
              {t('skills.editor.save')}
            </button>
          </div>
        </form>
      )}

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
                    {t(SKILL_MODE_KEYS[mode])}
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
              className="wb-btn"
              data-testid="skill-detail-toggle"
              aria-pressed={selectedEnabled}
              onClick={() => toggle(selected.id)}
            >
              {selectedEnabled ? t('skills.disable') : t('skills.enable')}
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-gold"
              data-testid="skill-apply"
              onClick={() => navigate(`#/create?skill=${encodeURIComponent(selected.id)}`)}
            >
              {t('skills.apply')}
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
                  <span className="recipe-tag">
                    {skill.modes.map((mode) => t(SKILL_MODE_KEYS[mode])).join(' · ')}
                  </span>
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
