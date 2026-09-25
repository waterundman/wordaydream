/**
 * 词形匹配（lemma ↔ 例句）— v1.6.2 Stage 1
 *
 * **为什么必须是共享模块**：
 *   `verify-wordlists.mjs`（校验 R3）与 `generate-en-examples.mjs`（选句）必须用**同一套词形逻辑**。
 *   若两处各写一份，生成器认得的变形与校验器认得的不一致 → 生成即校验失败（或校验放水）。
 *
 * **设计目标不是「证明例句正确」，而是「抓出严重错配」**：
 *   数据生成是「lemma → 句子」的 join，真实风险是**接错词**（例句里根本不含该词）。
 *   因此 R3 是**弱校验（下界）**：命中不代表正确，不命中则几乎一定是错配。
 *   —— 这一点必须诚实写在文档里，不能把它当"例句质量保证"。
 *
 * 覆盖的三类现象（全部由实际数据驱动，非猜测）：
 *   1. 规则变位:  machen → machst / macht / machte / machen
 *   2. 元音变音:  laufen → läuft、tragen → trägt、Gruß → Grüße、schlafen → schläft
 *   3. 真不规则:  sein → bin/ist、nehmen → nimm、geben → gib、drei → dritt
 *      —— 这一类**无法靠规则推导**，只能列表；表项由 `de/a1` 实测残差导出（见 §12 R1）
 */

/** 归一化: 小写 + 元音变音/ß 折叠 (ä→a, ö→o, ü→u, ß→ss) */
export function normalizeWord(s) {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');
}

/**
 * 归一化 + 去掉所有非字母（连字符/点/空格）。
 * **两侧比较必须走同一口径** —— 实测踩到：`E-Mail` 因保留连字符而被归一化成 `e-mail`，
 * 与词干 `email` 对不上，导致 1 条假失败。
 */
export function squash(s) {
  return normalizeWord(s).replace(/[^a-z]/g, '');
}

/** 可剥离的后缀（英德混合；剥离后词干须 ≥3 字符，避免造出 1-2 字符的噪声词干） */
const STRIP_SUFFIXES = [
  'ieren',
  'ungen',
  'ung',
  'lich',
  'isch',
  'est',
  'ten',
  'tet',
  'test',
  'ing',
  'ed',
  'er',
  'en',
  'es',
  'st',
  'te',
  'et',
  'ly',
  'n',
  'e',
  's',
  't',
  'd',
  'r',
];

/**
 * 德语可分动词前缀。
 * 实测残差揭示：`anfangen` 的例句是 "Fangen wir an!" —— 前缀被**分离到句尾**，
 * 于是 `fangen` 不以 `anfang` 开头，任何基于原词干的匹配都会失败。
 * 解法：剥掉前缀后再取词干（`anfangen` → `fangen` → `fang`），再走前缀兜底。
 */
const SEPARABLE_PREFIXES = [
  'zurück',
  'zusammen',
  'auseinander',
  'entgegen',
  'gegenüber',
  'vorbei',
  'weiter',
  'wieder',
  'nieder',
  'hinter',
  'davon',
  'dazu',
  'durch',
  'überein',
  'wahr',
  'fern',
  'frei',
  'hoch',
  'los',
  'mit',
  'nach',
  'vor',
  'aus',
  'auf',
  'ein',
  'an',
  'ab',
  'bei',
  'zu',
  'weg',
  'dar',
  'er',
  'ver',
  'zer',
  'um',
];

/** 取词干候选（含原形本身，以及剥掉可分前缀后的形式）。 */
export function stems(lemma) {
  const base = squash(lemma);
  const roots = new Set([base]);
  for (const p of SEPARABLE_PREFIXES) {
    if (base.startsWith(p) && base.length - p.length >= 3) roots.add(base.slice(p.length));
  }
  const out = new Set();
  for (const root of roots) {
    out.add(root);
    for (const suf of STRIP_SUFFIXES) {
      if (root.endsWith(suf) && root.length - suf.length >= 3) out.add(root.slice(0, -suf.length));
    }
  }
  return [...out];
}

/** 真不规则形式表（key 为归一化后的 lemma）。表项来源：实测残差，逐项有据。 */
export const IRREGULAR_FORMS = {
  // 德语: 系动词/情态动词与强变化动词的命令式、现在时 (de/a1 实测残差)
  sein: ['bin', 'bist', 'ist', 'sind', 'seid', 'war', 'waren', 'gewesen'],
  haben: ['habe', 'hast', 'hat', 'haben', 'habt', 'hatte', 'hatten', 'gehabt'],
  werden: ['werde', 'wirst', 'wird', 'werden', 'werdet', 'wurde', 'wurden', 'geworden'],
  geben: ['gebe', 'gibst', 'gibt', 'gib', 'geben', 'gebt', 'gab', 'gaben', 'gegeben'],
  nehmen: ['nehme', 'nimmst', 'nimmt', 'nimm', 'nehmen', 'nehmt', 'nahm', 'nahmen', 'genommen'],
  essen: ['esse', 'isst', 'isst', 'esst', 'essen', 'aß', 'aßen', 'gegessen'],
  lesen: ['lese', 'liest', 'lesen', 'lest', 'las', 'lasen', 'gelesen'],
  sehen: ['sehe', 'siehst', 'sieht', 'sieh', 'sehen', 'seht', 'sah', 'sahen', 'gesehen'],
  fahren: ['fahre', 'fährst', 'fährt', 'fahren', 'fahrt', 'fuhr', 'fuhren', 'gefahren'],
  schlafen: ['schlafe', 'schläfst', 'schläft', 'schlafen', 'schlaft', 'schlief', 'geschlafen'],
  laufen: ['laufe', 'läufst', 'läuft', 'laufen', 'lauft', 'lief', 'liefen', 'gelaufen'],
  wissen: ['weiß', 'weißt', 'wissen', 'wisst', 'wusste', 'gewusst'],
  // 德语: 情态动词 (高频 A1, 全部强变化)
  können: ['kann', 'kannst', 'können', 'könnt', 'konnte', 'konnten', 'gekonnt'],
  müssen: ['muss', 'musst', 'müssen', 'müsst', 'musste', 'mussten', 'gemusst'],
  dürfen: ['darf', 'darfst', 'dürfen', 'dürft', 'durfte', 'durften', 'gedurft'],
  wollen: ['will', 'willst', 'wollen', 'wollt', 'wollte', 'wollten', 'gewollt'],
  sollen: ['soll', 'sollst', 'sollen', 'sollt', 'sollte', 'sollten', 'gesollt'],
  mögen: ['mag', 'magst', 'mögen', 'mögt', 'mochte', 'mochten', 'gemocht'],
  // 德语: 序数/派生 (drei → dritt)
  drei: ['dritt', 'dritte', 'dritten', 'dritter', 'drittes'],
  // 德语: 介词与冠词的融合形式 (封闭集, 高频) —— 纯规则推导不出来
  zu: ['zum', 'zur', 'zur'],
  in: ['im', 'ins'],
  an: ['am', 'ans'],
  bei: ['beim'],
  von: ['vom'],
  auf: ['aufs'],
  für: ['fürs'],
  durch: ['durchs'],
  um: ['ums'],
  // 英语: 高频不规则
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  say: ['says', 'said', 'saying'],
  get: ['gets', 'got', 'gotten', 'getting'],
  make: ['makes', 'made', 'making'],
  take: ['takes', 'took', 'taken', 'taking'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  come: ['comes', 'came', 'coming'],
  think: ['thinks', 'thought', 'thinking'],
  know: ['knows', 'knew', 'known', 'knowing'],
  give: ['gives', 'gave', 'given', 'giving'],
  find: ['finds', 'found', 'finding'],
  tell: ['tells', 'told', 'telling'],
  become: ['becomes', 'became', 'becoming'],
  leave: ['leaves', 'left', 'leaving'],
  feel: ['feels', 'felt', 'feeling'],
  bring: ['brings', 'brought', 'bringing'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  keep: ['keeps', 'kept', 'keeping'],
  hold: ['holds', 'held', 'holding'],
  write: ['writes', 'wrote', 'written', 'writing'],
  stand: ['stands', 'stood', 'standing'],
  hear: ['hears', 'heard', 'hearing'],
  let: ['lets', 'letting'],
  mean: ['means', 'meant', 'meaning'],
  set: ['sets', 'setting'],
  meet: ['meets', 'met', 'meeting'],
  run: ['runs', 'ran', 'running'],
  pay: ['pays', 'paid', 'paying'],
  sit: ['sits', 'sat', 'sitting'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  lie: ['lies', 'lay', 'lain', 'lying'],
  lead: ['leads', 'led', 'leading'],
  read: ['reads', 'reading'],
  grow: ['grows', 'grew', 'grown', 'growing'],
  lose: ['loses', 'lost', 'losing'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  send: ['sends', 'sent', 'sending'],
  build: ['builds', 'built', 'building'],
  understand: ['understands', 'understood', 'understanding'],
  draw: ['draws', 'drew', 'drawn', 'drawing'],
  break: ['breaks', 'broke', 'broken', 'breaking'],
  spend: ['spends', 'spent', 'spending'],
  cut: ['cuts', 'cutting'],
  rise: ['rises', 'rose', 'risen', 'rising'],
  drive: ['drives', 'drove', 'driven', 'driving'],
  buy: ['buys', 'bought', 'buying'],
  wear: ['wears', 'wore', 'worn', 'wearing'],
  choose: ['chooses', 'chose', 'chosen', 'choosing'],
  seek: ['seeks', 'sought', 'seeking'],
  throw: ['throws', 'threw', 'thrown', 'throwing'],
  catch: ['catches', 'caught', 'catching'],
  deal: ['deals', 'dealt', 'dealing'],
  win: ['wins', 'won', 'winning'],
  forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
  teach: ['teaches', 'taught', 'teaching'],
  fight: ['fights', 'fought', 'fighting'],
  fly: ['flies', 'flew', 'flown', 'flying'],
  eat: ['eats', 'ate', 'eaten', 'eating'],
  drink: ['drinks', 'drank', 'drunk', 'drinking'],
  sing: ['sings', 'sang', 'sung', 'singing'],
  sleep: ['sleeps', 'slept', 'sleeping'],
  swim: ['swims', 'swam', 'swum', 'swimming'],
  ride: ['rides', 'rode', 'ridden', 'riding'],
  shoot: ['shoots', 'shot', 'shooting'],
  hurt: ['hurts', 'hurting'],
  put: ['puts', 'putting'],
  sell: ['sells', 'sold', 'selling'],
  // 英语: 形容词/副词不规则
  good: ['better', 'best'],
  bad: ['worse', 'worst'],
  far: ['further', 'furthest', 'farther', 'farthest'],
  little: ['less', 'least'],
  many: ['more', 'most'],
  much: ['more', 'most'],
  child: ['children'],
  man: ['men'],
  woman: ['women'],
  person: ['people'],
  foot: ['feet'],
  tooth: ['teeth'],
  mouse: ['mice'],
  life: ['lives'],
  knife: ['knives'],
  wife: ['wives'],
};

/**
 * 归一化后的不规则表查询表（**必须建在 IRREGULAR_FORMS 之后**，否则 TDZ 报错）。
 *
 * 键值都要归一化：表为了可读性用 `können` / `weiß` 这类正确拼写书写，
 * 而代码侧的 base 与 token 都已归一化成 `konnen` / `weiss`。
 * 实测踩到：键未归一化 ⇒ `können` 永远查不到表（können/dürfen/mögen 三条假失败）；
 * 值未归一化 ⇒ `wissen → weiß` 永远对不上。
 */
const IRREGULAR_LOOKUP = new Map(
  Object.entries(IRREGULAR_FORMS).map(([k, v]) => [squash(k), v.map(squash)])
);

/** 单条 token 的最小比较长度（短于此长度不参与词干弱匹配，避免 I/at 之类噪声） */
const MIN_STEM = 3;

/**
 * 生成 lemma 的全部可接受词形（归一化后）。
 * 生成器用它做**精确 token 命中**；校验器用它 + 词干前缀兜底做 R3。
 */
export function forms(lemma) {
  const out = new Set();
  const base = squash(lemma);
  if (base) out.add(base);
  for (const s of stems(lemma)) {
    for (const suf of ['', 's', 'es', 'e', 'en', 'n', 'st', 't', 'te', 'ten', 'tet', 'test', 'et', 'ed', 'ing', 'er', 'est', 'ly', 'd', 'r']) {
      out.add(s + suf);
    }
  }
  for (const ir of IRREGULAR_LOOKUP.get(base) ?? []) out.add(ir);
  return out;
}

/** 切词（归一化 + 去非字母）。保留连字符与撇号作内部分隔，再由 squash 折叠 —— 这样 `E-Mail` 与 `email` 可比。 */
export function tokenize(sentence) {
  return (String(sentence).toLowerCase().match(/[a-zäöüß][a-zäöüß'-]*/g) ?? [])
    .map(squash)
    .filter((t) => t.length > 0);
}

/** 复合词最小前缀盈余：token 必须比词干至少长这么多字符才算"复合"，避免 Rohr/Ohr 这类近形词误命中 */
const MIN_COMPOUND_SURPLUS = 3;

/**
 * 多词短语条目（含空格的 lemma，如 `no one` / `have to` / `post office` / `per cent`）。
 *
 * **为什么必须单独处理（实测踩到）**：`tokenize` 按空格切词，于是 `no one` 永远不可能作为一个
 * token 出现 —— 逐 token 的精确匹配与词干兜底对多词条目**结构性失效**。
 * 后果有两面：
 *   1. 真的短语例句拿不到（实测 10 个多词条目里 6 个零覆盖）
 *   2. 词干剥离反过来制造错配（`no one` → stems 剥掉 `e` 得 `noon`，于是
 *      例句被选成 `It is just noon.`，语义完全无关）
 * 故多词条目**只走 `containsPhrase`**，不参与词干/前缀/复合那套为单词设计的机制。
 */
export function isMultiWord(lemma) {
  return /\s/.test(String(lemma).trim());
}

/**
 * 短语匹配（专供多词 lemma）：**词序列连续**或**连写形式**命中。
 *
 * 两条规则各自对应一种真实写法：
 *   ① 词序列连续 —— `no one` 命中 `No one knows.`（正常分写）
 *   ② 连写等价   —— `ice cream` 命中 `ice-cream` / `icecream`（连字符或合写）
 *
 * **为什么不用"整句 squash 后找子串"**：那会让 `all right` 命中 `ball right`。
 * 逐 token 比较保住了词边界，连写规则则用**完整相等**而非子串 —— 两头都不放水。
 * 反例（必须在测试里钉住）：`no one` **不得**命中 `It is just noon.`。
 */
export function containsPhrase(lemma, sentence) {
  const parts = tokenize(lemma);
  if (parts.length === 0) return false;
  const sent = tokenize(sentence);
  if (parts.length === 1) return sent.includes(parts[0]);
  if (sent.includes(parts.join(''))) return true;
  for (let i = 0; i + parts.length <= sent.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (sent[i + j] !== parts[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * 屈折后缀白名单 —— 与 `STRIP_SUFFIXES` **不同**：这份是"同一个词的不同形态"，
 * 而非"同根派生词"。区别很重要：
 *   `work → works/worked/working` 是屈折（同一词，用法示例有效）
 *   `similarly → similar`        是同根派生（**不同词性**，示例里没出现该词本身）
 * 后者是 SPEC D3「词干兜底」允许的**下界行为**，但作为词典例句质量更低，
 * 因此需要单独量化（v1.6.2 §12），并在排序里让位给屈折命中。
 */
const INFLECTION_SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly', 'n', 'en', 'st', 't', 'r'];

/** 双写辅音 + ing/ed (stop → stopped/stopping) */
const DOUBLING_CONSONANTS = /[bdgklmnprt]/;

/**
 * `token` 是否只是 `lemma` 的**屈折/不规则变形**（而非同根派生词）。
 * 判定全部在归一化后的字符串上做，与 `forms()` 同一口径。
 *
 * 注意 `is`/`bin`/`läuft` 这类**不规则**变形由 `IRREGULAR_LOOKUP` 判定 —— 它们是真屈折。
 */
export function isInflectionalForm(lemma, token) {
  const b = squash(lemma);
  const t = squash(token);
  if (!b || !t) return false;
  if (t === b) return true;
  for (const suf of INFLECTION_SUFFIXES) if (t === b + suf) return true;
  if (b.endsWith('y')) {
    const stem = b.slice(0, -1);
    if (t === stem + 'ies' || t === stem + 'ied' || t === stem + 'ier' || t === stem + 'iest') return true;
  }
  if (b.endsWith('e')) {
    const stem = b.slice(0, -1);
    if (t === stem + 'ing' || t === stem + 'ed') return true;
  }
  if (b.endsWith('f') && t === b.slice(0, -1) + 'ves') return true;
  if (b.endsWith('fe') && t === b.slice(0, -2) + 'ves') return true;
  const last = b.slice(-1);
  if (DOUBLING_CONSONANTS.test(last) && (t === b + last + 'ing' || t === b + last + 'ed')) return true;
  if ((IRREGULAR_LOOKUP.get(b) ?? []).includes(t)) return true;
  return false;
}

/**
 * 命中层级（v1.6.2 Stage 2 选句排序用）。
 *   0 base      原形精确命中
 *   1 inflection 屈折/不规则变形命中（示例里出现的仍是该词本身）
 *   2 derived   同根派生词命中（**可能跨词性**，如 similarly ← similar）
 *   3 fallback  仅靠词干前缀/复合后缀兜底命中
 * @returns {0|1|2|3}
 */
export function matchTier(lemma, sentence) {
  // 多词短语: 逐 token 机制结构性不适用, 只认短语命中 (见 isMultiWord / containsPhrase)
  if (isMultiWord(lemma)) return containsPhrase(lemma, sentence) ? 0 : 3;
  const toks = tokenize(sentence);
  if (toks.length === 0) return 3;
  const base = squash(lemma);
  if (toks.includes(base)) return 0;
  const acc = forms(lemma);
  const hits = toks.filter((t) => acc.has(t));
  if (hits.length > 0) return hits.some((t) => isInflectionalForm(lemma, t)) ? 1 : 2;
  return 3;
}

/**
 * R3 核心判定：`sentence` 是否含 `lemma` 的某个可接受词形。
 *
 * **多词短语先分流**：`isMultiWord(lemma)` 为真时只用 `containsPhrase` ——
 * 空格会让 `tokenize` 把短语切成多 token，逐 token 的三段式对它们结构性失效（见 `isMultiWord`）。
 *
 * 单词的四段式（**宽进**，只求抓严重错配）：
 *   1. **精确**：任一 token ∈ forms(lemma) —— 此处**不过滤短词**，否则 `ja` / `du` / `er` / `es`
 *      这类 2 字符虚词永远无法命中（实测踩到: 30 条残差里 4 条是这个原因）。
 *   2. **前缀兜底**：任一 token 以某个词干**开头**（词干与 token 均须 ≥ MIN_STEM）。
 *      覆盖未列表的规则变位；代价是会接受少量同族词（Art 命中 Artikel），这是**有意的**。
 *   3. **复合词后缀**：任一 token 以某个词干**结尾**且盈余 ≥ MIN_COMPOUND_SURPLUS。
 *      德语复合名词的必需品（`Saft` ← `Apfelsaft`）；用盈余阈值排除近形词假命中
 *      （`Rohr` 不以"复合"方式命中 `Ohr`，因盈余仅 1）。
 */
export function containsLemma(lemma, sentence) {
  // 多词短语走独立规则 —— 见 isMultiWord / containsPhrase 的注释
  if (isMultiWord(lemma)) return containsPhrase(lemma, sentence);
  const toks = tokenize(sentence);
  if (toks.length === 0) return false;
  const accepted = forms(lemma);
  for (const t of toks) {
    if (accepted.has(t)) return true;
  }
  const longToks = toks.filter((t) => t.length >= MIN_STEM);
  if (longToks.length === 0) return false;
  for (const s of stems(lemma)) {
    if (s.length < MIN_STEM) continue;
    if (longToks.some((t) => t.startsWith(s))) return true;
    if (longToks.some((t) => t.endsWith(s) && t.length - s.length >= MIN_COMPOUND_SURPLUS)) return true;
  }
  return false;
}
