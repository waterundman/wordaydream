#!/usr/bin/env node
/**
 * v1.6.0 Stage 1 (S1): 英语 CEFR 词表生成脚本
 *
 * 数据来源 (均为 MIT 许可, 通过 npm 获取, 不入库):
 *   1. @polyglot-bundles/en-word-lists  — Oxford 3000/5000 分级的英语词 (lemma/pos/cefr/category)
 *      npm pack @polyglot-bundles/en-word-lists
 *   2. ecdict                          — ECDICT 英汉词典数据集 (中文释义/词频/考纲标签)
 *      npm pack ecdict                  (skywind3000/ECDICT, MIT)
 *
 * 用法:
 *   node scripts/generate-en-wordlists.mjs               # dry-run: 只打印统计, 不写文件
 *   node scripts/generate-en-wordlists.mjs --write       # 写入 src/data/wordlists/en/*.json
 *   WL_SRC=<dir> node scripts/generate-en-wordlists.mjs  # 覆盖源目录 (默认 .tmp-wl)
 *
 * 派生规则 (对齐德语词表 v2 schema):
 *   - translation: 取 ECDICT 中文释义首个义项 (剥离词性前缀, 剔除 [计]/[经] 等专业域与百科式长尾);
 *                  少量词典缺失词走 MANUAL_ZH 人工补录
 *   - frequency:   由 COCA 词频序号 (frq) 映射为 1(最高频)~5(最低频)
 *   - priority:    由 collins 星级 + frq 序号 + oxford 核心表 + 考纲标签合成核心度评分,
 *                  再按该等级内评分三分位切分为 1(核心 30%) / 2(常用 40%) / 3(边缘 30%)
 *   - topic:       优先取词表包语义分类(规范化命名) → 人工主题表 → 按 pos 归入 <pos>_basic → general
 *
 * 说明: 不产出 example/exampleTranslation — 上游数据源无例句语料, 手工编造 4000 条例句
 *       会产生错误示范; 该字段为可选且当前无消费方, 留待后续版本接入真实语料.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

const SRC = process.env.WL_SRC ? path.resolve(process.env.WL_SRC) : path.resolve('.tmp-wl');
const CEFR_BASE = path.join(SRC, 'package/dist/json');
const ECDICT_CSV = path.join(SRC, 'ecdict/package/assets/ecdict.csv');
const OUT_DIR = path.resolve('src/data/wordlists/en');
const WRITE = process.argv.includes('--write');

const LEVELS = [
  { key: 'a1', level: 'A1', difficulty: 1 },
  { key: 'a2', level: 'A2', difficulty: 2 },
  { key: 'b1', level: 'B1', difficulty: 3 },
  { key: 'b2', level: 'B2', difficulty: 4 },
];

// v2 schema 输出字段顺序 (对齐德语词表)
const FIELD_ORDER = ['lemma', 'pos', 'translation', 'cefr', 'frequency', 'topic', 'priority', 'semanticConflicts'];

// 易混词组 (人工整理): 同一等级内若同组 ≥2 词共现, 则互相标注 semanticConflicts.
// 用途: getUnlearnedWordsSync 避免把易混词放进同一批 targetWords.
const CONFUSABLE_GROUPS = [
  ['accept', 'except'], ['affect', 'effect'], ['advice', 'advise'], ['quiet', 'quite'],
  ['than', 'then'], ['lose', 'loose'], ['principal', 'principle'], ['borrow', 'lend'],
  ['bring', 'take'], ['say', 'tell', 'speak', 'talk'], ['make', 'do'], ['look', 'see', 'watch'],
  ['hear', 'listen'], ['hope', 'wish'], ['learn', 'teach'], ['rise', 'raise'], ['lie', 'lay'],
  ['job', 'work'], ['travel', 'trip', 'journey'], ['few', 'little'], ['much', 'many'],
  ['big', 'large'], ['small', 'little'], ['cost', 'price'], ['opportunity', 'chance'],
  ['amount', 'number'], ['historic', 'historical'], ['beside', 'besides'], ['adapt', 'adopt'],
  ['personal', 'personnel'], ['sensible', 'sensitive'], ['economic', 'economical'],
  ['effective', 'efficient'], ['compare', 'contrast'], ['distinct', 'distinctive'],
  ['considerable', 'considerate'], ['industrial', 'industrious'], ['successive', 'successful'],
  ['temporary', 'contemporary'], ['extend', 'expand'], ['refuse', 'decline', 'reject'],
  ['allow', 'permit'], ['announce', 'declare'], ['assure', 'ensure', 'insure'],
  ['avoid', 'prevent'], ['between', 'among'], ['either', 'neither'], ['some', 'any'],
  ['invent', 'discover'], ['remember', 'remind'], ['steal', 'rob'], ['arrive', 'reach'],
  ['hear', 'listen'], ['see', 'look'], ['catch', 'hold'], ['speak', 'talk'],
  ['eventually', 'finally'], ['specially', 'especially'], ['besides', 'except'],
  ['comprise', 'compose'], ['continual', 'continuous'], ['respectable', 'respectful'],
  ['imaginary', 'imaginative'], ['alternate', 'alternative'], ['neglect', 'ignore'],
  ['deny', 'refuse'], ['damage', 'injure', 'wound'], ['recover', 'restore'],
];

// ---------- pos 归一化: 对齐德语词表短码 ----------
const POS_MAP = {
  noun: 'noun', verb: 'verb', adjective: 'adj', adverb: 'adv',
  pronoun: 'pron', preposition: 'prep', number: 'num', determiner: 'det',
  conjunction: 'conj', exclamation: 'intj', 'modal verb': 'modal',
  'ordinal number': 'num', 'indefinite article': 'det', 'definite article': 'det',
  'auxiliary verb': 'verb', 'linking verb': 'verb', 'infinitive marker': 'part',
};
const normalizePos = (p) => POS_MAP[String(p || '').trim().toLowerCase()] ?? 'misc';

// 上游词表包 POS 误标的人工纠正 (逐个核对确认)
const POS_OVERRIDE = { attention: 'noun' };

// 词表包 category 命名 → 德语词表口径
const CATEGORY_MAP = {
  animals: 'animal', 'body-parts': 'body', colors: 'color', places: 'place',
  verbs: 'verb_basic', clothing: 'clothing', family: 'family', food: 'food',
  weather: 'weather', academic: 'academic', business: 'business', technology: 'technology',
};

// 虚词/泛类词 → POS 派生主题
const POS_TOPIC = {
  prep: 'prep_basic', conj: 'conj_basic', pron: 'pron_basic', det: 'det_basic',
  num: 'number', part: 'part_basic', modal: 'modal_basic', intj: 'greeting',
  adv: 'adv_basic', verb: 'verb_basic', adj: 'adj_basic',
};

// ---------- 人工补录: ECDICT 无可用中文释义的词 ----------
const MANUAL_ZH = {
  internet: '互联网', website: '网站', dvd: 'DVD 光盘', online: '在线的', oh: '哦',
  between: '在…之间', shoes: '鞋', among: '在…之中', yours: '你的', download: '下载',
  laptop: '笔记本电脑', 'any more': '不再', app: '应用程序', upload: '上传', euro: '欧元',
  bacteria: '细菌', firefighter: '消防员', funding: '资金', membership: '会员资格',
  starve: '饿死/挨饿', trading: '贸易', affordable: '负担得起的',
  globalization: '全球化', screening: '筛查/放映',
};

// ---------- 人工主题表: topic -> lemmas ----------
const TOPIC_MAP = {};
for (const [topic, words] of Object.entries({
  greeting: 'hello hi hey goodbye bye please thanks thank sorry excuse welcome yes no ok okay oh congratulations cheers',
  family: 'mother father parent parents brother sister son daughter child children baby boy girl husband wife grandfather grandmother grandparent uncle aunt cousin nephew niece relative couple twin marriage marry married wedding divorce',
  food: 'food bread rice meat beef pork chicken fish egg milk cheese butter water coffee tea juice beer wine sugar salt pepper soup salad fruit apple banana orange lemon grape strawberry pear peach potato tomato carrot onion vegetable bean nut cake pie cookie biscuit chocolate candy icecream breakfast lunch dinner supper meal dish plate cup glass bottle knife fork spoon restaurant cafe menu hungry thirsty delicious taste eat drink cook boil fry bake slice recipe snack diet',
  house: 'house home room bedroom bathroom kitchen livingroom door window wall floor roof garden yard key table chair bed sofa desk lamp light mirror clock picture curtain carpet shelf box bag cupboard fridge stove oven sink toilet bath shower stairs garage apartment flat building lift elevator fence gate towel pillow blanket',
  body: 'body head hair face eye eyes ear nose mouth tooth teeth tongue lip neck shoulder arm hand finger thumb leg knee foot feet toe back chest stomach heart blood skin bone brain mind voice beard moustache',
  clothing: 'clothes clothing shirt dress skirt trousers pants jeans jacket coat sweater hat cap shoe shoes boot sock socks glove gloves scarf tie belt uniform pocket button wear dressed fashion',
  color: 'color red blue green yellow black white grey brown pink purple gold silver dark bright pale orange',
  time: 'time hour minute second day week month year morning afternoon evening night midnight today tomorrow yesterday now soon early late always never often sometimes usually rarely weekend monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december spring summer autumn winter season moment period future past present century decade',
  weather: 'weather rain rainy snow snowy wind windy sun sunny cloud cloudy storm thunder lightning ice fog hot cold warm cool temperature degree freeze flood drought',
  nature: 'nature tree trees flower grass leaf leaves plant seed root wood forest mountain hill river lake sea ocean beach island sky star moon earth world sun fire air water stone sand rock field valley desert jungle environment pollution climate global warming',
  animal: 'animal dog cat bird fish horse cow pig sheep chicken duck lion tiger bear elephant monkey rabbit mouse rat snake insect bee ant fly spider frog wolf fox deer butterfly whale dolphin shark',
  transport: 'car bus train plane airplane aeroplane ship boat bike bicycle taxi truck motorbike motorcycle subway metro underground station airport port road street bridge traffic ticket drive ride fly journey trip passenger driver licence license petrol fuel engine wheel',
  school: 'school student students teacher class classroom lesson book books pen pencil paper notebook homework exam examination test study learn teach read write page letter word language english maths mathematics science history geography university college degree subject dictionary library education course grade term holiday',
  work: 'work job office boss worker employee employer company manager meeting project team salary wage money pay career interview profession doctor nurse engineer lawyer farmer waiter waitress police officer soldier journalist chef scientist accountant secretary colleague staff business client',
  shopping: 'shop store market money price cheap expensive buy sell pay cost cash card bill customer sale discount purchase receipt shopping trolley supermarket brand refund',
  health: 'health healthy ill sick illness disease pain ache medicine drug doctor hospital nurse pill tablet fever cold cough headache toothache stomachache hurt injury wound cure treatment exercise rest sleep tired stress depression allergy surgery ambulance patient',
  leisure: 'music song sing dance dancing film movie cinema game games play sport football soccer basketball tennis volleyball golf swimming swim run jogging walk hiking hobby photo photograph camera party party holiday vacation festival birthday gift present television tv radio concert theatre theater museum painting drawing chess camping fishing picnic',
  travel: 'travel journey trip holiday vacation hotel room booking luggage baggage passport visa airport flight tourist tourism map guide abroad foreign country city town village sightseeing resort',
  communication: 'phone telephone call talk speak say tell ask answer question message text email letter mail internet computer website mobile smartphone newspaper news magazine information announce discuss conversation chat interview report',
  emotion: 'happy unhappy sad angry anger afraid fear frightened scared love like hate enjoy hope wish want need feel feeling mood glad pleased sorry surprised worried nervous excited proud lonely bored interesting funny serious calm jealous grateful disappointed',
  technology: 'computer internet website email screen keyboard mouse program software hardware data file download upload network digital device app machine robot technology online password website battery charger cable printer laptop',
  business: 'business company firm market market bank account contract customer client product service profit invest investment sale trade industry economy economic management manager shareholder finance financial budget tax loan debt stock share insurance marketing',
  academic: 'research theory method analysis data evidence argument concept definition hypothesis conclusion academic study science knowledge result survey experiment sample statistics literature essay thesis theory',
  society: 'society social community public government law legal right rights citizen population culture tradition custom religion politics political election vote parliament president minister policy democracy freedom equality justice crime police court prison war peace army military refugee immigration',
  science: 'science scientific experiment laboratory physics chemistry biology mathematics astronomy gene cell atom energy gravity molecule theory research discovery invention',
  art: 'art artist painting sculpture gallery museum music musician painting drawing design photography theatre theater drama novel poetry poem literature author writer',
  sport: 'sport sports team player match game score goal win lose draw coach referee champion championship tournament medal prize competition race football soccer basketball tennis swimming running cycling boxing skiing',
  quantity: 'many much more most few little less least enough several all some any none both each every number amount total half double single pair piece part whole group set series',
  direction: 'north south east west left right up down above below under over inside outside front back near far here there everywhere nowhere direction straight forward backward',
  movement: 'go come walk run jump climb fall rise stand sit lie move turn open close push pull carry lift drop throw catch hold bring take send arrive leave enter exit travel drive ride fly swim',
  thinking: 'think know understand believe remember forget learn realise realize mean decide choose consider imagine suppose expect hope guess doubt wonder recognise recognize assume conclude attention idea opinion reason purpose memory knowledge experience judgement judgment logic',
  relationship: 'friend friendship neighbour neighbor stranger colleague partner team member guest host relationship love respect trust support help share care argue quarrel forgive',
  city: 'city town village street road building bridge square park traffic crossing pavement sidewalk address district suburb capital neighbourhood neighborhood',
})) {
  for (const w of String(words).split(/\s+/)) {
    if (w && !(w in TOPIC_MAP)) TOPIC_MAP[w] = topic;
  }
}

// ---------- 中文释义清洗 (按目标词性对齐取义) ----------
const LINE_PREFIX = /^\s*([a-z]+)\.\s*/i;
const NOISE = /(\[|\]|计算机|(星)座|会员|【|】)/;
// ECDICT 行首词性标记 → 归一化 pos
const MARKER_POS = {
  n: 'noun', v: 'verb', vt: 'verb', vi: 'verb', a: 'adj', adj: 'adj', adv: 'adv',
  prep: 'prep', conj: 'conj', pron: 'pron', num: 'num', art: 'det', det: 'det',
  int: 'intj', interj: 'intj', aux: 'verb', modal: 'modal', part: 'part', abbr: 'misc',
};

/** 清洗单个义项行 → 1~2 个短义项; 返回 '' 表示该行不可用 */
function cleanLine(line) {
  const s = line.replace(LINE_PREFIX, '').trim();
  if (!s) return '';
  const keep = [];
  for (let p of s.split(/[,，;；]/).map((x) => x.trim()).filter(Boolean)) {
    if (NOISE.test(p)) continue;                        // 百科式/专业域长尾
    // ECDICT 用省略号表示宾语槽位: 前置省略号是依赖上下文的残片 (如 off 的 "...掉"), 整段丢弃;
    // 中/后置省略号是正常释义 (如 "在...之后"), 剥离尾点并收敛为 …
    if (/^[.…]/.test(p)) continue;
    p = p.replace(/[.…\s]+$/, '').replace(/\.{2,}|…+/g, '…').trim();
    if (!p) continue;
    if (!/^[\u4e00-\u9fa5A-Za-z0-9/·….-]+$/.test(p)) continue;
    if (p.length > 12) continue;                        // 过长的解释性义项
    if (keep.includes(p)) continue;
    keep.push(p);
    if (keep.length >= 2) break;
  }
  return keep.join('/');
}

/**
 * 从 ECDICT 释义中取与 targetPos 匹配的义项.
 * ECDICT 释义按义项顺序排列并带词性前缀, 而词表包标注的词性是词在词表中的用法 —
 * 二者常不一致 (如 clear 首义项为 a. 清楚的, 但词表标 verb), 故必须按词性对齐取义.
 */
function cleanTranslation(raw, targetPos) {
  if (!raw) return '';
  // ECDICT 中文释义内的换行是字面 "\n" 两字符
  const lines = String(raw).split(/\\n|\n/).map((s) => s.trim()).filter((l) => l && !/^\[/.test(l));
  const matched = [];
  const generic = [];
  for (const line of lines) {
    const m = LINE_PREFIX.exec(line);
    if (!m) { generic.push(line); continue; }
    if (MARKER_POS[m[1].toLowerCase()] === targetPos) matched.push(line);
  }
  // 优先级: 词性匹配行 → 无词性前缀行 (多为通用释义) → 首行
  for (const line of [...matched, ...generic, ...lines]) {
    const r = cleanLine(line);
    if (r) return r;
  }
  return '';
}

// ---------- 核心度评分 (0~7.5) ----------
function corenessScore(row) {
  const collins = Number(row.collins) || 0;
  const frq = Number(row.frq) || 0;
  const oxford = String(row.oxford ?? '').trim() === '1';
  const tags = String(row.tag ?? '').trim().split(/\s+/).filter(Boolean);
  const examCore = tags.some((t) => ['zk', 'gk', 'cet4'].includes(t));

  const starPart = Math.min(collins, 5) / 5;                            // 0..1
  const freqPart = frq > 0 ? Math.max(0, 1 - Math.log10(frq) / 4) : 0;  // 0..1
  const oxPart = oxford ? 1 : 0;
  const tagPart = examCore ? 1 : (tags.length ? 0.5 : 0);
  return 3 * starPart + 3 * freqPart + oxPart + 0.5 * tagPart;
}

const deriveFrequency = (frq) => {
  const n = Number(frq);
  if (!Number.isFinite(n) || n <= 0) return 5;
  if (n <= 500) return 1;
  if (n <= 1500) return 2;
  if (n <= 4000) return 3;
  if (n <= 10000) return 4;
  return 5;
};

// ---------- 源数据加载 ----------
function loadCefr() {
  const out = new Map();
  for (const { key } of LEVELS) {
    const dir = path.join(CEFR_BASE, key);
    const m = new Map();
    for (const f of fs.readdirSync(dir).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cat = CATEGORY_MAP[j.category] ?? (j.category !== 'general' ? j.category : null);
      for (const w of j.words ?? []) {
        const lemma = String(w.word ?? '').trim();
        const k = lemma.toLowerCase();
        if (!k || m.has(k)) continue;
        m.set(k, { lemma, pos: POS_OVERRIDE[k] ?? normalizePos(w.partOfSpeech), category: cat, cefr: j.examGrade ?? key.toUpperCase() });
      }
    }
    out.set(key, m);
  }
  return out;
}

function loadEcdict() {
  const { data } = Papa.parse(fs.readFileSync(ECDICT_CSV, 'utf8'), { header: true, skipEmptyLines: true });
  const m = new Map();
  for (const r of data) {
    const k = String(r.word ?? '').trim().toLowerCase();
    if (!k || m.has(k)) continue;
    m.set(k, r);
  }
  return m;
}

// ---------- 组装 ----------
function build() {
  const cefr = loadCefr();
  const ec = loadEcdict();
  const result = {};
  const stats = {};

  for (const { key, level, difficulty } of LEVELS) {
    const raw = [];
    const diag = { noEc: 0, noZh: 0, fallback: [] };
    for (const [k, v] of cefr.get(key)) {
      const row = ec.get(k);
      let zh = MANUAL_ZH[k] ?? '';
      if (!row) diag.noEc++;
      if (!zh && row) {
        zh = cleanTranslation(row.translation, v.pos);
        if (!zh) diag.noZh++;
      }
      if (!zh) { diag.fallback.push(k); zh = k; }   // 契约要求 translation 非空
      const topic = v.category ?? TOPIC_MAP[k] ?? POS_TOPIC[v.pos] ?? 'general';
      raw.push({
        lemma: v.lemma, pos: v.pos, translation: zh, cefr: v.cefr,
        frequency: row ? deriveFrequency(row.frq) : 5,
        topic,
        _score: row ? corenessScore(row) : 0,
      });
    }

    // 同级内双向标注易混词 (getUnlearnedWordsSync 据此避免同批次放入易混词)
    // 注: 一个词可能属于多个易混组 (如 speak 同属 say/tell/speak/talk 与 speak/talk),
    //     必须合并而非覆盖, 否则后声明的小组会破坏前面的双向标注.
    const present = new Set(raw.map((w) => w.lemma.toLowerCase()));
    let conflictWords = 0;
    for (const group of CONFUSABLE_GROUPS) {
      const hit = group.filter((g) => present.has(g));
      if (hit.length < 2) continue;
      for (const w of raw) {
        const key = w.lemma.toLowerCase();
        if (!hit.includes(key)) continue;
        const merged = new Set([...(w.semanticConflicts ?? []), ...hit.filter((x) => x !== key)]);
        w.semanticConflicts = [...merged].sort();
        conflictWords++;
      }
    }

    // 等级内按核心度三分位切分 priority (30% / 40% / 30%)
    raw.sort((a, b) => b._score - a._score || a.lemma.localeCompare(b.lemma));
    const n = raw.length;
    raw.forEach((w, i) => { w.priority = i < n * 0.3 ? 1 : i < n * 0.7 ? 2 : 3; });

    // 最终顺序: priority 升序 → topic → 核心度降序 (学习队列稳定排序时同簇内仍高频优先)
    raw.sort((a, b) => a.priority - b.priority || a.topic.localeCompare(b.topic) || b._score - a._score || a.lemma.localeCompare(b.lemma));

    const words = raw.map((w) => {
      const o = {};
      for (const f of FIELD_ORDER) o[f] = w[f];
      return o;
    });

    result[key] = { language: 'en', level, difficulty, version: '2.0.0', total: words.length, words };
    const dist = (f) => {
      const m = new Map();
      for (const w of words) m.set(w[f], (m.get(w[f]) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([x, c]) => `${x}:${c}`).join(' ');
    };
    stats[key] = { total: n, noEc: diag.noEc, noZh: diag.noZh, fallback: diag.fallback, conflictWords, priority: dist('priority'), frequency: dist('frequency'), pos: dist('pos'), topic: dist('topic') };
  }
  return { result, stats };
}

const { result, stats } = build();

for (const { key, level } of LEVELS) {
  const s = stats[key];
  console.log(`\n=== ${level} (${key}.json) total=${s.total} 未命中ECDICT=${s.noEc} 释义仍需兜底=${s.noZh} 易混标注词=${s.conflictWords} ===`);
  console.log(' priority :', s.priority);
  console.log(' frequency:', s.frequency);
  console.log(' pos      :', s.pos);
  console.log(' topic    :', s.topic);
  if (s.fallback.length) console.log(' !! 缺中文释义:', s.fallback.join(' '));
}

console.log('\n=== 释义抽样 ===');
for (const { key } of LEVELS) {
  const ws = result[key].words;
  const step = Math.max(1, Math.floor(ws.length / 8));
  console.log(key, ws.filter((_, i) => i % step === 0).slice(0, 8).map((w) => `${w.lemma}(${w.pos})=${w.translation}`).join('  '));
}

if (WRITE) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const { key } of LEVELS) {
    const p = path.join(OUT_DIR, `${key}.json`);
    fs.writeFileSync(p, JSON.stringify(result[key], null, 2) + '\n', 'utf8');
    console.log(`written ${p} (${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
  }
} else {
  fs.writeFileSync(path.join(SRC, 'joined-preview.json'), JSON.stringify(result, null, 1), 'utf8');
  console.log(`\n[dry-run] 预览已写入 ${path.join(SRC, 'joined-preview.json')} (加 --write 生成正式文件)`);
}
