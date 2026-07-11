import { useState, useEffect, useCallback } from 'react';

interface UseVocabPulseAnimationOptions {
  duration?: number;
}

interface VocabPulseAnimationResult {
  className: string;
  isAnimating: boolean;
  triggerPulse: () => void;
}

export function useVocabPulseAnimation({
  duration = 600,
}: UseVocabPulseAnimationOptions = {}): VocabPulseAnimationResult {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => {
      setShouldAnimate(!mediaQuery.matches);
    };

    setShouldAnimate(!mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const triggerPulse = useCallback(() => {
    if (!shouldAnimate) return;

    setIsAnimating(true);
    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, duration);

    return () => clearTimeout(timer);
  }, [shouldAnimate, duration]);

  return {
    className: isAnimating ? 'vocabPulse' : '',
    isAnimating,
    triggerPulse,
  };
}