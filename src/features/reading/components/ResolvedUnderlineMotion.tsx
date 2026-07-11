import { useState, useEffect } from 'react';
import styles from './ResolvedUnderlineMotion.module.css';

interface Props {
  isResolved: boolean;
  children: React.ReactNode;
  className?: string;
}

export function ResolvedUnderlineMotion({ isResolved, children, className }: Props) {
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (isResolved && !isComplete) {
      setIsComplete(true);
    }
  }, [isResolved, isComplete]);

  const handleAnimationEnd = () => {
    setIsComplete(true);
  };

  const motionClassName = [
    styles.motionContainer,
    isResolved && !isComplete ? styles.resolving : '',
    isResolved && isComplete ? styles.resolved : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={motionClassName}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </span>
  );
}