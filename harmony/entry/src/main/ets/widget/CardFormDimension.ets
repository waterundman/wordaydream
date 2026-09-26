/**
 * CardFormDimension (v0.5.0-harmony 技术债修复 M4)
 *
 * 服务卡片尺寸的「跨进程契约标签」单一事实来源.
 *
 * 背景: 卡片渲染进程 (ReviewCardWidget) 遵循零系统 Kit 约束, 不能 import
 * @kit.FormKit; 而 formInfo.FormDimension 的数值在不同 API 版本间并不稳定
 * (历史上手写 2*2=2 / 2*4=3 魔数正是因此漂移). 故约定:
 * - 卡片提供方进程 (ReviewCardFormAbility) 唯一负责把系统枚举数值翻译成
 *   本文件定义的稳定字符串标签, 经 FormBindingData 的 formDimension 字段注入;
 * - 卡片渲染进程只消费字符串标签, 永不感知系统枚举数值.
 *
 * 与 CardTextFormatter 一样刻意零依赖 (不 import Kit / RDB / preferences),
 * 保证可被卡片渲染进程安全引用.
 */

/** 2*2 紧凑布局标签 (默认尺寸, 亦为未知尺寸 / 未注入时的回落值). */
export const DIMENSION_2_2: string = '2*2';

/** 2*4 富布局标签 (额外展示词位 / 进度环 / 更新时间). */
export const DIMENSION_2_4: string = '2*4';
