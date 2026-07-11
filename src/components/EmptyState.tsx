import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  compact?: boolean;
  horizontal?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  horizontal = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`${styles.emptyState} ${compact ? styles.compact : ''} ${horizontal ? styles.horizontal : ''} ${className}`}
      role="status"
      aria-live="polite"
    >
      {icon && (
        <div className={styles.iconWrapper} aria-hidden="true">
          {icon}
        </div>
      )}
      <div className={styles.content}>
        <h3 className={styles.title}>{title}</h3>
        {description && (
          <p className={styles.description}>{description}</p>
        )}
      </div>
      {action && (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
