import styles from './LoadingSpinner.module.css';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'classic' | 'ink' | 'paper';
}

export function LoadingSpinner({ size = 'md', variant = 'ink' }: LoadingSpinnerProps) {
  return (
    <span
      className={`${styles.spinner} ${styles[size]} ${styles[variant]}`}
      role="status"
      aria-label="加载中"
    >
      {variant === 'ink' && (
        <>
          <span className={styles.inkDrop} />
          <span className={styles.inkRing} />
        </>
      )}
      {variant === 'classic' && <span className={styles.ring} />}
      {variant === 'paper' && (
        <>
          <span className={styles.pageLeaf} />
          <span className={styles.pageLeaf} />
          <span className={styles.pageLeaf} />
        </>
      )}
    </span>
  );
}