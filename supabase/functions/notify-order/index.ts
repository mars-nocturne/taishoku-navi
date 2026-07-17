/* ============================================================
   退職届ナビ — 注文通知 Edge Function
   ------------------------------------------------------------
   taishoku_orders への INSERT（新規依頼）と、UPDATE で
   status が cancelled になった時に、運営者へメールで知らせる。

   呼び出し元：Supabase Database Webhook（README の手順で作成）
   メール送信：Resend API（https://resend.com）

   必要なシークレット（supabase secrets set で設定）:
     RESEND_API_KEY … Resend の API キー
     WEBHOOK_SECRET … Webhook のヘッダー x-webhook-secret と同じ値（合言葉）
   任意:
     NOTIFY_TO      … 通知先（省略時は下の DEFAULT_TO）
     MAIL_FROM      … 差出人（省略時は Resend のオンボーディング用アドレス。
                       独自ドメインを Resend で認証したら変更する）
   ============================================================ */

const DEFAULT_TO = "positive.career.2026@gmail.com";
const DEFAULT_FROM = "退職届ナビ <onboarding@resend.dev>";
const APP_URL = "https://mars-nocturne.github.io/taishoku-navi/";

type OrderRecord = {
  order_no?: string;
  status?: string;
  created_at?: string;
  payload?: Record<string, unknown>;
};

function s(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "—";
}

function orderSummary(r: OrderRecord): string {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const lines = [
    `受付番号　：${s(r.order_no)}`,
    `書類　　　：${p.docType === "negai" ? "退職願" : "退職届"}`,
    `氏名　　　：${s(p.name)}`,
    `会社　　　：${s(p.company)}`,
    `退職日　　：${s(p.taishokuDate)}`,
    `発送希望日：${typeof p.shipDate === "string" && p.shipDate ? p.shipDate : "指定なし（入金確認後すみやかに）"}`,
    `料金　　　：¥${Number(p.price ?? 0).toLocaleString("ja-JP")}`,
    `連絡先　　：${s(p.email)} ／ ${s(p.tel)}`,
    "",
    `管理タブ　：${APP_URL}`,
  ];
  return lines.join("\n");
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
  let subject = "";
  let text = "";

  if (type === "INSERT" && record) {
    subject = `【退職届ナビ】新しい依頼 ${s(record.order_no)}`;
    text = `新しい依頼が入りました。入金をお待ちください。\n\n${orderSummary(record)}`;
  } else if (
    type === "UPDATE" && record?.status === "cancelled" &&
    old_record?.status !== "cancelled"
  ) {
    subject = `【退職届ナビ】依頼キャンセル ${s(record.order_no)}`;
    text = `依頼がキャンセルされました。入金済みの場合は返金対応をしてください。\n\n${orderSummary(record)}`;
  } else {
    // 対象外のイベントは黙って成功扱い（Webhook のリトライを防ぐ）
    return new Response("ignored", { status: 200 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM") ?? DEFAULT_FROM,
      to: [Deno.env.get("NOTIFY_TO") ?? DEFAULT_TO],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    console.error("Resend error:", res.status, await res.text());
    return new Response("mail failed", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
