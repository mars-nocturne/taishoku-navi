/* ============================================================
   格安退職便ヤメレター — 注文通知 Edge Function
   ------------------------------------------------------------
   taishoku_orders の変化を Database Webhook で受けてメールを送る。

   【運営者宛】常に有効
     - 新規依頼（INSERT）
     - キャンセル（status → cancelled）
   【お客様宛】シークレット CUSTOMER_MAIL=on のときだけ有効
     ※Resendで独自ドメインを認証してから on にすること。
       未認証のまま on にすると送信は失敗する（運営者宛には影響しない）
     - 受付確認＋振込案内（INSERT）
     - 入金確認・作業開始（status → paid）
     - 発送完了＋追跡番号（status → shipped）
     - 配達確認・完了のご挨拶（status → done）
     - キャンセル受付（status → cancelled）

   必要なシークレット（supabase secrets set で設定）:
     RESEND_API_KEY … Resend の API キー
     WEBHOOK_SECRET … Webhook のヘッダー x-webhook-secret と同じ値（合言葉）
   任意:
     NOTIFY_TO      … 運営者通知の宛先（省略時は DEFAULT_TO）
     MAIL_FROM      … 差出人。独自ドメイン認証後は「格安退職便ヤメレター <info@あなたのドメイン>」
                       のように設定する（省略時は Resend のオンボーディング用）
     CUSTOMER_MAIL  … "on" でお客様宛メールを有効化
   ============================================================ */

const DEFAULT_TO = "positive.career.2026@gmail.com";
const DEFAULT_FROM = "ヤメレター <onboarding@resend.dev>";
const APP_URL = "https://taishoku-yasui.com/";

/* 振込先（config.js の bank と同じ内容を維持すること） */
const BANK_LINES = [
  "銀行　：PayPay銀行",
  "支店　：ビジネス営業部（店番号005）",
  "口座　：普通 2282525",
  "名義　：ポジティブキヤリアホウライカズオ",
];

type OrderRecord = {
  order_no?: string;
  status?: string;
  tracking_no?: string;
  created_at?: string;
  payload?: Record<string, unknown>;
};

function s(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "—";
}
function p(r: OrderRecord): Record<string, unknown> {
  return (r.payload ?? {}) as Record<string, unknown>;
}
function yen(v: unknown): string {
  return "¥" + Number(v ?? 0).toLocaleString("ja-JP");
}

function orderSummary(r: OrderRecord): string {
  const d = p(r);
  return [
    `受付番号　：${s(r.order_no)}`,
    `書類　　　：${d.docType === "negai" ? "退職願" : "退職届"}`,
    `氏名　　　：${s(d.name)}`,
    `雇用形態　：${d.empType === "yuki" ? "有期雇用（※2週間ルール対象外に注意）" : "無期雇用"}`,
    `会社　　　：${s(d.company)}`,
    `退職日　　：${s(d.taishokuDate)}`,
    `発送希望日：${typeof d.shipDate === "string" && d.shipDate ? d.shipDate : "指定なし（入金確認後すみやかに）"}`,
    `料金　　　：${yen(d.price)}`,
    `連絡先　　：${s(d.email)} ／ ${s(d.tel)}`,
    "",
    `管理タブ　：${APP_URL}`,
  ].join("\n");
}

const SIGNATURE = [
  "──────────────────",
  "格安退職便ヤメレター（ポジティブキャリア）",
  APP_URL,
  "このメールに返信いただければ運営者に届きます。",
].join("\n");

/* お客様宛の文面（kind ごと） */
function customerMail(kind: "received" | "paid" | "shipped" | "done" | "cancelled", r: OrderRecord):
  { subject: string; text: string } | null {
  const d = p(r);
  const name = typeof d.name === "string" && d.name.trim() ? `${d.name.trim()} 様` : "お客様";
  const no = s(r.order_no);
  const isYuki = d.empType === "yuki";

  if (kind === "received") {
    return {
      subject: `【ヤメレター】ご依頼を受け付けました（受付番号 ${no}）`,
      text: [
        `${name}`,
        "",
        "格安退職便ヤメレターをご利用いただきありがとうございます。",
        "以下の内容でご依頼を受け付けました。",
        "",
        `受付番号：${no}`,
        `料金　　：${yen(d.price)}（税込・前払い）`,
        "",
        "下記の口座へお振込みをお願いいたします。",
        "ご入金の確認をもって、退職届の作成・発送作業を開始します。",
        "",
        ...BANK_LINES,
        "",
        `※振込名義の先頭に受付番号をお付けください（例：「${no} ヤマダタロウ」）`,
        "※振込手数料はご負担ください",
        "※受付から14日以内にご入金が確認できない場合、キャンセル扱いとなることがあります",
        "",
        "進み具合はアプリの「追跡」タブからいつでも確認できます。",
        "発送前であればキャンセルも可能です。",
        "",
        SIGNATURE,
      ].join("\n"),
    };
  }
  if (kind === "paid") {
    return {
      subject: `【ヤメレター】ご入金を確認しました（受付番号 ${no}）`,
      text: [
        `${name}`,
        "",
        "ご入金を確認いたしました。ありがとうございます。",
        "これより退職届の作成・印刷・発送作業に入ります。",
        "発送が完了しましたら、追跡番号をメールとアプリでお知らせします。",
        "",
        SIGNATURE,
      ].join("\n"),
    };
  }
  if (kind === "shipped") {
    return {
      subject: `【ヤメレター】退職届を発送しました（受付番号 ${no}）`,
      text: [
        `${name}`,
        "",
        "退職届を簡易書留にて発送いたしました。",
        "",
        `追跡番号：${s(r.tracking_no)}`,
        "（日本郵便の追跡サービスで配達状況を確認できます）",
        "",
        ...(isYuki
          ? [
            "配達された時点で、退職の意思表示は会社に到達しています。",
            "（有期雇用のため、退職成立の時期は契約内容・お申し出の内容によります）",
          ]
          : [
            "配達された時点で退職の意思表示は会社に到達したことになり、",
            "到達から2週間で退職が成立します（民法627条）。",
          ]),
        "配達状況はアプリの「追跡」タブでも確認できます。",
        "",
        SIGNATURE,
      ].join("\n"),
    };
  }
  if (kind === "done") {
    return {
      subject: `【ヤメレター】退職届が会社に配達されました（受付番号 ${no}）`,
      text: [
        `${name}`,
        "",
        "退職届の配達が確認できましたので、ご連絡いたします。",
        "",
        "配達された時点で、退職の意思表示は会社に到達しています。",
        ...(isYuki
          ? ["（有期雇用のため、退職成立の時期は契約内容・お申し出の内容によります）"]
          : [
            "到達から2週間が経過すると退職が成立します（民法627条）。",
            "会社の承認は必要ありません。",
          ]),
        "",
        "退職にあたっては、次の手続きもお忘れなく：",
        "・健康保険の切り替え（退職日の翌日から14日以内が目安）",
        "・年金の切り替え（国民年金など）",
        "・離職票・源泉徴収票の受け取り（会社から郵送されます）",
        `詳しくはアプリの「知識」タブにチェックリストがあります → ${APP_URL}`,
        "",
        "このたびはご利用いただき、誠にありがとうございました。",
        "新しい一歩を、心より応援しています。",
        "",
        SIGNATURE,
      ].join("\n"),
    };
  }
  if (kind === "cancelled") {
    return {
      subject: `【ヤメレター】キャンセルを承りました（受付番号 ${no}）`,
      text: [
        `${name}`,
        "",
        `受付番号 ${no} のご依頼のキャンセルを承りました。`,
        "ご入金済みの場合は、振込手数料を差し引いた全額を返金いたします。",
        "返金先の口座情報を、このメールへの返信でお知らせください。",
        "",
        "またのご利用をお待ちしております。",
        "",
        SIGNATURE,
      ].join("\n"),
    };
  }
  return null;
}

async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") ?? DEFAULT_FROM,
      to: [to],
      reply_to: Deno.env.get("NOTIFY_TO") ?? DEFAULT_TO,
      subject,
      text,
    }),
  });
  if (!res.ok) console.error(`Resend error (${to}):`, res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  // Webhook の合言葉チェック（第三者からの叩き込みを弾く）
  const secret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { type?: string; record?: OrderRecord; old_record?: OrderRecord };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const { type, record, old_record } = body;
  if (!record) return new Response("ignored", { status: 200 });

  const customerOn = (Deno.env.get("CUSTOMER_MAIL") ?? "") === "on";
  const customerTo = typeof p(record).email === "string" ? (p(record).email as string).trim() : "";
  const operatorTo = Deno.env.get("NOTIFY_TO") ?? DEFAULT_TO;
  const jobs: Promise<boolean>[] = [];

  /* イベント判定 */
  let operatorMail: { subject: string; text: string } | null = null;
  let customerKind: "received" | "paid" | "shipped" | "done" | "cancelled" | null = null;

  if (type === "INSERT") {
    operatorMail = {
      subject: `【ヤメレター】新しい依頼 ${s(record.order_no)}`,
      text: `新しい依頼が入りました。入金をお待ちください。\n\n${orderSummary(record)}`,
    };
    customerKind = "received";
  } else if (type === "UPDATE" && record.status !== old_record?.status) {
    if (record.status === "cancelled") {
      operatorMail = {
        subject: `【ヤメレター】依頼キャンセル ${s(record.order_no)}`,
        text: `依頼がキャンセルされました。入金済みの場合は返金対応をしてください。\n\n${orderSummary(record)}`,
      };
      customerKind = "cancelled";
    } else if (record.status === "paid") {
      customerKind = "paid";
    } else if (record.status === "shipped") {
      customerKind = "shipped";
    } else if (record.status === "done") {
      customerKind = "done";
    }
  }

  if (!operatorMail && !customerKind) {
    // 対象外のイベントは黙って成功扱い（Webhook のリトライを防ぐ）
    return new Response("ignored", { status: 200 });
  }

  if (operatorMail) jobs.push(sendMail(operatorTo, operatorMail.subject, operatorMail.text));
  if (customerOn && customerKind && customerTo && customerTo.includes("@")) {
    const m = customerMail(customerKind, record);
    if (m) jobs.push(sendMail(customerTo, m.subject, m.text));
  }

  const results = await Promise.all(jobs);
  // 1通でも送れていれば 200（部分失敗はログで追う）。全滅のみ 500 でリトライさせる
  if (results.length && results.every((ok) => !ok)) {
    return new Response("mail failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
