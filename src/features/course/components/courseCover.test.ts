import { describe, expect, it } from 'vitest';
import { courseCoverUrl } from './courseCover';

describe('courseCoverUrl', () => {
  it('resolves a cover for each shipped course language', () => {
    expect(courseCoverUrl('de')).toBe('/assets/img/course-cover-de.webp');
    expect(courseCoverUrl('en')).toBe('/assets/img/course-cover-en.webp');
  });

  it('is case-insensitive on the target language', () => {
    expect(courseCoverUrl('DE')).toBe('/assets/img/course-cover-de.webp');
  });

  it('returns null for a language without a cover', () => {
    expect(courseCoverUrl('fr')).toBeNull();
  });
});