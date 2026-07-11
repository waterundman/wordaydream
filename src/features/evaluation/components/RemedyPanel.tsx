import { useState, useEffect } from 'react';
import { getGloss } from '../services/glossAdapter';
import styles from './RemedyPanel.module.css';
import type { TokenOccurrence, GlossPayload, Language } from '../../../types';

interface Props {
  token: TokenOccurrence;
  userAnswer: string;
  language?: Language;
}

const remedySentences: Record<string, { de: string; en: string; zh: string }> = {
  revolution: {
    en: 'A revolution changes everything.',
    de: 'Eine Revolution verändert alles.',
    zh: 'A revolution changes everything.',
  },
  dilapidated: {
    en: 'The old house looked dilapidated.',
    de: 'Das alte Haus sah verwittert aus.',
    zh: 'The old house looked run-down.',
  },
  artisan: {
    en: 'The artisan made a beautiful pot.',
    de: 'Der Handwerker machte einen schönen Topf.',
    zh: 'The craftsman made a beautiful pot.',
  },
  marvel: {
    en: 'I marvel at the stars at night.',
    de: 'Ich bewundere die Sterne in der Nacht.',
    zh: 'I admire the stars at night.',
  },
  authenticity: {
    en: 'We value the authenticity of the story.',
    de: 'Wir schätzen die Authentizität der Geschichte.',
    zh: 'We value the authenticity of the story.',
  },
  endeavor: {
    en: 'Her endeavor finally paid off.',
    de: 'Ihre Bemühung zahlte sich endlich aus.',
    zh: 'Her effort finally paid off.',
  },
  blossom: {
    en: 'The garden will blossom in spring.',
    de: 'Der Garten wird im Frühling blühen.',
    zh: 'The garden will bloom in spring.',
  },
  vergessenheit: {
    en: 'The old story fell into oblivion.',
    de: 'Die alte Geschichte geriet in Vergessenheit.',
    zh: 'The old story was forgotten.',
  },
  verwittert: {
    en: 'The weathered stone still stands.',
    de: 'Der verwitterte Stein steht noch.',
    zh: 'The weathered stone still stands.',
  },
  verbergen: {
    en: 'She tried to hide her feelings.',
    de: 'Sie versuchte, ihre Gefühle zu verbergen.',
    zh: 'She tried to hide her feelings.',
  },
  innehalten: {
    en: 'He stopped to listen.',
    de: 'Er hielt inne, um zuzuhören.',
    zh: 'He stopped to listen.',
  },
  freiwillig: {
    en: 'She helps on a voluntary basis.',
    de: 'Sie hilft auf freiwilliger Basis.',
    zh: 'She helps voluntarily.',
  },
  restaurierung: {
    en: 'The restoration took many months.',
    de: 'Die Restaurierung dauerte viele Monate.',
    zh: 'The restoration took many months.',
  },
  stroemen: {
    en: 'People flowed into the square.',
    de: 'Die Menschen strömten auf den Platz.',
    zh: 'People flowed into the square.',
  },
  ueberdauern: {
    en: 'True friendship lasts forever.',
    de: 'Wahre Freundschaft überdauert die Zeit.',
    zh: 'True friendship lasts forever.',
  },
};

export function RemedyPanel({ token, userAnswer, language = 'en' }: Props) {
  const [gloss, setGloss] = useState<GlossPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // v1.5.3 fix V3-P2-003: 加 cancelled 标志防止竞态.
  // 用户连续答错多个词时, token prop 快速变化, 旧 getGloss 请求可能晚于
  // 新请求返回, 导致 setGloss 用旧 token 的释义覆盖新 token 的释义.
  // v1.5.3 fix V3-P3-003: 传 language 给 getGloss, 避免 detectLanguage 启发式误判.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      const result = await getGloss(token, language);
      if (cancelled) return;
      setGloss(result);
      setIsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [token, language]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExpanded(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // v1.5.3 fix V2-P3-004: 改用 language prop 替代 hasUmlaut 启发式判断语言.
  // 之前无 umlaut 的德语词 (e.g. Arbeitgeber) 会取到英语例句.
  const lemmaKey = token.lemma.toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');
  const remedy = remedySentences[lemmaKey] || remedySentences[token.lemma.toLowerCase()];
  const targetSentence = (language ?? 'en') === 'de' ? remedy?.de : remedy?.en;

  return (
    <div className={`${styles.remedy} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.header}>
        <span className={styles.label}>补救例句</span>
        <span className={styles.levelLabel}>简易例句</span>
      </div>

      <div className={styles.sentenceBox}>
        {remedy ? (
          <>
            <p className={styles.targetSentence}>{targetSentence}</p>
            <p className={styles.translation}>{remedy.zh}</p>
          </>
        ) : (
          <p className={styles.loadingText}>正在生成补救例句...</p>
        )}
      </div>

      {isLoading ? (
        <div className={styles.glossLoading}>正在加载释义...</div>
      ) : gloss ? (
        <div className={styles.gloss}>
          <div className={styles.glossHeader}>
            <span className={styles.word}>{gloss.word}</span>
            <span className={styles.pos}>{gloss.partOfSpeech}</span>
          </div>
          <ul className={styles.definitions}>
            {gloss.definitions.map((def, i) => (
              <li key={i}>{def}</li>
            ))}
          </ul>
          {gloss.llmExplanation && (
            <p className={styles.llmNote}>{gloss.llmExplanation}</p>
          )}
          <p className={styles.sourceLabel}>{gloss.sourceLabel}</p>
        </div>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.showAnswerBtn}
          onClick={() => setShowAnswer(!showAnswer)}
        >
          {showAnswer ? '隐藏答案' : '显示答案'}
        </button>
      </div>

      {showAnswer && gloss && (
        <div className={styles.answerReveal}>
          <p className={styles.answerLabel}>核心释义：</p>
          <p className={styles.answerText}>{gloss.definitions[0]}</p>
          <p className={styles.answerHint}>
            你输入的是：{userAnswer}。试着将释义与文章中的用法联系起来。
          </p>
        </div>
      )}
    </div>
  );
}
