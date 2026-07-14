import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodayReviewCard } from './TodayReviewCard';

describe('TodayReviewCard', () => {
  it('renders nothing when dueCount is 0', () => {
    const { container } = render(
      <TodayReviewCard dueCount={0} onStartReview={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dueCount when dueCount > 0', () => {
    render(<TodayReviewCard dueCount={5} onStartReview={() => {}} />);
    expect(screen.getByText('5 个词待复习')).toBeDefined();
  });

  it('calls onStartReview when button is clicked', () => {
    const onStartReview = vi.fn();
    render(<TodayReviewCard dueCount={3} onStartReview={onStartReview} />);
    fireEvent.click(screen.getByText('开始复习'));
    expect(onStartReview).toHaveBeenCalledTimes(1);
  });

  it('has role=status for accessibility', () => {
    render(<TodayReviewCard dueCount={2} onStartReview={() => {}} />);
    expect(screen.getByRole('status')).toBeDefined();
  });
});
