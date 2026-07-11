import type { MemoryCard } from '../../../types';

export type ExportFormat = 'csv' | 'json' | 'anki';

export interface ExportOptions {
  format: ExportFormat;
  includeDefinitions?: boolean;
}

export class ExportService {
  static exportCards(cards: MemoryCard[], options: ExportOptions): string {
    switch (options.format) {
      case 'csv':
        return this.toCSV(cards);
      case 'json':
        return this.toJSON(cards);
      case 'anki':
        return this.toAnkiCSV(cards);
      default:
        return this.toJSON(cards);
    }
  }

  static downloadFile(content: string, format: ExportFormat): void {
    const ext = format === 'anki' ? 'csv' : format;
    const filename = `wordaydream_export_${new Date().toISOString().split('T')[0]}.${ext}`;
    
    const blob = new Blob([content], { type: this.getContentType(format) });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static exportAndDownload(cards: MemoryCard[], options: ExportOptions): void {
    const content = this.exportCards(cards, options);
    this.downloadFile(content, options.format);
  }

  // v1.5.3 fix V3-P2-006: RFC 4180 CSV 转义.
  // 含逗号/双引号/换行的字段必须用双引号包裹, 内部双引号用 "" 转义.
  private static escapeCSVField(value: string | number): string {
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private static toCSV(cards: MemoryCard[]): string {
    const headers = [
      'ID',
      '词汇',
      '难度等级',
      '首次学习日期',
      '下次复习日期',
      '复习次数',
      '遗忘次数',
      '状态',
      '稳定性',
      '难度值',
    ];

    const rows = cards.map((card) => [
      this.escapeCSVField(card.id),
      this.escapeCSVField(card.lemma),
      this.escapeCSVField(card.objectiveDifficulty),
      this.escapeCSVField(this.formatDate(card.firstLearnedAt)),
      this.escapeCSVField(this.formatDate(card.due)),
      this.escapeCSVField(card.reps),
      this.escapeCSVField(card.lapses),
      this.escapeCSVField(this.getStatusLabel(card.status)),
      this.escapeCSVField(card.stability.toFixed(2)),
      this.escapeCSVField(card.difficulty.toFixed(2)),
    ]);

    return [headers.map((h) => this.escapeCSVField(h)), ...rows].map((row) => row.join(',')).join('\n');
  }

  private static toJSON(cards: MemoryCard[]): string {
    const data = cards.map((card) => ({
      id: card.id,
      lemma: card.lemma,
      objectiveDifficulty: card.objectiveDifficulty,
      firstLearnedAt: card.firstLearnedAt,
      firstLearnedDate: this.formatDate(card.firstLearnedAt),
      due: card.due,
      dueDate: this.formatDate(card.due),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      status: card.status,
      statusLabel: this.getStatusLabel(card.status),
    }));

    return JSON.stringify({
      exportedAt: Date.now(),
      exportedDate: new Date().toISOString(),
      totalCards: cards.length,
      cards: data,
    }, null, 2);
  }

  private static toAnkiCSV(cards: MemoryCard[]): string {
    const rows = cards.map((card) => {
      const front = card.lemma;
      const back = `难度: L${card.objectiveDifficulty}\n状态: ${this.getStatusLabel(card.status)}\n复习次数: ${card.reps}\n遗忘次数: ${card.lapses}\n下次复习: ${this.formatDate(card.due)}`;
      // v1.5.3 fix V3-P2-006: 用 escapeCSVField 替代手动加引号, 正确转义内部双引号.
      return [this.escapeCSVField(front), this.escapeCSVField(back)].join(',');
    });

    return rows.join('\n');
  }

  private static getContentType(format: ExportFormat): string {
    switch (format) {
      case 'csv':
      case 'anki':
        return 'text/csv;charset=utf-8';
      case 'json':
        return 'application/json;charset=utf-8';
      default:
        return 'text/plain;charset=utf-8';
    }
  }

  private static formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
  }

  private static getStatusLabel(status: MemoryCard['status']): string {
    const labels: Record<MemoryCard['status'], string> = {
      new: '新词汇',
      learning: '学习中',
      review: '复习中',
      relearning: '重新学习',
    };
    return labels[status];
  }
}