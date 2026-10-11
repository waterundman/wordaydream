/**
 * MemoryExportSection (v1.6.6: 把记忆库导出接进设置面板)
 *
 * 背景: `ExportButton` → `ExportService` (CSV / JSON / Anki 三种格式) 这条链自 v1.5.2
 * 首提交起就存在，但从未被任何页面挂载 —— 只有 harmony-feature-parity 测试断言
 * 「它是有效 React 组件」，用户在界面里走不到它。
 *
 * 设计: 寄生在已有的「数据与高级」折叠组里 (与错词导出同层)，不单开导航栏目。
 * 空记忆库时不渲染导出按钮 —— 点了没反应的按钮比没有按钮更糟。
 */
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { ExportButton } from '../../review/components/ExportButton';
import styles from './MemoryExportSection.module.css';

export function MemoryExportSection() {
  const count = useMemoryStore((state) => state.cards.size);

  return (
    <div className={styles.section} data-testid="memory-export-section">
      <div className={styles.title}>记忆库导出</div>
      <p className={styles.desc}>
        {count > 0
          ? `导出全部 ${count} 张 FSRS 卡片（CSV / JSON / Anki），用于备份或迁移到外部工具。`
          : '记忆库还没有卡片 —— 先在阅读页答对一个词，这里才会可用。'}
      </p>
      {count > 0 && (
        <div className={styles.btnRow}>
          <ExportButton />
        </div>
      )}
    </div>
  );
}
