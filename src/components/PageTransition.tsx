import { useEffect, useState, memo } from 'react';
import styles from './PageTransition.module.css';

interface Props {
  isEntering: boolean;
  children: React.ReactNode;
}

export const PageTransition = memo(function PageTransition({ isEntering, children }: Props) {
  const [isVisible, setIsVisible] = useState(!isEntering);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isEntering) {
      setIsVisible(false);
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 50);
      const completeTimer = setTimeout(() => {
        setIsAnimating(false);
      }, 600);
      return () => {
        clearTimeout(timer);
        clearTimeout(completeTimer);
      };
    } else {
      setIsVisible(true);
      setIsAnimating(false);
    }
  }, [isEntering]);

  return (
    <div className={`${styles.container} ${isAnimating ? styles.animating : ''}`}>
      <div className={`${styles.content} ${isVisible ? styles.visible : ''}`}>
        {children}
      </div>
      <div className={styles.pageShadow} />
    </div>
  );
});