import type { AnswerEvaluation, DifficultyLevel } from '../../../types';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { evaluateAnswerViaLLM } from '../../llm/services/llmAdapter';
import { lookupEvaluation } from '../../llm/services/mockProvider';

export async function evaluateAnswer(
  userAnswer: string,
  lemma: string,
  _difficulty: DifficultyLevel,
  language: 'en' | 'de' = 'en'
): Promise<AnswerEvaluation> {
  const { llm } = useSettingsStore.getState();
  if (llm.provider === 'mock' || !llm.enabled) {
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 200));
    return lookupEvaluation(lemma, userAnswer);
  }
  return evaluateAnswerViaLLM({
    userAnswer,
    lemma,
    objectiveDifficulty: _difficulty,
    language,
  });
}
