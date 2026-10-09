import { publicAssetUrl } from '../../../platform/publicAssetUrl';

/**
 * 课程选择卡的封面图, 按目标语言取。
 *
 * 源图放在 `assets-sources/img/course-cover-<lang>.jpg`, WebP 产物由
 * `scripts/optimize-static-assets.mjs` 生成到 `public/assets/img/`。
 * 新增语言时: 补一条 TARGETS + 这里加一项映射。
 */
const COURSE_COVERS: Record<string, string> = {
  de: 'assets/img/course-cover-de.webp',
  en: 'assets/img/course-cover-en.webp',
};

export function courseCoverUrl(targetLanguage: string): string | null {
  const path = COURSE_COVERS[targetLanguage.toLowerCase()];
  return path ? publicAssetUrl(path) : null;
}