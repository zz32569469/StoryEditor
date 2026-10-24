import type { ParsedChar, ResolvedTag } from '../tags/parse';

/**
 * 逐字播放的排程。
 *
 * 從 RichText.tsx 抽出來，因為這段是純邏輯而非渲染 —— 抽出來之後它才能
 * 被獨立測試，也才能產生給 Unity 端比對的黃金測資。
 * 預覽與實機的節奏若不一樣，編劇在網頁上調好的停頓到遊戲裡就白調了。
 */

export const BASE_CHARS_PER_SECOND = 28;

export function tagNumber(tag: ResolvedTag, key: string, fallback: number): number {
  const value = tag.params[key];
  return typeof value === 'number' ? value : fallback;
}

/** 句末標點：這些字之後停 sentencePause 而不是一般的一字間隔。 */
export const SENTENCE_END = /[。！？!?…]/u;

export interface ScheduleOptions {
  charsPerSecond?: number;
  /**
   * 句末標點之後的停頓（秒），取代那一格的一般間隔；0 代表不特別停。
   *
   * 遊戲的閱讀規則（原型 UI25：每字 35ms、句末停 150ms）由遊戲傳入，
   * 預設 0 讓既有的預覽節奏與黃金測資不變。
   */
  sentencePause?: number;
}

export interface Schedule {
  /** times[i] 是第 i 個字出現的時刻（秒）。 */
  times: number[];
  total: number;
}

/**
 * 事先算出每個字出現的時間點。
 *
 * 用排程表而非「每幀推進一格」，是因為 wait 與 speed 會讓步進速率不固定；
 * 排好表之後播放邏輯就只剩「現在該顯示到第幾個字」，也讓拖曳進度成為可能。
 */
export function buildSchedule(chars: ParsedChar[], options: ScheduleOptions = {}): Schedule {
  const charsPerSecond = options.charsPerSecond ?? BASE_CHARS_PER_SECOND;
  const sentencePause = options.sentencePause ?? 0;
  const times: number[] = [];
  let t = 0;
  let previous: string | undefined;

  for (const char of chars) {
    for (const tag of char.before) {
      if (tag.name === 'wait') t += tagNumber(tag, 'value', 0.3);
    }
    // speed 是成對標籤，作用範圍即這個字身上的 effects；巢狀時以最內層為準。
    const speedTag = char.effects.findLast((e) => e.name === 'speed');
    const speed = speedTag ? Math.max(0.05, tagNumber(speedTag, 'value', 1)) : 1;
    const afterSentence = sentencePause > 0 && previous !== undefined && SENTENCE_END.test(previous);
    t += afterSentence ? sentencePause : 1 / (charsPerSecond * speed);
    times.push(t);
    previous = char.char;
  }

  return { times, total: t };
}
