/*
 * 虛擬身分產生器（Mock Identity Generator）：產生格式自然、但完全虛構的中文姓名。
 * 使用固定種子的亂數，每次建立假資料都得到相同結果，測試與示範畫面才會穩定。
 */

/** mulberry32：小型、可重現的亂數產生器 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 臺灣常見姓氏（權重約略依常見程度） */
const SURNAMES: [string, number][] = [
  ['陳', 11], ['林', 8], ['黃', 6], ['張', 5], ['李', 5], ['王', 4], ['吳', 4], ['劉', 3], ['蔡', 3], ['楊', 3],
  ['許', 2], ['鄭', 2], ['謝', 2], ['郭', 2], ['洪', 2], ['曾', 2], ['邱', 2], ['廖', 2], ['賴', 2], ['周', 2],
  ['徐', 1], ['蘇', 1], ['葉', 1], ['莊', 1], ['呂', 1], ['江', 1], ['何', 1], ['蕭', 1], ['羅', 1], ['高', 1],
  ['潘', 1], ['簡', 1], ['朱', 1], ['鍾', 1], ['彭', 1], ['游', 1], ['詹', 1], ['胡', 1], ['施', 1], ['沈', 1],
]
const MALE = [
  '宇翔', '冠廷', '承恩', '柏翰', '品睿', '宥廷', '子睿', '家豪', '俊宇', '冠宇', '柏宇', '宇恩', '承翰', '彥廷', '哲宇',
  '博宇', '睿恩', '宥辰', '恩宇', '品翔', '宸睿', '晨恩', '秉宏', '立翔', '昱廷', '柏均', '子翔', '聖哲', '泓宇', '冠霖',
  '竣凱', '宇宸', '浩宇', '宥勳', '秉諺', '定謙', '昊恩', '皓宇', '翊恩', '永翔', '楷傑', '崇恩', '允中', '書豪', '少廷',
  '冠勳', '宏睿', '東諺', '振宇', '宇軒', '祐丞', '承佑', '宥安', '品辰', '睿哲', '致遠', '柏諺', '子揚', '宏恩', '彥均',
  '傑', '翔', '豪', '均',
]
const FEMALE = [
  '詠晴', '宜蓁', '品妍', '子晴', '芯妤', '語彤', '苡安', '宥蓁', '思妤', '可昕', '雨涵', '心妍', '以晴', '亞璇', '欣妤',
  '芊芊', '詩涵', '沛恩', '品萱', '采潔', '筱涵', '若瑜', '映彤', '佳穎', '宜庭', '郁婷', '子涵', '婕妤', '昕妤', '語嫣',
  '佩璇', '恩綺', '羽彤', '安琪', '書瑜', '芷晴', '禹彤', '宥萱', '子芸', '宇彤', '曉晴', '心怡', '怡安', '雅涵', '靜妤',
  '采妍', '品彤', '詠心', '晏如', '依璇', '千瑜', '歆妤', '予恩', '瑀彤', '芸熙', '若彤', '巧安', '姵妤', '舒涵', '允柔',
  '婷', '涵', '萱', '妤',
]
const SURNAME_TOTAL = SURNAMES.reduce((s, [, w]) => s + w, 0)

export type Gender = '男' | '女'

function pickSurname(rnd: () => number): string {
  let x = rnd() * SURNAME_TOTAL
  for (const [s, w] of SURNAMES) { x -= w; if (x < 0) return s }
  return SURNAMES[0][0]
}

/** 產生不重複的虛構中文姓名；used 會記錄已用過的姓名（可預先放入要避開的姓名） */
export function makeName(rnd: () => number, gender: Gender, used: Set<string>): string {
  const pool = gender === '男' ? MALE : FEMALE
  for (let i = 0; i < 200; i++) {
    const name = pickSurname(rnd) + pool[Math.floor(rnd() * pool.length)]
    if (!used.has(name)) { used.add(name); return name }
  }
  // 極少數情況：組合用盡時改用複姓前綴避免重複
  for (let k = 2; ; k++) {
    const name = `${pickSurname(rnd)}${pool[Math.floor(rnd() * pool.length)]}${k}`
    if (!used.has(name)) { used.add(name); return name }
  }
}

/** 依權重挑選 */
export function pickWeighted<T>(rnd: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let x = rnd() * total
  for (const [v, w] of items) { x -= w; if (x < 0) return v }
  return items[items.length - 1][0]
}

/** 洗牌（Fisher–Yates） */
export function shuffle<T>(rnd: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
