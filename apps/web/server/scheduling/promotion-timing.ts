// 推广时间推荐（纯逻辑，无副作用、可测试）
//
// 根据目标国家的时区、周末习惯与节假日，给出"何时推广更合适"的建议：
//   - 每周最佳投放时段（当地时间，按周几 + 时段表达，避免时区换算误差）
//   - 未来一段时间内的节假日提醒（建议规避或借势）
//
// ⚠️ 数据维护说明：
//   - 节假日尤其是伊斯兰历（斋月 / 开斋节 / 宰牲节）每年日期不同，下方为示例/起步数据，
//     需按年核对更新（建议由运营在设置里维护，或接入第三方节假日 API）。
//   - 周末习惯：海湾多国为周五/周六，沙特/阿联酋近年部分改为周六/周日，已在 notes 标注。

export type PromotionAdvice = "avoid" | "leverage";

export type CountryProfile = {
  code: string;
  name: string;
  /** IANA 时区，交给前端 / 调度器做本地化 */
  timezone: string;
  /** 周末的星期（0=周日 … 6=周六），用于避免在休息日投放 B2B 内容 */
  weekendDays: number[];
  /** 每周推荐投放时段（当地时间） */
  bestWindows: Array<{
    dayOfWeek: number; // 0=周日 … 6=周六
    startHour: number; // 0-23
    endHour: number; // 0-23
    reason: string;
  }>;
  notes?: string;
};

export type Holiday = {
  /** ISO 日期 YYYY-MM-DD（当地） */
  date: string;
  name: string;
  advice: PromotionAdvice;
  note?: string;
};

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 目标市场（中东 / 拉美 / 独联体）起步数据集
export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  AE: {
    code: "AE",
    name: "阿联酋",
    timezone: "Asia/Dubai",
    weekendDays: [6, 0], // 2022 起联邦机构改为周六/周日
    bestWindows: [
      { dayOfWeek: 2, startHour: 10, endHour: 12, reason: "工作日上午采购决策活跃" },
      { dayOfWeek: 3, startHour: 20, endHour: 22, reason: "晚间社媒活跃高峰" },
    ],
    notes: "私企周末仍有周五/周六，投放避开周五主麻日中午。",
  },
  SA: {
    code: "SA",
    name: "沙特",
    timezone: "Asia/Riyadh",
    weekendDays: [5, 6], // 周五/周六
    bestWindows: [
      { dayOfWeek: 0, startHour: 10, endHour: 12, reason: "周日为工作周首日，B2B 询盘多" },
      { dayOfWeek: 1, startHour: 20, endHour: 22, reason: "晚间短视频/社媒高峰" },
    ],
  },
  BR: {
    code: "BR",
    name: "巴西",
    timezone: "America/Sao_Paulo",
    weekendDays: [6, 0],
    bestWindows: [
      { dayOfWeek: 2, startHour: 11, endHour: 13, reason: "午间浏览高峰" },
      { dayOfWeek: 4, startHour: 19, endHour: 21, reason: "周四晚社媒互动强" },
    ],
  },
  MX: {
    code: "MX",
    name: "墨西哥",
    timezone: "America/Mexico_City",
    weekendDays: [6, 0],
    bestWindows: [
      { dayOfWeek: 3, startHour: 10, endHour: 12, reason: "周中上午商务活跃" },
      { dayOfWeek: 5, startHour: 18, endHour: 20, reason: "周五傍晚消费/浏览高峰" },
    ],
  },
  RU: {
    code: "RU",
    name: "俄罗斯",
    timezone: "Europe/Moscow",
    weekendDays: [6, 0],
    bestWindows: [
      { dayOfWeek: 2, startHour: 10, endHour: 12, reason: "工作日上午 B2B 活跃" },
      { dayOfWeek: 3, startHour: 19, endHour: 21, reason: "VK 晚间互动高峰" },
    ],
  },
  DE: {
    code: "DE",
    name: "德国",
    timezone: "Europe/Berlin",
    weekendDays: [6, 0],
    bestWindows: [
      { dayOfWeek: 2, startHour: 9, endHour: 11, reason: "工作日上午专业受众在线" },
      { dayOfWeek: 4, startHour: 13, endHour: 15, reason: "午后 LinkedIn 活跃" },
    ],
  },
};

// 起步节假日数据（示例，按年核对）
export const HOLIDAYS: Record<string, Holiday[]> = {
  AE: [
    { date: "2026-12-02", name: "阿联酋国庆日", advice: "leverage", note: "可做节日借势内容" },
    { date: "2026-03-20", name: "开斋节（预计）", advice: "avoid", note: "伊斯兰历，日期需核对" },
  ],
  SA: [
    { date: "2026-09-23", name: "沙特国庆日", advice: "leverage" },
    { date: "2026-03-20", name: "开斋节（预计）", advice: "avoid", note: "伊斯兰历，日期需核对" },
  ],
  BR: [{ date: "2026-09-07", name: "巴西独立日", advice: "avoid" }],
  MX: [{ date: "2026-09-16", name: "墨西哥独立日", advice: "avoid" }],
  RU: [{ date: "2026-06-12", name: "俄罗斯日", advice: "avoid" }],
  DE: [{ date: "2026-10-03", name: "德国统一日", advice: "avoid" }],
};

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export type PromotionTimingResult = {
  country: string;
  countryName: string;
  timezone: string;
  weekendLabels: string[];
  recommendedWindows: Array<{ label: string; reason: string }>;
  upcomingHolidays: Array<{
    date: string;
    name: string;
    advice: PromotionAdvice;
    adviceLabel: string;
    note?: string;
  }>;
  notes?: string;
  dataCaveat: string;
};

/**
 * 给出某国家的推广时间建议。纯函数：传入 now 即完全确定。
 * @param horizonDays 节假日提醒的未来天数窗口，默认 60 天
 */
export function recommendPromotionTiming(params: {
  country: string;
  now?: Date;
  horizonDays?: number;
}): PromotionTimingResult {
  const code = params.country.trim().toUpperCase();
  const profile = COUNTRY_PROFILES[code];
  const now = params.now ?? new Date();
  const horizonDays = params.horizonDays ?? 60;

  if (!profile) {
    return {
      country: code,
      countryName: code,
      timezone: "UTC",
      weekendLabels: ["周六", "周日"],
      recommendedWindows: [
        { label: "周二 10:00–12:00（当地时间）", reason: "工作日上午通用商务高峰" },
        { label: "周四 20:00–22:00（当地时间）", reason: "晚间社媒通用高峰" },
      ],
      upcomingHolidays: [],
      notes: "暂无该国家的细分数据，返回通用建议。可在数据集中补充该国家档案。",
      dataCaveat: "通用兜底建议，非该国家专属。",
    };
  }

  const recommendedWindows = profile.bestWindows.map((window) => ({
    label: `${WEEKDAY_LABELS[window.dayOfWeek]} ${String(window.startHour).padStart(2, "0")}:00–${String(window.endHour).padStart(2, "0")}:00（当地时间）`,
    reason: window.reason,
  }));

  const horizonEnd = addDays(now, horizonDays);
  const nowIso = toIsoDate(now);
  const endIso = toIsoDate(horizonEnd);
  const upcomingHolidays = (HOLIDAYS[code] ?? [])
    .filter((holiday) => holiday.date >= nowIso && holiday.date <= endIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((holiday) => ({
      date: holiday.date,
      name: holiday.name,
      advice: holiday.advice,
      adviceLabel: holiday.advice === "leverage" ? "建议借势" : "建议规避",
      note: holiday.note,
    }));

  return {
    country: code,
    countryName: profile.name,
    timezone: profile.timezone,
    weekendLabels: profile.weekendDays.map((day) => WEEKDAY_LABELS[day]),
    recommendedWindows,
    upcomingHolidays,
    notes: profile.notes,
    dataCaveat: "节假日为起步数据，伊斯兰历节日日期每年浮动，请按年核对或接入节假日数据源。",
  };
}
