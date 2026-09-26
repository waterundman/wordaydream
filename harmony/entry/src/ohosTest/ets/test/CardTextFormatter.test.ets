/**
 * CardTextFormatter.test (技术债修复 M4)
 *
 * 服务卡片到期数文案已收敛到 CardTextFormatter 单一实现 (卡片提供方
 * CardDataProvider 与卡片渲染进程 ReviewCardWidget 共用). 本用例为纯函数断言,
 * 不依赖设备状态, 覆盖 zh / en / de / 未知语言 fallback / 默认参数,
 * 并守护 CardDataProvider 转发结果与单一实现完全一致.
 */
import { describe, it, expect } from '@ohos/hypium';
import { CardDataProvider } from '../../../main/ets/widget/CardDataProvider';
import { formatDueCountText } from '../../../main/ets/widget/CardTextFormatter';

export default function cardTextFormatterTest() {
  describe('CardTextFormatterTest', () => {
    it('zhTexts', 0, () => {
      expect(formatDueCountText(0, 'zh')).assertEqual('暂无到期');
      expect(formatDueCountText(1, 'zh')).assertEqual('1 个到期');
      expect(formatDueCountText(12, 'zh')).assertEqual('12 个到期');
    })

    it('enTexts', 0, () => {
      expect(formatDueCountText(0, 'en')).assertEqual('No cards');
      expect(formatDueCountText(1, 'en')).assertEqual('1 card due');
      expect(formatDueCountText(7, 'en')).assertEqual('7 cards due');
    })

    it('deTexts', 0, () => {
      expect(formatDueCountText(0, 'de')).assertEqual('Keine Karten');
      expect(formatDueCountText(1, 'de')).assertEqual('1 Karte fällig');
      expect(formatDueCountText(7, 'de')).assertEqual('7 Karten fällig');
    })

    it('unknownLanguageFallsBackToEn', 0, () => {
      expect(formatDueCountText(3, 'fr')).assertEqual('3 cards due');
      expect(formatDueCountText(3)).assertEqual('3 cards due');
    })

    it('cardDataProviderForwardsSameResult', 0, () => {
      // 卡片 UI 与提供方进程不得再出现两套文案 (历史逐行复制回归守护).
      const provider: CardDataProvider = CardDataProvider.getInstance();
      const langs: string[] = ['zh', 'en', 'de', 'fr'];
      const counts: number[] = [0, 1, 9];
      for (let i = 0; i < langs.length; i++) {
        for (let j = 0; j < counts.length; j++) {
          expect(provider.formatDueCountText(counts[j], langs[i]))
            .assertEqual(formatDueCountText(counts[j], langs[i]));
        }
      }
    })
  })
}
