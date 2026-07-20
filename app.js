/* ============================================================
   格安退職便ヤメレター — 退職届の作成・郵送代行アプリ
   依頼者：フォーム入力＋電子署名 → 受付番号発行 → 銀行振込 → 追跡
   運営者：⚙️からログイン → 管理タブで入金確認・印刷・発送
   ============================================================ */
'use strict';

const CFG = window.TAISHOKU_CONFIG || {};
const DRAFT_KEY = 'taishoku_draft_v1';
const CHECKS_KEY = 'taishoku_checks_v1';

/* ブラウザが自動表示する「ホーム画面に追加」促進を抑制（インストールなしでも普通に使えるため） */
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); });

/* ---------- 日付ユーティリティ ---------- */
function toYmd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return toYmd(x); }
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}
function warekiYear(y) { return y - 2018; } // 令和のみ対応

/* 漢数字変換（1〜99、年月日用） */
function toKanji(n) {
  const digits = '〇一二三四五六七八九';
  if (n <= 10) return n === 10 ? '十' : digits[n];
  if (n < 20) return '十' + digits[n % 10];
  const t = Math.floor(n / 10), o = n % 10;
  return digits[t] + '十' + (o ? digits[o] : '');
}
function yearKanji(y) {
  const digits = '〇一二三四五六七八九';
  return String(y).split('').map(c => digits[+c]).join('');
}
function fmtDateH(ymd, era) {
  const d = parseYmd(ymd); if (!d) return '';
  if (era === 'wareki') {
    const wy = warekiYear(d.y);
    return `令和${wy === 1 ? '元' : wy}年${d.mo}月${d.d}日`;
  }
  return `${d.y}年${d.mo}月${d.d}日`;
}
function fmtDateV(ymd, era) {
  const d = parseYmd(ymd); if (!d) return '';
  if (era === 'wareki') {
    const wy = warekiYear(d.y);
    return `令和${wy === 1 ? '元' : toKanji(wy)}年${toKanji(d.mo)}月${toKanji(d.d)}日`;
  }
  return `${yearKanji(d.y)}年${toKanji(d.mo)}月${toKanji(d.d)}日`;
}

/* ---------- 汎用 ---------- */
const $ = sel => document.querySelector(sel);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}
function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

/* ---------- モーダル ---------- */
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBackdrop').hidden = false;
}
function closeModal() { $('#modalBackdrop').hidden = true; $('#modal').innerHTML = ''; }
document.addEventListener('DOMContentLoaded', () => {
  $('#modalBackdrop').addEventListener('click', e => { if (e.target === $('#modalBackdrop')) closeModal(); });
});

/* ---------- 下書き（依頼フォーム） ---------- */
const defaultDraft = () => ({
  docType: 'todoke', eraMode: 'wareki',
  empType: 'mukei',          // 雇用形態：mukei=無期雇用 / yuki=有期雇用
  name: '', dept: '', myPostal: '', myAddr: '',
  company: '', companyPostal: '', companyAddr: '',
  presTitle: '代表取締役', presName: '', envDept: '人事部',
  taishokuDate: addDays(new Date(), 21),
  submitDate: toYmd(new Date()),
  shipDate: '',              // 発送希望日（空欄＝入金確認後すみやかに発送）
  email: '', tel: '',
  shibutsu: 'none',          // 私物の扱い（添え状に記載）
  yukyuUse: false, yukyuFrom: '',  // 有給消化の申し出（添え状に記載）
});
let D = loadDraft();
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return Object.assign(defaultDraft(), JSON.parse(raw));
  } catch (e) { /* 破損時は初期化 */ }
  return defaultDraft();
}
function saveDraft() { localStorage.setItem(DRAFT_KEY, JSON.stringify(D)); }

let CHK = {};
try { CHK = JSON.parse(localStorage.getItem(CHECKS_KEY) || '{}'); } catch (e) { CHK = {}; }
function saveChk() { localStorage.setItem(CHECKS_KEY, JSON.stringify(CHK)); }

/* ---------- クラウド状態 ---------- */
let cloudReady = false;

/* ============================================================
   文面の組み立て（d = 注文の payload または下書き）
   ============================================================ */
function letterHtml(d) {
  const isTodoke = d.docType === 'todoke';
  const title = isTodoke ? '退職届' : '退職願';
  const tail = isTodoke
    ? 'をもって退職いたします。'
    : 'をもって退職いたしたく、ここにお願い申し上げます。';
  const dept = d.dept ? esc(d.dept) + '　' : '';
  const sig = d.sig ? `<img class="p-sigimg" src="${d.sig}" alt="署名">` : '';
  return `
    <div class="p-title">${title}</div>
    <div class="p-gigi">私儀、</div>
    <div class="p-body">このたび一身上の都合により、来る${fmtDateV(d.taishokuDate, d.eraMode)}${tail}</div>
    <div class="p-date">${fmtDateV(d.submitDate, d.eraMode)}</div>
    <div class="p-signer">${dept}${esc(d.name)}${sig}</div>
    <div class="p-to">${esc(d.company)}<br>${esc(d.presTitle)}　${esc(d.presName)}　殿</div>
  `;
}

/* 私物の扱い（添え状の文面と管理画面での表示ラベル） */
const SHIBUTSU = {
  none: { label: '記載なし', line: '' },
  mail: { label: '自宅へ郵送依頼（着払い）',
    line: '社内に残しております私物につきましては、お手数ですが上記自宅住所まで着払いにてご郵送くださいますようお願い申し上げます。' },
  discard: { label: '廃棄を依頼',
    line: '社内に残しております私物につきましては、誠に恐縮ですが廃棄していただいて構いません。' },
  mailOrDiscard: { label: '郵送依頼（難しいものは廃棄可）',
    line: '社内に残しております私物につきましては、お手数ですが上記自宅住所まで着払いにてご郵送ください。ご郵送が難しいものにつきましては、廃棄していただいて構いません。' },
};
function yukyuLine(d) {
  return (d.yukyuUse && d.yukyuFrom)
    ? `なお、${fmtDateH(d.yukyuFrom, d.eraMode)}から退職日までの間は、年次有給休暇を取得いたします。`
    : '';
}
function shibutsuLine(d) {
  return (SHIBUTSU[d.shibutsu] || SHIBUTSU.none).line;
}

function coverHtml(d) {
  const title = d.docType === 'todoke' ? '退職届' : '退職願';
  const to = d.envDept
    ? `${esc(d.company)}<br>${esc(d.envDept)}　御中`
    : `${esc(d.company)}<br>${esc(d.presTitle)}　${esc(d.presName)}　様`;
  return `
    <div class="c-date">${fmtDateH(d.submitDate, d.eraMode)}</div>
    <div class="c-to">${to}</div>
    <div class="c-from">${d.myPostal ? '〒' + esc(d.myPostal) + '<br>' : ''}${esc(d.myAddr)}<br>${d.dept ? esc(d.dept) + '　' : ''}${esc(d.name)}</div>
    <h1>${title}の送付につきまして</h1>
    <div class="c-body">拝啓　貴社ますますご清栄のこととお慶び申し上げます。<br>
    このたび、一身上の都合により${fmtDateH(d.taishokuDate, d.eraMode)}をもちまして退職いたしたく、同封のとおり${title}を提出いたします。<br>
    ${yukyuLine(d) ? yukyuLine(d) + '<br>' : ''}
    つきましては、離職票・雇用保険被保険者証・源泉徴収票等の退職関係書類は、上記の自宅住所までご郵送くださいますようお願い申し上げます。<br>
    ${shibutsuLine(d) ? shibutsuLine(d) + '<br>' : ''}
    在職中は大変お世話になり、誠にありがとうございました。ご査収のほど、よろしくお願い申し上げます。</div>
    <div style="text-align:right; margin-top:1em;">敬具</div>
    <div class="c-ki">記</div>
    <div class="c-items">・${title}　一通</div>
    <div class="c-ijo">以上</div>
  `;
}

function envFrontHtml(d) {
  const title = d.docType === 'todoke' ? '退職届' : '退職願';
  const to = d.envDept
    ? `${esc(d.company)}<br>${esc(d.envDept)}　御中`
    : `${esc(d.company)}<br>${esc(d.presTitle)}　${esc(d.presName)}　様`;
  return `
    <div class="e-addr">${d.companyPostal ? '〒' + esc(d.companyPostal) + '<br>' : ''}${esc(d.companyAddr) || '（会社住所）'}</div>
    <div class="e-name">${to}</div>
    <div class="e-naka">${title}在中</div>
  `;
}
function envBackHtml(d) {
  return `
    <div class="e-back-from">${d.myPostal ? '〒' + esc(d.myPostal) + '<br>' : ''}${esc(d.myAddr) || '（依頼者住所）'}<br>${esc(d.name) || '（氏名）'}</div>
  `;
}

/* ---------- 印刷（運営者用） ---------- */
function printDoc(kind, d) {
  const area = $('#printArea');
  if (kind === 'letter') {
    area.innerHTML = `<div class="pr-letter">${letterHtml(d)}</div>`;
  } else if (kind === 'cover') {
    area.innerHTML = `<div class="pr-cover">${coverHtml(d)}</div>`;
  } else if (kind === 'env') {
    area.innerHTML = `
      <div class="pr-env">
        <h2>封筒の書き方見本（長形3号・縦書き）</h2>
        <h2 style="margin-top:6mm">【表面】</h2>
        <div class="env">${envFrontHtml(d)}</div>
        <h2>【裏面】左下に差出人住所・氏名、フタに「〆」</h2>
        <div class="env">${envBackHtml(d)}</div>
      </div>`;
  }
  window.print();
}

/* ---------- Word形式（.docx）ダウンロード ----------
   JSZipで本物の.docxを生成する。退職届はセクションの縦書き設定
   （w:textDirection tbRl）を埋め込むため、Wordで確実に縦書きで開く。
   署名画像は含まれないため、Word版から印刷する場合は押印が必要。 */
let jszipLoading = null;
function ensureJSZip() {
  if (window.JSZip) return Promise.resolve();
  if (!jszipLoading) {
    jszipLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => { jszipLoading = null; reject(new Error('部品の読み込みに失敗しました。通信環境を確認してください')); };
      document.head.appendChild(s);
    });
  }
  return jszipLoading;
}

function xesc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/* Word段落を1つ組み立てる。opts: jc(配置) sz(半ポイント) charSpacing b(太字)
   color firstLine(字下げtwip) line(行間) — 縦書きでは jc:right が「下寄せ」になる */
function wPara(text, opts = {}) {
  const rpr = `<w:rPr><w:rFonts w:ascii="Yu Mincho" w:eastAsia="游明朝" w:hAnsi="Yu Mincho"/>`
    + `<w:sz w:val="${opts.sz || 26}"/><w:szCs w:val="${opts.sz || 26}"/>`
    + (opts.b ? '<w:b/>' : '')
    + (opts.color ? `<w:color w:val="${opts.color}"/>` : '')
    + (opts.charSpacing ? `<w:spacing w:val="${opts.charSpacing}"/>` : '')
    + `</w:rPr>`;
  const ppr = `<w:pPr><w:spacing w:line="${opts.line || 400}" w:lineRule="auto"/>`
    + (opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '')
    + (opts.firstLine ? `<w:ind w:firstLine="${opts.firstLine}"/>` : '')
    + rpr + `</w:pPr>`;
  const runs = String(text).split('\n').map((line, i) =>
    `${i ? `<w:r>${rpr}<w:br/></w:r>` : ''}<w:r>${rpr}<w:t xml:space="preserve">${xesc(line)}</w:t></w:r>`
  ).join('');
  return `<w:p>${ppr}${runs}</w:p>`;
}

async function wordDoc(kind, d, orderNo) {
  try { await ensureJSZip(); } catch (e) { toast(e.message); return; }

  const title = d.docType === 'todoke' ? '退職届' : '退職願';
  let paras = [], vertical = false, docName = '';

  if (kind === 'letter') {
    vertical = true;
    docName = title;
    const tail = d.docType === 'todoke'
      ? 'をもって退職いたします。'
      : 'をもって退職いたしたく、ここにお願い申し上げます。';
    const dept = d.dept ? d.dept + '　' : '';
    paras = [
      wPara(title, { sz: 44, jc: 'center', charSpacing: 300 }),
      wPara(''),
      wPara('私儀、', { jc: 'right' }),
      wPara(`このたび一身上の都合により、来る${fmtDateV(d.taishokuDate, d.eraMode)}${tail}`, { firstLine: 280 }),
      wPara(''),
      wPara(fmtDateV(d.submitDate, d.eraMode)),
      wPara(`${dept}${d.name}　㊞`, { jc: 'right' }),
      wPara(''),
      wPara(`${d.company}\n${d.presTitle}　${d.presName}　殿`, { sz: 28 }),
      wPara(''),
      wPara('※この行は削除してください：アプリからの印刷では手書き署名が自動で入ります。Word版から印刷する場合は㊞の位置に押印してください。', { sz: 16, color: '888888' }),
    ];
  } else {
    docName = '添え状';
    const to = d.envDept
      ? `${d.company}\n${d.envDept}　御中`
      : `${d.company}\n${d.presTitle}　${d.presName}　様`;
    paras = [
      wPara(fmtDateH(d.submitDate, d.eraMode), { jc: 'right' }),
      wPara(to),
      wPara(`${d.myPostal ? '〒' + d.myPostal + '\n' : ''}${d.myAddr}\n${d.dept ? d.dept + '　' : ''}${d.name}`, { jc: 'right' }),
      wPara(''),
      wPara(`${title}の送付につきまして`, { sz: 30, jc: 'center', charSpacing: 100 }),
      wPara(''),
      wPara('拝啓　貴社ますますご清栄のこととお慶び申し上げます。', { firstLine: 240 }),
      wPara(`このたび、一身上の都合により${fmtDateH(d.taishokuDate, d.eraMode)}をもちまして退職いたしたく、同封のとおり${title}を提出いたします。`, { firstLine: 240 }),
      ...(yukyuLine(d) ? [wPara(yukyuLine(d), { firstLine: 240 })] : []),
      wPara('つきましては、離職票・雇用保険被保険者証・源泉徴収票等の退職関係書類は、上記の自宅住所までご郵送くださいますようお願い申し上げます。', { firstLine: 240 }),
      ...(shibutsuLine(d) ? [wPara(shibutsuLine(d), { firstLine: 240 })] : []),
      wPara('在職中は大変お世話になり、誠にありがとうございました。ご査収のほど、よろしくお願い申し上げます。', { firstLine: 240 }),
      wPara('敬具', { jc: 'right' }),
      wPara(''),
      wPara('記', { jc: 'center', b: true }),
      wPara(`・${title}　一通`, { jc: 'center' }),
      wPara('以上', { jc: 'right' }),
    ];
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paras.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1417" w:bottom="1701" w:left="1417" w:header="851" w:footer="992" w:gutter="0"/>${vertical ? '<w:textDirection w:val="tbRl"/>' : ''}</w:sectPr>
</w:body></w:document>`;

  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', documentXml);

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${docName}_${orderNo || ''}_${d.name || ''}.docx`.replace(/\s+/g, '');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- 振込案内ブロック ---------- */
function bankHtml(orderNo) {
  const b = CFG.bank || {};
  const hasBank = b.bankName && b.accountNo;
  const rows = hasBank ? `
    <table class="bank-table">
      <tr><th>銀行</th><td>${esc(b.bankName)}</td></tr>
      <tr><th>支店</th><td>${esc(b.branch)}</td></tr>
      <tr><th>口座</th><td>${esc(b.accountType)}　${esc(b.accountNo)}</td></tr>
      <tr><th>名義</th><td>${esc(b.holder) || '（確認中 — 振込画面に表示される名義をご確認ください）'}</td></tr>
      <tr><th>金額</th><td><strong>${yen(CFG.price)}</strong>（振込手数料はご負担ください）</td></tr>
    </table>` : `
    <p class="small">振込先口座は現在準備中です。準備が整い次第、<a href="mailto:${esc(CFG.contactEmail)}">${esc(CFG.contactEmail)}</a> からご連絡します。受付番号を控えてお待ちください。</p>`;
  return `
    <div class="bank-box">
      <h3>💴 お振込のご案内</h3>
      ${rows}
      <p class="small"><strong>振込名義の先頭に受付番号</strong>を付けてください。<br>例：「<strong>${esc(orderNo)} ヤマダタロウ</strong>」</p>
      <p class="small muted">ご入金の確認をもって作成・発送作業を開始します。発送前であればキャンセルできます（追跡タブから）。</p>
    </div>`;
}

/* ---------- ステータス表示 ---------- */
const STATUS = {
  awaiting_payment: { label: '入金待ち', badge: 'badge-amber' },
  paid:             { label: '発送準備中（入金確認済み）', badge: 'badge-blue' },
  shipped:          { label: '発送済み', badge: 'badge-green' },
  done:             { label: '完了', badge: 'badge-gray' },
  cancelled:        { label: 'キャンセル', badge: 'badge-gray' },
};

/* ============================================================
   各画面
   ============================================================ */
const view = () => $('#view');

/* ---------- ホーム ---------- */
function renderHome() {
  view().innerHTML = `
    <div class="hero">
      <span class="hero-badge">全国対応・郵送で完結</span>
      <h2>言いにくいことは、<br>手紙にしよう。</h2>
      <p>正式な退職届をお作りして、あなたに代わって<strong>${esc(CFG.shipMethod)}で会社へ郵送</strong>します。手渡しも、対面も、電話も、もういらない。</p>
    </div>

    <div class="hero-price">
      <div class="hp-label">安心の定額プラン</div>
      <div class="hp-row">
        <span class="hp-amount">${yen(CFG.price)}</span>
        <span class="hp-note">（税込・追加費用なし）</span>
      </div>
      <div class="hp-sub">退職届の作成＋印刷＋封入＋${esc(CFG.shipMethod)}での発送まで全部込み</div>
    </div>

    <button class="btn btn-primary" data-go="order" style="margin-bottom:16px;">いますぐ依頼する</button>

    <div class="section-title">ご利用の流れ</div>
    <div class="card flow-card">
      <div class="flow-row"><span class="f-num">1</span><span>フォームに入力して、署名する</span></div>
      <div class="flow-row"><span class="f-num">2</span><span>銀行振込でお支払い</span></div>
      <div class="flow-row"><span class="f-num">3</span><span>こちらが印刷して会社へ郵送<small>追跡番号で配達を見届けられます</small></span></div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>法律上は2週間前でOK</h3>
      <p class="small">期間の定めのない雇用（正社員など）は、退職の意思表示が会社に<strong>到達してから2週間</strong>で退職できます（民法627条）。会社の承認は不要です。郵送日数を考えて、退職日は<strong>3週間以上先</strong>をおすすめします。</p>
    </div>

    <div class="card">
      <h3>本サービスがやらないこと</h3>
      <p class="small">会社との<strong>交渉・連絡・伝言は一切行いません</strong>（弁護士法により、弁護士以外は交渉できません）。本サービスは退職届の作成と郵送の<strong>事務代行のみ</strong>です。未払い賃金やハラスメント等の争いがある方は、弁護士・労働組合・労働基準監督署にご相談ください。</p>
      <p class="small">また、郵便のお届けには<strong>1〜3日</strong>かかります。<strong>「今すぐ・即日で会社に伝えたい」方には、お電話で連絡する退職代行サービスのほうが向いています。</strong>数日以上先の退職日で計画的に辞める方には、当サービスで十分です。</p>
    </div>

    <p class="small center">
      <a href="terms.html" target="_blank">利用規約</a> ・
      <a href="tokushoho.html" target="_blank">特定商取引法に基づく表記</a> ・
      <a href="privacy.html" target="_blank">プライバシーポリシー</a>
    </p>
  `;
}

/* ---------- 依頼フォーム ---------- */
let signCtx = null, signing = false, signed = false;

function renderOrder() {
  const f = (key, label, ph, req, hint, type = 'text') => `
    <div class="field">
      <label>${label}${req ? '<span class="req">必須</span>' : ''}</label>
      <input type="${type}" data-key="${key}" value="${esc(D[key])}" placeholder="${esc(ph)}">
      ${hint ? `<div class="hint">${hint}</div>` : ''}
    </div>`;

  view().innerHTML = `
    <div class="section-title">📝 退職届の郵送を依頼する</div>

    <div class="seg" id="docTypeSeg">
      <button data-doctype="todoke" class="${D.docType === 'todoke' ? 'on' : ''}">退職届（決定を通知）</button>
      <button data-doctype="negai" class="${D.docType === 'negai' ? 'on' : ''}">退職願（お伺い）</button>
    </div>
    <p class="small muted" style="margin-top:-6px;">確実に辞めたいなら<strong>退職届</strong>がおすすめです。</p>

    <div class="card">
      <h3>あなたの情報</h3>
      <div class="field">
        <label>雇用形態<span class="req">必須</span></label>
        <select data-key="empType">
          <option value="mukei" ${D.empType !== 'yuki' ? 'selected' : ''}>無期雇用（正社員・無期パートなど、契約期間の定めなし）</option>
          <option value="yuki" ${D.empType === 'yuki' ? 'selected' : ''}>有期雇用（契約社員・派遣・有期パートなど、契約期間の定めあり）</option>
        </select>
        ${D.empType === 'yuki'
          ? `<div class="hint" style="color:var(--red);">⚠️ 契約期間の定めがある場合、「到達から2週間で退職成立」（民法627条）は<strong>適用されません</strong>。原則として ①契約期間の満了 ②やむを得ない事由（民法628条） ③最初の契約から通算1年経過（労働基準法附則137条） ④会社との合意 のいずれかが必要です。判断に迷う場合は「退職願（お伺い）」でのご依頼をおすすめします。</div>`
          : `<div class="hint">契約社員・派遣・有期パートの方は「有期雇用」を選択してください。退職のルールが異なります</div>`}
      </div>
      ${f('name', '氏名', '山田 太郎', true)}
      ${f('dept', '所属部署', '営業部（なければ空欄でOK）', false)}
      ${f('myPostal', '自宅の郵便番号', '123-4567', true)}
      ${f('myAddr', '自宅の住所', '東京都◯◯区…（封筒の差出人になります）', true)}
      ${f('email', '連絡用メールアドレス', 'you@example.com', true, '受付・発送のご連絡に使います')}
      ${f('tel', '電話番号', '090-1234-5678（任意）', false)}
    </div>

    <div class="card">
      <h3>会社の情報</h3>
      ${f('company', '会社名（正式名称）', '株式会社◯◯', true)}
      ${f('presTitle', '代表者の役職', '代表取締役', false)}
      ${f('presName', '代表者の氏名', '鈴木 一郎', true, '退職届の宛名は社長宛が正式。会社HPで確認できます')}
      ${f('companyPostal', '会社の郵便番号', '123-4567', true)}
      ${f('companyAddr', '会社の住所', '本社の住所（郵送先になります）', true)}
      ${f('envDept', '封筒の宛先部署', '人事部', false, '空欄にすると封筒も社長宛になります')}
    </div>

    <div class="card">
      <h3>日付</h3>
      <div class="row2">
        ${f('taishokuDate', '退職日', '', true, '', 'date')}
        ${f('submitDate', '書類の日付', '', true, '', 'date')}
      </div>
      <p class="small muted">郵送の到達から2週間で退職できます（民法627条・<strong>無期雇用の場合</strong>）。余裕をもって<strong>3週間以上先</strong>の退職日をおすすめします。書類の日付は通常、依頼日のままでOKです。</p>
      ${f('shipDate', '発送希望日（任意）', '', false, '空欄なら入金確認後、原則3営業日以内に発送します。指定する場合は、先に入金確認が必要なこと・配達に1〜3日かかることを見込んでください。到着日のお約束はできません', 'date')}
      <div class="seg" id="eraSeg">
        <button data-era="wareki" class="${D.eraMode === 'wareki' ? 'on' : ''}">和暦（令和）</button>
        <button data-era="seireki" class="${D.eraMode === 'seireki' ? 'on' : ''}">西暦</button>
      </div>
    </div>

    <div class="card">
      <h3>オプション（添え状に書き添えます）</h3>
      <div class="field">
        <label>会社に残っている私物の扱い</label>
        <select data-key="shibutsu">
          <option value="none" ${D.shibutsu === 'none' ? 'selected' : ''}>記載しない（私物はない・自分で対応する）</option>
          <option value="mail" ${D.shibutsu === 'mail' ? 'selected' : ''}>自宅へ郵送を依頼する（着払い）</option>
          <option value="discard" ${D.shibutsu === 'discard' ? 'selected' : ''}>廃棄を依頼する</option>
          <option value="mailOrDiscard" ${D.shibutsu === 'mailOrDiscard' ? 'selected' : ''}>郵送を依頼し、難しいものは廃棄でOKとする</option>
        </select>
        <div class="hint">※郵送・廃棄はあくまで会社への「お願い」です。会社に応じる法的義務まではないため、対応されない場合はご自身で受け取り方法を会社と調整いただくことになります。</div>
      </div>
      <label class="chk chk-plain">
        <input type="checkbox" id="yukyuUse" ${D.yukyuUse ? 'checked' : ''}>
        <span class="c-body">残っている有給休暇の取得を申し出る<small>退職日まで出社したくない場合に。有給は労働者の権利で、会社の許可は不要です（残日数を超えた分は欠勤扱いになることがあります）</small></span>
      </label>
      <div class="field" id="yukyuFromWrap" ${D.yukyuUse ? '' : 'hidden'}>
        <label>有給の開始日</label>
        <input type="date" data-key="yukyuFrom" value="${esc(D.yukyuFrom)}">
        <div class="hint">「この日から退職日までは年次有給休暇を取得します」と添え状に記載します</div>
      </div>
    </div>

    <div class="section-title">👀 仕上がりプレビュー</div>
    <div class="preview-wrap"><div class="paper" id="paperPreview"></div></div>
    <p class="small muted">署名はこの下で。押印の代わりに、あなたの手書き署名を退職届に印刷します。</p>

    <div class="card">
      <h3>✍️ 署名</h3>
      <div class="sign-wrap">
        <canvas id="signPad"></canvas>
        <div class="sign-hint" id="signHint">ここに指でフルネームをサインしてください</div>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" id="clearSign">書き直す</button>
      </div>
    </div>

    <div class="card">
      <h3>確認事項</h3>
      <label class="chk chk-plain"><input type="checkbox" id="ag1"><span class="c-body"><a href="terms.html" target="_blank">利用規約</a>・<a href="tokushoho.html" target="_blank">特定商取引法に基づく表記</a>に同意します</span></label>
      <label class="chk chk-plain"><input type="checkbox" id="ag2"><span class="c-body"><a href="privacy.html" target="_blank">プライバシーポリシー</a>に同意します</span></label>
      <label class="chk chk-plain"><input type="checkbox" id="ag3"><span class="c-body">本サービスは退職届の作成・郵送の事務代行のみで、会社との交渉・連絡は行わないことを理解しました</span></label>
    </div>

    <button class="btn btn-primary" id="btnSubmit">📮 依頼を確定する（${yen(CFG.price)}・銀行振込）</button>
    <p class="small muted center" style="margin-top:8px;">確定後に受付番号と振込先をご案内します。入金確認後に作業を開始します。</p>
    <div id="orderResult"></div>
  `;

  const updatePreview = () => { $('#paperPreview').innerHTML = letterHtml(D); };
  updatePreview();

  view().querySelectorAll('input[data-key], select[data-key]').forEach(inp => {
    const handler = () => {
      D[inp.dataset.key] = inp.value.trim();
      saveDraft(); updatePreview();
    };
    inp.addEventListener('input', handler);
    inp.addEventListener('change', handler);
  });
  // 雇用形態は切替時に注意書きを出し分けるため再描画
  view().querySelector('select[data-key="empType"]').addEventListener('change', () => renderOrder());
  $('#yukyuUse').addEventListener('change', () => {
    D.yukyuUse = $('#yukyuUse').checked;
    if (D.yukyuUse && !D.yukyuFrom) D.yukyuFrom = addDays(new Date(), 3);
    saveDraft(); renderOrder();
  });
  $('#docTypeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-doctype]'); if (!b) return;
    D.docType = b.dataset.doctype; saveDraft(); renderOrder();
  });
  $('#eraSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-era]'); if (!b) return;
    D.eraMode = b.dataset.era; saveDraft(); renderOrder();
  });
  setupSignPad();
  $('#clearSign').addEventListener('click', clearSign);
  $('#btnSubmit').addEventListener('click', submitOrder);
}

function setupSignPad() {
  const cv = $('#signPad');
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = rect.width * dpr; cv.height = 180 * dpr;
  signCtx = cv.getContext('2d');
  signCtx.scale(dpr, dpr);
  signCtx.lineWidth = 2.5; signCtx.lineCap = 'round'; signCtx.strokeStyle = '#111';
  signed = false; signing = false;

  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const start = (e) => { e.preventDefault(); signing = true; signed = true; $('#signHint').style.display = 'none';
    const { x, y } = pos(e); signCtx.beginPath(); signCtx.moveTo(x, y); };
  const move = (e) => { if (!signing) return; e.preventDefault(); const { x, y } = pos(e); signCtx.lineTo(x, y); signCtx.stroke(); };
  const end = () => { signing = false; };

  cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end);
}
function clearSign() {
  if (!signCtx) return;
  const cv = $('#signPad');
  signCtx.clearRect(0, 0, cv.width, cv.height);
  signed = false; $('#signHint').style.display = 'flex';
}
/* 署名を時計回りに90度回転して保存（縦書きの退職届に載せるため） */
function rotatedSigDataUrl() {
  const cv = $('#signPad');
  const out = document.createElement('canvas');
  out.width = cv.height; out.height = cv.width;
  const ctx = out.getContext('2d');
  ctx.translate(out.width, 0); ctx.rotate(Math.PI / 2);
  ctx.drawImage(cv, 0, 0);
  return out.toDataURL('image/png');
}

async function submitOrder() {
  const required = [
    ['name', '氏名'], ['myPostal', '自宅の郵便番号'], ['myAddr', '自宅の住所'], ['email', 'メールアドレス'],
    ['company', '会社名'], ['presName', '代表者の氏名'], ['companyPostal', '会社の郵便番号'], ['companyAddr', '会社の住所'],
    ['taishokuDate', '退職日'], ['submitDate', '書類の日付'],
  ];
  for (const [key, label] of required) {
    if (!D[key]) { toast(`「${label}」を入力してください`); return; }
  }
  if (D.yukyuUse && !D.yukyuFrom) { toast('有給の開始日を入力してください'); return; }
  if (D.shipDate) {
    if (D.shipDate < toYmd(new Date())) { toast('発送希望日は今日以降の日付にしてください'); return; }
    // 発送→配達1〜3日→到達から2週間で退職成立（民法627条）の余裕チェック
    if (D.shipDate > addDays(new Date(D.taishokuDate), -16) &&
        !confirm('発送希望日から退職日までの余裕が少なめです。\n配達（発送から1〜3日）の到達後2週間で退職が成立するため、退職日までに2週間を確保できない可能性があります。\nこのまま確定しますか？')) return;
  }
  if (D.empType === 'yuki' &&
      !confirm('雇用形態が「有期雇用（契約期間の定めあり）」になっています。\n有期雇用では「到達から2週間で退職成立」（民法627条）は適用されず、契約期間途中の退職には、やむを得ない事由（民法628条）・最初の契約から1年経過（労基法附則137条）・会社との合意などが必要です。\n内容を理解した上で、このまま依頼を確定しますか？')) return;
  if (!signed) { toast('署名を入力してください'); return; }
  if (!($('#ag1').checked && $('#ag2').checked && $('#ag3').checked)) {
    toast('確認事項3つすべてにチェックしてください'); return;
  }
  if (!cloudReady) { toast('サーバーに接続できません。通信環境を確認して再読み込みしてください'); return; }

  const btn = $('#btnSubmit');
  btn.disabled = true; btn.textContent = '送信中…';
  try {
    const payload = Object.assign({}, D, {
      sig: rotatedSigDataUrl(),
      price: CFG.price,
      shipMethod: CFG.shipMethod,
    });
    const row = await Cloud.createOrder(payload);
    D = defaultDraft(); saveDraft(); // 二重送信防止のため下書きはクリア
    view().innerHTML = `
      <div class="card center" style="margin-top:24px;">
        <p style="font-size:44px;margin:0;">🎫</p>
        <h3 style="font-size:17px;">依頼を受け付けました</h3>
        <p class="muted small" style="margin:0;">受付番号</p>
        <p style="font-size:36px;font-weight:800;color:var(--blue);margin:2px 0 8px;letter-spacing:.05em;">${esc(row.order_no)}</p>
        <p class="small">この番号は<strong>追跡タブ</strong>からいつでも確認できます。</p>
        <p class="small muted">ご入力のメールアドレスに受付確認メールをお送りしました。届いていない場合は<strong>迷惑メールフォルダ</strong>をご確認ください。</p>
      </div>
      ${bankHtml(row.order_no)}
      <button class="btn btn-primary" data-go="track">📦 追跡タブへ</button>
    `;
    window.scrollTo(0, 0);
  } catch (e) {
    toast('送信に失敗しました：' + e.message);
    btn.disabled = false; btn.textContent = `📮 依頼を確定する（${yen(CFG.price)}・銀行振込）`;
  }
}

/* ---------- 追跡 ---------- */
async function renderTrack() {
  view().innerHTML = `<div class="section-title">📦 依頼の追跡</div><p class="muted small center">読み込み中…</p>`;
  if (!cloudReady) {
    view().innerHTML = `<div class="section-title">📦 依頼の追跡</div>
      <div class="empty"><div class="e-ico">📡</div><p>サーバーに接続できません。<br>通信環境を確認して再読み込みしてください。</p></div>`;
    return;
  }
  let orders = [];
  try { orders = await Cloud.myOrders(); }
  catch (e) { toast('読み込みに失敗しました：' + e.message); }

  if (!orders.length) {
    view().innerHTML = `<div class="section-title">📦 依頼の追跡</div>
      <div class="empty"><div class="e-ico">📭</div><p>まだ依頼がありません。<br>「依頼」タブからどうぞ。</p></div>
      <button class="btn btn-primary" data-go="order">📝 依頼する</button>`;
    return;
  }

  view().innerHTML = `
    <div class="section-title">📦 依頼の追跡</div>
    ${orders.map(o => {
      const st = STATUS[o.status] || { label: o.status, badge: 'badge-gray' };
      const p = o.payload || {};
      return `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="item-title">${esc(o.order_no)}</div>
            <div class="item-meta">${esc(p.company || '')}／退職日 ${fmtDateH(p.taishokuDate, 'wareki')}</div>
          </div>
          <span class="badge ${st.badge}">${st.label}</span>
        </div>
        ${p.shipDate && ['awaiting_payment', 'paid'].includes(o.status) ? `<div class="item-body small muted">📅 発送希望日：${fmtDateH(p.shipDate, 'wareki')}（入金確認後に発送します）</div>` : ''}
        ${o.status === 'shipped' && o.tracking_no ? `<div class="item-body">🚚 追跡番号：<strong>${esc(o.tracking_no)}</strong>（郵便局の追跡サービスで確認できます）</div>` : ''}
        ${o.status === 'shipped' ? `<div class="item-body small muted">${p.empType === 'yuki'
          ? '配達されると退職の意思表示は会社に到達済みです。有期雇用の場合、退職成立の時期は契約内容・お申し出の内容によります。'
          : '配達されると退職の意思表示は到達済み。到達から2週間で退職成立です（民法627条）。'}</div>` : ''}
        ${o.status === 'awaiting_payment' ? bankHtml(o.order_no) + `
          <button class="btn btn-ghost btn-sm" data-cancel="${o.id}">依頼をキャンセルする</button>` : ''}
        ${o.status === 'done' ? `<div class="item-body">🎉 おつかれさまでした。次のキャリアへ前向きに！</div>` : ''}
      </div>`;
    }).join('')}
  `;

  view().querySelectorAll('[data-cancel]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('この依頼をキャンセルしますか？')) return;
      try { await Cloud.cancelOrder(b.dataset.cancel); toast('キャンセルしました'); renderTrack(); }
      catch (e) { toast('キャンセルに失敗しました：' + e.message); }
    });
  });
}

/* ---------- 知識（Q&A＋チェックリスト） ---------- */
const CHECK_GROUPS = [
  {
    title: '📤 会社に返すもの（郵送でOK）',
    items: [
      { id: 'hoken', t: '健康保険証', s: '扶養家族の分も。退職日の翌日から使えません' },
      { id: 'shain', t: '社員証・入館カード・鍵', s: '' },
      { id: 'pc', t: '貸与PC・スマホ・備品', s: '' },
      { id: 'seifuku', t: '制服', s: 'クリーニングして返すのがマナー' },
      { id: 'meishi', t: '名刺', s: '自分の名刺と、取引先からもらった名刺' },
    ],
  },
  {
    title: '📥 会社から受け取るもの（添え状で郵送を依頼済み）',
    items: [
      { id: 'rishoku', t: '離職票（-1・-2）', s: '失業給付に必須。発行に10日前後かかる' },
      { id: 'koyou', t: '雇用保険被保険者証', s: '転職先に提出' },
      { id: 'gensen', t: '源泉徴収票', s: '年末調整・確定申告に必要' },
    ],
  },
  {
    title: '🏛️ 退職後の手続き',
    items: [
      { id: 'kokuho', t: '健康保険の切替', s: '国保（14日以内）or 任意継続（20日以内）or 家族の扶養' },
      { id: 'kokunen', t: '国民年金への切替', s: '市区町村の窓口で。14日以内' },
      { id: 'hello', t: '失業給付の申請', s: '離職票を持ってハローワークへ' },
      { id: 'juminzei', t: '住民税の支払い確認', s: '自分で納付に切り替わる' },
    ],
  },
];

function renderKnow() {
  const QA = [
    ['⚖️ 会社の許可がなくても辞められるの？', `<p>辞められます。期間の定めのない雇用（正社員など）は、<strong>退職の意思表示が到達してから2週間</strong>で雇用は終了します（民法627条1項）。会社の「承認」は法律上不要です。</p><p>だからこそ「届いた記録が残る郵送」が有効なのです。</p>`],
    ['📅 就業規則に「1ヶ月前に申し出ること」とあるけど？', `<p>就業規則より民法が優先するというのが一般的な理解です。2週間前の通知で退職自体は可能です。</p><p>円満退職を目指すなら、可能な範囲で就業規則に合わせるとトラブルが減ります。「通知→残りは有給消化」も定番です。</p>`],
    ['⚡ 今すぐ（即日）辞めたい場合は？', `<p>正直にお伝えすると、<strong>即日退職には当サービスは向いていません</strong>。郵便のお届けに1〜3日かかり、退職の意思表示はお手紙が会社に届いた時点で効力を持つためです。「今日連絡して明日から行かない」が必要な方は、お電話で連絡する退職代行サービスをご検討ください。</p><p>逆に、<strong>数日以上先の退職日で計画的に辞める方</strong>には、当サービスで十分です。到達が1〜2日前後しても退職日は変わりません。有給休暇が残っている方は、有給消化の申し出を添え状に記載することで、発送後の出社を実質なくすこともできます。</p>`],
    ['📄 「退職届」と「退職願」の違いは？', `<p><strong>退職届</strong>＝退職の決定を通知。原則撤回できません。確実に辞めたい人向け。</p><p><strong>退職願</strong>＝お願いベース。会社が承諾するまで撤回の余地あり。</p>`],
    ['📃 契約社員・派遣（有期雇用）でも使える？', `<p>ご利用いただけますが、ルールが異なります。契約期間の定めがある場合、「到達から2週間で退職成立」（民法627条）は<strong>適用されません</strong>。</p><p>原則として、①契約期間の満了 ②やむを得ない事由がある（民法628条。体調不良・家庭の事情など） ③最初の契約から通算1年を超えて働いている（労働基準法附則137条） ④会社との合意 のいずれかが必要です。</p><p>③に当てはまる方は申し出により退職できます。判断に迷う場合は<strong>退職願（お伺い）</strong>での提出をおすすめします。</p>`],
    ['🏖️ 残っている有給休暇は使える？', `<p>使えます。年次有給休暇は労働基準法39条で保障された権利で、会社の許可は不要です。退職日までの間に消化すれば、出社せずに退職日を迎えられます。</p>`],
    ['😨 「損害賠償を請求するぞ」と脅されたら？', `<p>退職自体を理由とする損害賠償が認められることはまずありません。労働基準法16条は「辞めたら違約金」のような取り決め自体を禁止しています。</p><p>続く場合は労働基準監督署・労働組合・弁護士へ。やり取りは記録を。</p>`],
    ['📪 会社が受け取りを拒否したら？', `<p>意思表示は配達された時点で到達＝効力が生じるとされ、受け取り拒否や「読んでいない」は通用しにくいです。${esc(CFG.shipMethod)}の配達記録がその証拠になります。</p>`],
    ['💬 会社から電話が来たら？', `<p>本サービスは交渉・連絡の代行はできません（弁護士法）。出る義務はありませんが、貸与物の返却や書類のやり取りなど事務的な連絡は、メールや郵送で対応するとスムーズです。</p><p>未払い賃金やハラスメントの争いは、弁護士・合同労組・労働基準監督署へ。</p>`],
    ['🎒 会社に残した私物はどうなる？', `<p>私物はあなたの所有物なので、会社が勝手に処分することはできません。ただし、<strong>会社に「郵送してあげる義務」まではない</strong>ため、添え状でのお願いに応じてもらえない場合もあります。</p><p>その場合は、受け取り方法（着払いでの郵送、家族や友人による代理受け取り、退職後に短時間だけ受け取りに行く等）をメールで会社と調整しましょう。</p><p>逆に、会社からの<strong>貸与物（PC・保険証・社員証等）はあなたに返却義務</strong>があります。郵送での返却でOKです。</p>`],
  ];
  const total = CHECK_GROUPS.reduce((a, g) => a + g.items.length, 0);
  const done = Object.values(CHK).filter(Boolean).length;

  view().innerHTML = `
    <div class="section-title">✅ 退職チェックリスト（${done}/${total}）</div>
    ${CHECK_GROUPS.map(g => `
      <div class="card">
        <h3>${g.title}</h3>
        ${g.items.map(it => `
          <label class="chk">
            <input type="checkbox" data-chk="${it.id}" ${CHK[it.id] ? 'checked' : ''}>
            <span class="c-body">${esc(it.t)}${it.s ? `<small>${esc(it.s)}</small>` : ''}</span>
          </label>`).join('')}
      </div>`).join('')}

    <div class="section-title" style="margin-top:20px;">📖 よくある質問</div>
    ${QA.map(([q, a]) => `<details class="qa"><summary>${q}</summary><div class="qa-body">${a}</div></details>`).join('')}
    <div class="card" style="margin-top:16px;">
      <p class="small muted">⚠️ 本アプリの情報は一般的な解説であり、法的助言ではありません。個別の紛争は弁護士・労働組合・労働基準監督署にご相談ください。</p>
    </div>
  `;

  view().querySelectorAll('input[data-chk]').forEach(cb => {
    cb.addEventListener('change', () => { CHK[cb.dataset.chk] = cb.checked; saveChk(); renderKnow(); });
  });
}

/* ---------- 管理（運営者のみ） ---------- */
let adminFilter = 'active';

async function renderAdmin() {
  if (!Cloud.isOperator()) { go('home'); return; }
  view().innerHTML = `<div class="section-title">🗂️ 注文管理</div><p class="muted small center">読み込み中…</p>`;
  let orders = [];
  try { orders = await Cloud.allOrders(); }
  catch (e) { toast('読み込みに失敗しました：' + e.message); }

  const filters = [
    ['active', '対応中'], ['awaiting_payment', '入金待ち'], ['paid', '発送準備'],
    ['shipped', '発送済み'], ['all', 'すべて'],
  ];
  const match = o =>
    adminFilter === 'all' ? true :
    adminFilter === 'active' ? ['awaiting_payment', 'paid', 'shipped'].includes(o.status) :
    o.status === adminFilter;
  const list = orders.filter(match);

  view().innerHTML = `
    <div class="section-title">🗂️ 注文管理
      <button class="btn btn-ghost btn-sm" id="btnOpLogout" style="margin-left:auto;">ログアウト</button>
    </div>
    <div class="chips">
      ${filters.map(([k, l]) => `<button class="chip ${adminFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </div>
    ${!list.length ? `<div class="empty"><div class="e-ico">📭</div><p>該当する注文はありません</p></div>` : ''}
    ${list.map(o => {
      const st = STATUS[o.status] || { label: o.status, badge: 'badge-gray' };
      const p = o.payload || {};
      return `
      <div class="item">
        <div class="item-head">
          <div>
            <div class="item-title">${esc(o.order_no)}　${esc(p.name || '')}</div>
            <div class="item-meta">${esc(p.company || '')}／退職日 ${fmtDateH(p.taishokuDate, 'wareki')}／受付 ${new Date(o.created_at).toLocaleDateString('ja-JP')}${p.shipDate ? '／📅 発送希望 ' + fmtDateH(p.shipDate, 'wareki') : ''}</div>
          </div>
          <span class="badge ${st.badge}">${st.label}</span>
        </div>
        <details style="margin-top:8px;">
          <summary class="small" style="cursor:pointer;color:var(--blue);">依頼内容の詳細</summary>
          <div class="item-body small">
            📧 ${esc(p.email || '—')}／📞 ${esc(p.tel || '—')}<br>
            差出人：〒${esc(p.myPostal || '')} ${esc(p.myAddr || '')}<br>
            宛先：〒${esc(p.companyPostal || '')} ${esc(p.companyAddr || '')}<br>
            宛名：${esc(p.company || '')} ${esc(p.envDept ? p.envDept + ' 御中' : (p.presTitle + ' ' + p.presName + ' 様'))}<br>
            書類：${p.docType === 'negai' ? '退職願' : '退職届'}／雇用形態 ${p.empType === 'yuki' ? '<strong style="color:var(--red);">有期雇用</strong>' : '無期雇用'}／書類日付 ${fmtDateH(p.submitDate, 'wareki')}／${yen(p.price)}<br>
            オプション：私物=${(SHIBUTSU[p.shibutsu] || SHIBUTSU.none).label}／有給=${p.yukyuUse && p.yukyuFrom ? fmtDateH(p.yukyuFrom, 'wareki') + 'から取得' : '記載なし'}<br>
            発送希望日：${p.shipDate ? fmtDateH(p.shipDate, 'wareki') : '指定なし（入金確認後すみやかに発送）'}
            ${p.sig ? `<div>署名：<img src="${p.sig}" alt="署名" style="max-height:140px;border:1px solid var(--line);border-radius:6px;background:#fff;"></div>` : ''}
          </div>
        </details>
        <div class="btn-row" style="flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-print="letter" data-id="${o.id}">🖨️ ${p.docType === 'negai' ? '退職願' : '退職届'}</button>
          <button class="btn btn-ghost btn-sm" data-print="cover" data-id="${o.id}">🖨️ 添え状</button>
          <button class="btn btn-ghost btn-sm" data-print="env" data-id="${o.id}">🖨️ 封筒</button>
          <button class="btn btn-ghost btn-sm" data-word="letter" data-id="${o.id}">📄 Word</button>
          <button class="btn btn-ghost btn-sm" data-word="cover" data-id="${o.id}">📄 添え状Word</button>
        </div>
        <div class="btn-row" style="flex-wrap:wrap;">
          ${o.status === 'awaiting_payment' ? `
            <button class="btn btn-primary btn-sm" data-act="paid" data-id="${o.id}">💴 入金を確認した</button>
            <button class="btn btn-ghost btn-sm" data-act="cancelled" data-id="${o.id}">キャンセル</button>` : ''}
          ${o.status === 'paid' ? `
            <button class="btn btn-primary btn-sm" data-act="shipped" data-id="${o.id}">📮 発送した</button>` : ''}
          ${o.status === 'shipped' ? `
            <span class="small">🚚 ${esc(o.tracking_no || '追跡番号未登録')}</span>
            <button class="btn btn-primary btn-sm" data-act="done" data-id="${o.id}">✅ 完了にする</button>` : ''}
        </div>
      </div>`;
    }).join('')}
  `;

  const byId = id => orders.find(o => o.id === id);
  view().querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => { adminFilter = c.dataset.filter; renderAdmin(); });
  });
  $('#btnOpLogout').addEventListener('click', async () => {
    await Cloud.logoutOperator();
    $('#adminTab').hidden = true;
    toast('ログアウトしました'); go('home');
  });
  view().querySelectorAll('[data-print]').forEach(b => {
    b.addEventListener('click', () => printDoc(b.dataset.print, byId(b.dataset.id).payload));
  });
  view().querySelectorAll('[data-word]').forEach(b => {
    b.addEventListener('click', () => {
      const o = byId(b.dataset.id);
      wordDoc(b.dataset.word, o.payload, o.order_no);
    });
  });
  view().querySelectorAll('[data-act]').forEach(b => {
    b.addEventListener('click', async () => {
      const act = b.dataset.act, id = b.dataset.id;
      const fields = { status: act };
      if (act === 'shipped') {
        const tn = prompt('追跡番号（お問い合わせ番号）を入力してください：', '');
        if (tn === null) return;
        fields.tracking_no = tn.trim();
      }
      if (act === 'cancelled' && !confirm('この注文をキャンセルしますか？')) return;
      try { await Cloud.updateOrder(id, fields); toast('更新しました'); renderAdmin(); }
      catch (e) { toast('更新に失敗しました：' + e.message); }
    });
  });
}

/* ---------- 運営者ログイン ---------- */
function openOperatorLogin() {
  if (Cloud.isOperator()) { go('admin'); return; }
  openModal(`
    <h3>運営者ログイン</h3>
    <div class="field"><label>メールアドレス</label><input type="email" id="opEmail" value="${esc(CFG.operatorEmail || '')}"></div>
    <div class="field"><label>パスワード</label><input type="password" id="opPass"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="opCancel">閉じる</button>
      <button class="btn btn-primary" id="opLogin">ログイン</button>
    </div>
    <p class="small muted" style="margin-top:10px;">※このページは運営者専用です。ご利用者の方はトップページ（index.html）をお使いください。</p>
  `);
  $('#opCancel').addEventListener('click', closeModal);
  $('#opLogin').addEventListener('click', async () => {
    const email = $('#opEmail').value.trim(), pass = $('#opPass').value;
    if (!email || !pass) { toast('メールとパスワードを入力してください'); return; }
    try {
      const ok = await Cloud.loginOperator(email, pass);
      if (ok) {
        $('#adminTab').hidden = false;
        closeModal(); toast('運営者としてログインしました'); go('admin');
      } else {
        toast('このアカウントには管理権限がありません');
        await Cloud.logoutOperator();
      }
    } catch (e) { toast('ログインに失敗しました：' + e.message); }
  });
}

/* ============================================================
   ルーティング・起動
   ============================================================ */
const routes = { home: renderHome, order: renderOrder, track: renderTrack, know: renderKnow, admin: renderAdmin };
let current = 'home';

function go(route) {
  current = routes[route] ? route : 'home';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === current));
  routes[current]();
  window.scrollTo(0, 0);
}

document.getElementById('tabbar').addEventListener('click', e => {
  const tab = e.target.closest('.tab'); if (tab) go(tab.dataset.route);
});
document.getElementById('view').addEventListener('click', e => {
  const el = e.target.closest('[data-go]'); if (el) go(el.dataset.go);
});
/* 管理機能は admin.html（運営者専用ページ）でのみ有効。
   お客様用ページ（index.html）には⚙️ボタンも管理タブも存在しない */
const IS_ADMIN_PAGE = document.body.dataset.page === 'admin';
const opBtn = document.getElementById('opBtn');
if (opBtn) opBtn.addEventListener('click', openOperatorLogin);

go('home');

/* クラウド初期化（裏で実行。管理ページでは運営者タブの表示判定＋ログイン誘導） */
(async () => {
  cloudReady = await Cloud.init();
  if (!IS_ADMIN_PAGE) return;
  if (cloudReady && Cloud.isOperator()) {
    $('#adminTab').hidden = false;
    go('admin');
  } else {
    openOperatorLogin();
  }
})();

/* ---------- Service Worker 登録 ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
