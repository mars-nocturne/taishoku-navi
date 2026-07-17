/* ============================================================
   退職届ナビ — クラウド接続（Supabase）
   依頼者：匿名サインインで自分の注文だけ読める
   運営者：メール＋パスワードでログインすると全注文を管理できる
   ============================================================ */
'use strict';

window.Cloud = (() => {
  const cfg = window.TAISHOKU_CONFIG || {};
  let sb = null;
  let currentUser = null;
  let operator = false;

  function available() {
    return !!(cfg.url && cfg.anonKey && window.supabase);
  }

  /* 運営者かどうかはサーバー側（SupabaseのSQL関数）に問い合わせる。
     クライアントには運営者の識別情報を一切持たない。 */
  async function refreshOperator() {
    try {
      const { data, error } = await sb.rpc('taishoku_is_operator');
      operator = !error && data === true;
    } catch (e) { operator = false; }
    return operator;
  }

  /* 初期化：セッションがなければ匿名サインイン */
  async function init() {
    if (!available()) return false;
    if (!sb) sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const { error } = await sb.auth.signInAnonymously();
        if (error) throw error;
      }
      const { data: { user } } = await sb.auth.getUser();
      currentUser = user;
      await refreshOperator();
      return true;
    } catch (e) {
      console.warn('Cloud init failed:', e.message);
      return false;
    }
  }

  function isOperator() { return operator; }

  /* ---------- 依頼者 ---------- */
  async function createOrder(payload) {
    const { data, error } = await sb.from('taishoku_orders')
      .insert({ payload }).select().single();
    if (error) throw error;
    return data;
  }

  async function myOrders() {
    const { data, error } = await sb.from('taishoku_orders')
      .select('id, order_no, status, tracking_no, payload, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function cancelOrder(id) {
    const { error } = await sb.from('taishoku_orders')
      .update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
  }

  /* ---------- 運営者 ---------- */
  async function loginOperator(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: { user } } = await sb.auth.getUser();
    currentUser = user;
    return await refreshOperator();
  }

  async function logoutOperator() {
    await sb.auth.signOut();
    await sb.auth.signInAnonymously();
    const { data: { user } } = await sb.auth.getUser();
    currentUser = user;
    operator = false;
  }

  async function allOrders() {
    const { data, error } = await sb.from('taishoku_orders')
      .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function updateOrder(id, fields) {
    const { error } = await sb.from('taishoku_orders')
      .update(fields).eq('id', id);
    if (error) throw error;
  }

  return { available, init, isOperator, createOrder, myOrders, cancelOrder,
           loginOperator, logoutOperator, allOrders, updateOrder };
})();
