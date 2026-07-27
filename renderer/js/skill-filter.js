'use strict';

/**
 * Pure Skill-search helpers shared by the renderer and Node regression tests.
 * Search is local because the Skills manager already has the complete scan;
 * refreshing the discovery folders remains an explicit backend operation.
 */
(function exposeSkillFilter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SkillFilter = api;
})(typeof window !== 'undefined' ? window : null, () => {
  function normalize(value) {
    return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  }

  function queryTerms(query) {
    return normalize(query).split(/\s+/).filter(Boolean);
  }

  function searchableText(skill) {
    return normalize([
      skill?.name,
      skill?.description,
      skill?.path,
      skill?.family,
      skill?.scope,
      skill?.enabled ? 'enabled active 활성' : 'disabled inactive 비활성',
    ].filter(Boolean).join(' '));
  }

  function filterSkills(skills, query) {
    const list = Array.isArray(skills) ? skills : [];
    const terms = queryTerms(query);
    if (!terms.length) return list;
    return list.filter((skill) => {
      const haystack = searchableText(skill);
      return terms.every((term) => haystack.includes(term));
    });
  }

  return { filterSkills, normalize };
});
