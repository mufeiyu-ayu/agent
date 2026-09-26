/** 首页动效共用的缓动纯函数，数值照搬设计稿。 */
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** easeOutCubic */
export const ease = (p: number) => 1 - (1 - p) ** 3
