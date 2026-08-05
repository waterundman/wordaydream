/**
 * notification/templates (v0.1.0-harmony Stage 7)
 *
 * 多语言通知文案模板. 鸿蒙端 NotificationService.scheduleReviewReminder 通过
 * getReviewReminderText / getPermissionRequestText 获取本地化文案, 注入
 * notificationManager.publish 的 NotificationContent.
 *
 * 支持语言: zh / en / de. 未匹配的语言 fallback 到 'en'.
 *
 * ArkTS 适配: 仅 interface + 函数, 无 any / 无对象字面量类型 / 无 var.
 */

/** 通知文案结构. */
export interface NotificationText {
  /** 通知标题. */
  title: string;
  /** 通知正文. */
  text: string;
  /** 展开后的附加文本 (可选, 部分场景留空). */
  expandedText: string;
}

/** 复习提醒文案: 根据 language + dueCount 生成本地化文案. */
export function getReviewReminderText(
  language: string,
  dueCount: number
): NotificationText {
  const safeCount: number = dueCount > 0 ? dueCount : 0;
  if (language === 'zh') {
    const tpl: NotificationText = {
      title: '复习时间到',
      text: `有 ${safeCount} 个词汇到期复习`,
      expandedText: '点击开始复习',
    };
    return tpl;
  }
  if (language === 'de') {
    // 德语复数: dueCount > 1 用 "Karten", =1 用 "Karte" (此处保持简单统一 'Karten').
    const tpl: NotificationText = {
      title: 'Wiederholungszeit',
      text: `${safeCount} Karten fällig`,
      expandedText: 'Tippen zum Starten',
    };
    return tpl;
  }
  // 默认 en (含未匹配语言 fallback)
  const plural: string = safeCount > 1 ? 's' : '';
  const tpl: NotificationText = {
    title: 'Review Time',
    text: `${safeCount} word${plural} due for review`,
    expandedText: 'Tap to start review',
  };
  return tpl;
}

/** 权限请求引导文案: 通知未授权时提示用户开启. */
export function getPermissionRequestText(language: string): NotificationText {
  if (language === 'zh') {
    const tpl: NotificationText = {
      title: '开启复习提醒',
      text: '开启后将在词汇到期时通知您',
      expandedText: '',
    };
    return tpl;
  }
  if (language === 'de') {
    const tpl: NotificationText = {
      title: 'Wiederholungserinnerungen aktivieren',
      text: 'Werden benachrichtigt, wenn Wörter fällig sind',
      expandedText: '',
    };
    return tpl;
  }
  // 默认 en
  const tpl: NotificationText = {
    title: 'Enable Review Reminders',
    text: 'Get notified when words are due for review',
    expandedText: '',
  };
  return tpl;
}
