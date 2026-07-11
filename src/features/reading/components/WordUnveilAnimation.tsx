import { useEffect, useState, memo } from 'react';
import styles from './WordUnveilAnimation.module.css';

interface Props {
  isResolved: boolean;
  children: React.ReactNode;
}

export const WordUnveilAnimation = memo(function WordUnveilAnimation({ isResolved, children }: Props) {
  const [showUnveil, setShowUnveil] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (isResolved && !completed) {
      setShowUnveil(true);
      const timer = setTimeout(() => {
        setCompleted(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isResolved, completed]);

  if (!showUnveil) {
    return <>{children}</>;
  }

  return (
    <span className={styles.container}>
      <span className={styles.mask} />
      <span className={styles.content}>{children}</span>
      <span className={styles.sparkle} />
    </span>
  );
});