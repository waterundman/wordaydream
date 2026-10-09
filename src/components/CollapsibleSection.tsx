/**
 * CollapsibleSection (v1.6.4 Stage 1)
 *
 * 折叠原语: 设置面板三层 IA 的「折叠层」容器 (常显层 / 折叠层 A / 折叠层 B).
 *
 * 实现要点:
 * - 用原生 `<details>` + `<summary>`: 折叠态下内容仍在 DOM 中 (只是不可见),
 *   因此既有测试的 getByText / getByRole / getByTestId 断言不受折叠影响;
 *   也天然获得浏览器的 disclosure 语义与焦点管理 (summary 可 Tab 聚焦).
 * - 受控折叠: `<summary>` 的 click 被 preventDefault, 展开态由 React state 单一来源
 *   驱动 (`open` prop). 这样 `aria-expanded` 与 `<details open>` 永远一致,
 *   不会出现原生 toggle 与 state 双写导致的脱节.
 * - 键盘可达: Enter / Space 显式接管 (preventDefault 阻止原生激活, 避免双切换).
 * - `prefers-reduced-motion`: 箭头旋转动画在减少动效偏好下关闭.
 * - 0 emoji: 箭头用 SVG.
 *
 * 组头两行结构是刻意的: 标题 (功能名) + description (后果说明).
 * description 必须是「展开后会发生什么 / 什么时候该保持关闭」这类后果信息,
 * 不是装饰性副标题.
 */
import { useState, type ReactNode } from 'react';
import styles from './CollapsibleSection.module.css';

interface CollapsibleSectionProps {
  /** 组标题 (功能名). */
  title: string;
  /** 后果说明: 一句话讲清展开后的影响 / 何时该保持折叠. */
  description: string;
  /** 默认是否展开 (默认折叠). */
  defaultOpen?: boolean;
  /** 稳定的查询标记 (供测试与 e2e 定位). */
  testId?: string;
  /** 折叠层内容. */
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  testId,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => setOpen((prev) => !prev);

  return (
    <details
      className={styles.group}
      open={open}
      data-testid={testId}
      data-collapsible={open ? 'open' : 'closed'}
    >
      <summary
        className={styles.summary}
        aria-expanded={open}
        onClick={(event) => {
          // 受控折叠: 阻止 <summary> 原生 toggle, 由 state 单一来源驱动.
          event.preventDefault();
          toggle();
        }}
        onKeyDown={(event) => {
          // 键盘可达: Enter / Space 切换 (原生激活被 preventDefault 抑制).
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <span className={styles.chevron} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
        <span className={styles.summaryText}>
          <span className={styles.summaryTitle}>{title}</span>
          <span className={styles.summaryDescription}>{description}</span>
        </span>
      </summary>

      <div className={styles.body}>{children}</div>
    </details>
  );
}

export default CollapsibleSection;