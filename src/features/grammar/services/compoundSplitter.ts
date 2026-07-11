import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { CompoundWord, Language } from '../../../types';

/**
 * Mock 复合词数据
 * 用于 LLM 不可用时的回退方案
 */
const mockCompoundWords: Record<string, CompoundWord> = {
  Hausfrau: {
    lemma: 'Hausfrau',
    parts: [
      { text: 'Haus', meaning: '房子，家' },
      { text: 'Frau', meaning: '女人，妻子' },
    ],
    etymology: '由 Haus (房子) + Frau (女人) 组成，表示"家庭主妇"',
  },
  Arbeitgeber: {
    lemma: 'Arbeitgeber',
    parts: [
      { text: 'Arbeit', meaning: '工作，劳动' },
      { text: 'Geber', meaning: '给予者' },
    ],
    etymology: '由 Arbeit (工作) + Geber (给予者) 组成，表示"雇主"',
  },
  Buchhandlung: {
    lemma: 'Buchhandlung',
    parts: [
      { text: 'Buch', meaning: '书' },
      { text: 'Handlung', meaning: '行动，交易' },
    ],
    etymology: '由 Buch (书) + Handlung (交易) 组成，表示"书店"',
  },
  Fahrrad: {
    lemma: 'Fahrrad',
    parts: [
      { text: 'Fahr', meaning: '驾驶，行驶' },
      { text: 'Rad', meaning: '轮子' },
    ],
    etymology: '由 fahren (驾驶) 的词干 + Rad (轮子) 组成，表示"自行车"',
  },
  Schreibtisch: {
    lemma: 'Schreibtisch',
    parts: [
      { text: 'Schreib', meaning: '书写' },
      { text: 'Tisch', meaning: '桌子' },
    ],
    etymology: '由 schreiben (书写) 的词干 + Tisch (桌子) 组成，表示"书桌"',
  },
  Sonnenblume: {
    lemma: 'Sonnenblume',
    parts: [
      { text: 'Sonne', meaning: '太阳' },
      { text: 'Blume', meaning: '花' },
    ],
    etymology: '由 Sonne (太阳) + Blume (花) 组成，表示"向日葵"',
  },
  Computer: {
    lemma: 'Computer',
    parts: [
      { text: 'Com', meaning: '共同，一起' },
      { text: 'put', meaning: '思考，计算' },
      { text: 'er', meaning: '工具，机器' },
    ],
    etymology: '源自拉丁语 computare，意为"计算"',
  },
  Telefon: {
    lemma: 'Telefon',
    parts: [
      { text: 'Tele', meaning: '远' },
      { text: 'fon', meaning: '声音' },
    ],
    etymology: '源自希腊语 tele (远) + phone (声音)，表示"远距离传声的设备"',
  },
};

/**
 * 德语词根词典
 * 用于规则匹配的复合词拆分
 */
const germanRoots: Record<string, string> = {
  Haus: '房子，家',
  Frau: '女人，妻子',
  Arbeit: '工作，劳动',
  Geber: '给予者',
  Buch: '书',
  Handlung: '行动，交易',
  Fahr: '驾驶，行驶',
  Rad: '轮子',
  Schreib: '书写',
  Tisch: '桌子',
  Sonne: '太阳',
  Blume: '花',
  Wasser: '水',
  Land: '土地，国家',
  Stadt: '城市',
  Berg: '山',
  See: '湖，海',
  Wald: '森林',
  Fluss: '河流',
  Wind: '风',
  Feuer: '火',
  Stein: '石头',
  Holz: '木头',
  Glas: '玻璃',
  Metall: '金属',
  Luft: '空气',
  Zeit: '时间',
  Raum: '空间',
  Mensch: '人',
  Kind: '孩子',
  Mann: '男人',
  Vater: '父亲',
  Mutter: '母亲',
  Bruder: '兄弟',
  Schwester: '姐妹',
  Freund: '朋友',
  Feind: '敌人',
  Tier: '动物',
  Pflanze: '植物',
  Obst: '水果',
  Gemüse: '蔬菜',
  Brot: '面包',
  Wein: '葡萄酒',
  Milch: '牛奶',
  Ei: '蛋',
  Fleisch: '肉',
  Fisch: '鱼',
  Vogel: '鸟',
  Katze: '猫',
  Hund: '狗',
  Pferd: '马',
  Auto: '汽车',
  Zug: '火车',
  Schiff: '船',
  Flugzeug: '飞机',
  Bahnhof: '火车站',
  Flughafen: '机场',
  Hotel: '酒店',
  Restaurant: '餐厅',
  Kirche: '教堂',
  Schule: '学校',
  Universität: '大学',
  Krankenhaus: '医院',
  Theater: '剧院',
  Kino: '电影院',
  Museum: '博物馆',
  Bank: '银行',
  Post: '邮局',
  Polizei: '警察',
  Feuerwehr: '消防队',
};

/**
 * 使用 Mock 数据拆分复合词
 * 在 LLM 和规则匹配都不可用时提供回退功能
 *
 * @param word 待拆分的单词
 * @param language 语言类型
 * @returns 复合词解析结果，无法拆分时返回 null
 */
function mockSplitCompound(word: string, _language: Language): CompoundWord | null {
  const normalizedWord = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return mockCompoundWords[normalizedWord] || null;
}

/**
 * 使用规则匹配拆分复合词
 * 基于词根词典进行正向和反向匹配
 *
 * @param word 待拆分的单词
 * @param language 语言类型
 * @returns 复合词解析结果，无法拆分时返回 null
 */
function ruleBasedSplitCompound(word: string, _language: Language): CompoundWord | null {
  const upperWord = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  const lowerWord = word.toLowerCase();

  if (mockCompoundWords[upperWord]) {
    return mockCompoundWords[upperWord];
  }

  const roots = Object.keys(germanRoots).sort((a, b) => b.length - a.length);
  const parts: { text: string; meaning: string }[] = [];
  let remaining = lowerWord;

  while (remaining.length > 2) {
    let found = false;
    for (const root of roots) {
      const rootLower = root.toLowerCase();
      if (remaining.startsWith(rootLower)) {
        parts.push({
          text: root.charAt(0).toUpperCase() + rootLower.slice(1),
          meaning: germanRoots[root],
        });
        remaining = remaining.slice(rootLower.length);
        found = true;
        break;
      } else if (remaining.endsWith(rootLower)) {
        parts.push({
          text: root.charAt(0).toUpperCase() + rootLower.slice(1),
          meaning: germanRoots[root],
        });
        remaining = remaining.slice(0, -rootLower.length);
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  if (remaining.length > 0) {
    const capitalRemaining = remaining.charAt(0).toUpperCase() + remaining.slice(1);
    if (germanRoots[capitalRemaining]) {
      parts.push({
        text: capitalRemaining,
        meaning: germanRoots[capitalRemaining],
      });
    } else {
      parts.push({
        text: capitalRemaining,
        meaning: '未知词根',
      });
    }
  }

  if (parts.length >= 2) {
    return {
      lemma: word,
      parts: parts.map(p => ({
        text: word[0] === word[0].toUpperCase() ? p.text : p.text.toLowerCase(),
        meaning: p.meaning,
      })),
      etymology: `由 ${parts.map(p => p.text).join(' + ')} 组成`,
    };
  }

  return null;
}

/**
 * 拆分复合词
 * 仅支持德语，根据配置决定使用规则匹配还是 Mock 数据
 *
 * @param word 待拆分的单词
 * @param language 语言类型
 * @returns 复合词解析结果，非德语或无法拆分时返回 null
 */
export async function splitCompound(word: string, language: Language): Promise<CompoundWord | null> {
  if (language !== 'de') {
    return null;
  }

  const { llm } = useSettingsStore.getState();

  if (llm.provider === 'mock' || !llm.enabled) {
    return mockSplitCompound(word, language);
  }

  const ruleResult = ruleBasedSplitCompound(word, language);
  if (ruleResult) {
    return ruleResult;
  }

  return mockSplitCompound(word, language);
}