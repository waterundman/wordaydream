import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const notificationSource = readFileSync(
  resolve(
    process.cwd(),
    'harmony/entry/src/main/ets/notification/NotificationService.ets',
  ),
  'utf8',
);

describe('Harmony notification safety invariants', () => {
  it('never publishes a future reminder as an immediate notification', () => {
    const triggerCalculation = notificationSource.indexOf(
      'const triggerAt: number = this.computeTriggerAt(dueAt, now, win);',
    );
    const futureGuard = notificationSource.indexOf('if (triggerAt > now)');
    const publish = notificationSource.indexOf(
      'await notificationManager.publish(request)',
    );

    expect(triggerCalculation).toBeGreaterThanOrEqual(0);
    expect(futureGuard).toBeGreaterThan(triggerCalculation);
    expect(publish).toBeGreaterThan(futureGuard);
  });

  it('cancels only the review notification owned by this service', () => {
    expect(notificationSource).not.toContain('notificationManager.cancelAll()');
    expect(notificationSource).toContain('await this.cancelReminder(REMINDER_TAG)');
  });
});
