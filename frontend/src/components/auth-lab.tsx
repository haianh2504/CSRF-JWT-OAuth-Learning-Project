"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  localAddition?: boolean;
};

type User = { id?: string; email?: string; loginMethod?: string; provider?: string | null };
type ApiEnvelope<T> = { code: string; message: string; data: T };
type ApiOptions = { method?: string; body?: unknown; auth?: boolean; csrf?: boolean; retry?: boolean };
type RequestEntry = { method: string; path: string; status: string; note: string };
type RecordRequest = (entry: RequestEntry) => void;
type RefreshToken = () => Promise<string | null>;
type SessionExpired = () => void;

const demoProducts: Product[] = [
  { id: "prd_demo_01", name: "Canvas Tote Bag", description: "Reusable everyday tote.", price: 12.5, currency: "USD" },
  { id: "prd_demo_02", name: "Studio Notebook", description: "A fresh page for your next idea.", price: 8, currency: "USD" },
  { id: "prd_demo_03", name: "Everyday Mug", description: "A little pause between big plans.", price: 14.25, currency: "USD" },
  { id: "prd_demo_04", name: "Focus Desk Light", description: "A soft glow for late study hours.", price: 29, currency: "USD" }
];

const safeMessages: Record<string, string> = {
  VALIDATION_ERROR: "Một số thông tin chưa hợp lệ. Hãy kiểm tra lại các trường.",
  EMAIL_ALREADY_REGISTERED: "Email này đã được đăng ký. Hãy đăng nhập.",
  INVALID_CREDENTIALS: "Email hoặc mật khẩu chưa chính xác.",
  UNAUTHENTICATED: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
  FORBIDDEN: "Yêu cầu này chưa được phép thực hiện.",
  BAD_REQUEST: "Yêu cầu không hợp lệ hoặc đã hết hạn."
};

function readCookie(name: string) {
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return "";
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return entry.slice(name.length + 1); }
}

function readArray(key: string): unknown[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function normalizeProduct(value: unknown): Product | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100) return null;
  const price = Number(item.price);
  const currency = typeof item.currency === "string" ? item.currency : "";
  if (!Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return {
    id: item.id,
    name: item.name.trim(),
    description: typeof item.description === "string" ? item.description.slice(0, 500) : "",
    price,
    currency,
    localAddition: true
  };
}

function price(value: number, currency: string) {
  try { return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value); }
  catch { return `${value} ${currency}`; }
}

async function apiRequest<T>(
  path: string,
  options: ApiOptions,
  token: string | null,
  record: RecordRequest,
  refresh: RefreshToken,
  sessionExpired: SessionExpired
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.auth) {
    if (!token) throw new Error("Hãy đăng nhập để tiếp tục.");
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.csrf) {
    const csrf = readCookie("XSRF-TOKEN");
    if (!csrf) throw new Error("Không tìm thấy CSRF cookie. Hãy đăng nhập lại.");
    headers.set("X-CSRF-TOKEN", csrf);
  }
  let response: Response;
  let envelope: ApiEnvelope<T> | null = null;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    try { envelope = await response.json() as ApiEnvelope<T>; } catch { envelope = null; }
  } catch {
    record({ method, path: `/api/v1${path}`, status: "ERR", note: "API không phản hồi" });
    throw new Error("Không kết nối được API. Hãy kiểm tra frontend proxy và backend.");
  }
  const code = typeof envelope?.code === "string" ? envelope.code : "";
  record({ method, path: `/api/v1${path}`, status: String(response.status), note: code ? `response: ${code}` : "response received" });
  if (response.status === 401 && options.auth && options.retry !== false) {
    const freshToken = await refresh();
    if (freshToken) return apiRequest<T>(path, { ...options, retry: false }, freshToken, record, refresh, sessionExpired);
    sessionExpired();
    throw new Error(safeMessages[code] ?? "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  }
  if (!response.ok || !envelope || typeof envelope !== "object") {
    throw new Error(safeMessages[code] ?? (response.status >= 500
      ? "Máy chủ chưa xử lý được yêu cầu. Hãy thử lại sau."
      : "Không thể hoàn tất yêu cầu. Hãy kiểm tra kết nối và thử lại."));
  }
  return envelope.data;
}

export function AuthLab() {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [demoMode, setDemoMode] = useState(false);
  const [inShop, setInShop] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [shopName, setShopName] = useState("Demo Shop");
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [authError, setAuthError] = useState("");
  const [productError, setProductError] = useState("");
  const [toast, setToast] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const accessTokenRef = useRef<string | null>(null);
  const refreshFlight = useRef<Promise<string | null> | null>(null);
  const bootStarted = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const recordRequest = useCallback((entry: RequestEntry) => {
    setRequests((current) => [entry, ...current].slice(0, 8));
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshFlight.current) return refreshFlight.current;
    if (!readCookie("XSRF-TOKEN")) return null;
    refreshFlight.current = (async () => {
      try {
        const data = await apiRequest<{ accessToken?: string; user?: User }>("/auth/refresh", { method: "POST", csrf: true, retry: false }, null, recordRequest, async () => null, () => undefined);
        if (typeof data?.accessToken !== "string") return null;
        accessTokenRef.current = data.accessToken;
        if (data.user) setUser(data.user);
        return data.accessToken;
      } catch { return null; }
    })();
    try { return await refreshFlight.current; }
    finally { refreshFlight.current = null; }
  }, [recordRequest]);

  const loadShop = useCallback(async (token: string) => {
    const [homepage, catalog] = await Promise.all([
      apiRequest<{ user?: User; shopName?: string }>("/homepage", { auth: true }, token, recordRequest, refreshAccessToken, () => { accessTokenRef.current = null; setInShop(false); }),
      apiRequest<{ products?: unknown[] }>("/products", { auth: true }, token, recordRequest, refreshAccessToken, () => { accessTokenRef.current = null; setInShop(false); })
    ]);
    const serverProducts = (Array.isArray(catalog?.products) ? catalog.products : []).map((item) => normalizeProduct(item)).filter((item): item is Product => item !== null);
    const localProducts = readArray("csrfJwtShop.addedProducts").map((item) => normalizeProduct(item)).filter((item): item is Product => item !== null);
    const combined = new Map<string, Product>();
    for (const item of serverProducts) combined.set(item.id, { ...item, localAddition: false });
    for (const item of localProducts) if (!combined.has(item.id)) combined.set(item.id, item);
    const hidden = new Set(readArray("csrfJwtShop.hiddenProductIds").filter((item): item is string => typeof item === "string"));
    setProducts([...combined.values()].filter((item) => !hidden.has(item.id)));
    setShopName(typeof homepage?.shopName === "string" ? homepage.shopName : "Demo Shop");
    if (homepage?.user) setUser(homepage.user);
    setDemoMode(false);
    setInShop(true);
  }, [recordRequest, refreshAccessToken]);

  const establishSession = useCallback(async (data: { accessToken?: string; user?: User }) => {
    if (typeof data?.accessToken !== "string") throw new Error("API không trả về access token hợp lệ.");
    accessTokenRef.current = data.accessToken;
    if (data.user) setUser(data.user);
    await loadShop(data.accessToken);
  }, [loadShop]);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    let active = true;
    const finishOAuthOrRefresh = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");
      if (code || oauthError) window.history.replaceState(null, "", `${url.pathname}${url.hash}`);
      if (code) {
        try {
          const data = await apiRequest<{ accessToken?: string; user?: User }>("/auth/oauth/exchange", { method: "POST", body: { code }, retry: false }, null, recordRequest, refreshAccessToken, () => undefined);
          if (active) await establishSession(data);
        } catch (error) { if (active) showToast(error instanceof Error ? error.message : "OAuth không hoàn tất."); }
        return;
      }
      if (oauthError) { if (active) showToast("Đăng nhập OAuth chưa hoàn tất. Bạn có thể thử lại."); return; }
      if (readCookie("XSRF-TOKEN")) {
        const token = await refreshAccessToken();
        if (active && token) {
          try { await loadShop(token); } catch (error) { showToast(error instanceof Error ? error.message : "Không thể tải shop."); }
        }
      }
    };
    void finishOAuthOrRefresh();
    return () => { active = false; };
  }, [establishSession, loadShop, recordRequest, refreshAccessToken, showToast]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) { setAuthError("Vui lòng nhập email và mật khẩu."); return; }
    try {
      if (authMode === "signup") {
        await apiRequest("/auth/signup", { method: "POST", body: { email, password }, retry: false }, null, recordRequest, refreshAccessToken, () => undefined);
        setAuthMode("signin");
        showToast("Tạo tài khoản thành công. Đăng nhập để tiếp tục.");
      } else {
        const data = await apiRequest<{ accessToken?: string; user?: User }>("/auth/signin", { method: "POST", body: { email, password }, retry: false }, null, recordRequest, refreshAccessToken, () => undefined);
        await establishSession(data);
        showToast("Đăng nhập thành công.");
      }
      formElement.reset();
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Không thể hoàn tất yêu cầu."); }
    finally {
      const passwordField = formElement.elements.namedItem("password");
      if (passwordField instanceof HTMLInputElement) passwordField.value = "";
    }
  }

  function startDemo() {
    accessTokenRef.current = null;
    setUser(null);
    setProducts(demoProducts);
    setRequests([
      { method: "GET", path: "/api/v1/homepage", status: "DEMO", note: "Thông tin shop minh họa" },
      { method: "GET", path: "/api/v1/products", status: "DEMO", note: "Catalog minh họa" },
      { method: "POST", path: "/api/v1/auth/signin", status: "DEMO", note: "Không gửi thông tin đăng nhập" }
    ]);
    setDemoMode(true);
    setInShop(true);
  }

  async function logout() {
    if (demoMode) { setInShop(false); return; }
    try {
      await apiRequest("/auth/sessions", { method: "DELETE", auth: true, csrf: true }, accessTokenRef.current, recordRequest, refreshAccessToken, () => { accessTokenRef.current = null; setInShop(false); });
      showToast("Đã thu hồi refresh session và vô hiệu hóa access token hiện tại.");
    } catch (error) {
      showToast(`Đã xóa access token khỏi trang; chưa xác nhận thu hồi refresh session. ${error instanceof Error ? error.message : ""}`);
    } finally {
      accessTokenRef.current = null;
      setUser(null);
      setDemoMode(false);
      setInShop(false);
    }
  }

  async function hideProduct(product: Product) {
    if (demoMode) {
      setProducts((items) => items.filter((item) => item.id !== product.id));
      showToast("Đã ẩn khỏi bản xem trước; không gọi API.");
      return;
    }
    try {
      await apiRequest(`/products/${encodeURIComponent(product.id)}`, { method: "DELETE", auth: true }, accessTokenRef.current, recordRequest, refreshAccessToken, () => { accessTokenRef.current = null; setInShop(false); });
      const hidden = new Set(readArray("csrfJwtShop.hiddenProductIds").filter((item): item is string => typeof item === "string"));
      hidden.add(product.id);
      localStorage.setItem("csrfJwtShop.hiddenProductIds", JSON.stringify([...hidden]));
      setProducts((items) => items.filter((item) => item.id !== product.id));
      showToast("Sản phẩm đã được ẩn sau khi API xác nhận.");
    } catch (error) { showToast(error instanceof Error ? error.message : "Không thể ẩn sản phẩm."); }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setProductError("");
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    const description = String(fields.get("description") ?? "").trim();
    const priceValue = Number(fields.get("price"));
    if (!name || name.length > 100 || !Number.isFinite(priceValue) || priceValue < 0) { setProductError("Hãy nhập tên hợp lệ và giá bằng 0 hoặc lớn hơn."); return; }
    const product: Product = { id: `prd_local_${window.crypto?.randomUUID?.() ?? Date.now().toString(36)}`, name, description, price: priceValue, currency: "USD", localAddition: true };
    if (demoMode) {
      setProducts((items) => [product, ...items]);
      setRequests((items) => [{ method: "POST", path: "/api/v1/products", status: "DEMO", note: "Sản phẩm demo được thêm" }, ...items].slice(0, 8));
      setModalOpen(false);
      formElement.reset();
      showToast("Đã thêm vào bản xem trước; không gọi API.");
      return;
    }
    try {
      const data = await apiRequest<{ product?: unknown } | unknown>("/products", { method: "POST", body: product, auth: true }, accessTokenRef.current, recordRequest, refreshAccessToken, () => { accessTokenRef.current = null; setInShop(false); });
      const accepted = normalizeProduct((data as { product?: unknown })?.product ?? data);
      if (!accepted) throw new Error("API phản hồi dữ liệu sản phẩm không đúng contract.");
      const stored = readArray("csrfJwtShop.addedProducts").map((item) => normalizeProduct(item)).filter((item): item is Product => item !== null);
      localStorage.setItem("csrfJwtShop.addedProducts", JSON.stringify([{ ...accepted, localAddition: true }, ...stored]));
      setProducts((items) => [{ ...accepted, localAddition: true }, ...items.filter((item) => item.id !== accepted.id)]);
      setModalOpen(false);
      formElement.reset();
      showToast("Sản phẩm đã được thêm sau khi API xác nhận.");
    } catch (error) { setProductError(error instanceof Error ? error.message : "Không thể thêm sản phẩm."); }
  }

  const requestDemo = (path: string, method: string, note: string) => setRequests((items) => [{ method, path, status: "DEMO", note }, ...items].slice(0, 8));

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setInShop(false); }} aria-label="Auth Lab — trang đầu">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span><span className="brand-name">Auth Lab</span><span className="brand-sub">JWT & OAuth learning shop</span></span>
        </a>
        <span className="prototype-label">Next.js · Frontend</span>
      </header>

      {!inShop ? (
        <main className="view active">
          <div className="welcome">
            <section className="welcome-copy">
              <span className="eyebrow"><span className="eyebrow-dot" /> AUTHENTICATION, MADE CLEAR</span>
              <h1>Từng bước vững vàng hơn <span className="headline-accent">trong thế giới số.</span></h1>
              <p className="welcome-lede">Khám phá cách đăng nhập, OAuth và JWT hoạt động qua một cửa hàng mô phỏng. Quan sát request và hiểu điều gì xảy ra phía sau mỗi thao tác.</p>
              <div className="learning-chips"><span className="learning-chip"><b>01</b> Sign in</span><span className="learning-chip"><b>02</b> JWT bearer</span><span className="learning-chip"><b>03</b> Refresh safely</span></div>
            </section>
            <section className="auth-card" aria-label="Khu vực đăng nhập">
              <h2 className="auth-heading">{authMode === "signin" ? "Chào bạn, bắt đầu nhé" : "Tạo tài khoản"}</h2>
              <p className="auth-caption">{authMode === "signin" ? "Đăng nhập để mở không gian thực hành của bạn." : "Tạo tài khoản để thực hành luồng đăng ký."}</p>
              <div className="mode-switch" role="tablist" aria-label="Chọn hình thức">
                <button type="button" role="tab" aria-selected={authMode === "signin"} className={`mode-button ${authMode === "signin" ? "active" : ""}`} onClick={() => { setAuthMode("signin"); setAuthError(""); }}>Đăng nhập</button>
                <button type="button" role="tab" aria-selected={authMode === "signup"} className={`mode-button ${authMode === "signup" ? "active" : ""}`} onClick={() => { setAuthMode("signup"); setAuthError(""); }}>Tạo tài khoản</button>
              </div>
              <form onSubmit={submitAuth}>
                <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" placeholder="ban@example.com" required /></div>
                <div className="field"><label htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} placeholder="Nhập mật khẩu" required /></div>
                {authError && <p className="form-error" role="alert">{authError}</p>}
                <button className="primary-button full" type="submit">{authMode === "signin" ? "Đăng nhập" : "Tạo tài khoản"}<span aria-hidden="true">→</span></button>
              </form>
              <div className="auth-divider">hoặc tiếp tục với</div>
              <div className="oauth-row"><button className="oauth-button" type="button" onClick={() => { window.location.assign(new URL("/oauth2/authorization/google", window.location.origin).toString()); }}>G&nbsp; Google</button><button className="oauth-button" type="button" onClick={() => { window.location.assign(new URL("/oauth2/authorization/facebook", window.location.origin).toString()); }}>f&nbsp; Facebook</button></div>
              <p className="prototype-note"><strong>Kết nối API qua Next.js proxy.</strong> Mật khẩu chỉ gửi tới API đăng nhập; production cần HTTPS.</p>
              <button className="demo-link" type="button" onClick={startDemo}>Xem trước shop demo <span aria-hidden="true">↗</span></button>
            </section>
          </div>
          <p className="footer-note">Tài khoản và giao dịch ở đây phục vụ mục đích học tập.</p>
        </main>
      ) : (
        <main className="view active">
          <div className="workbench-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> KHÔNG GIAN THỰC HÀNH</span><h1>{demoMode ? "Demo Shop" : shopName}</h1><p>{demoMode ? "Catalog và request trong chế độ này được mô phỏng." : "Theo dõi catalog API và request đã gửi."}</p></div><div className="user-controls"><span className="session-pill"><span className="dot" />{demoMode ? "Phiên demo · chưa xác thực" : `Đã xác thực · ${user?.email ?? "tài khoản"}`}</span><button type="button" className="secondary-button" onClick={logout}>{demoMode ? "Thoát bản xem trước" : "Đăng xuất"}</button></div></div>
          <div className="workspace">
            <section className="shop-panel"><div className="section-heading"><div><h2>Sản phẩm để khám phá</h2><p>Catalog nhỏ để bạn tập trung vào luồng xác thực.</p></div><div className="catalog-tools"><span className="catalog-count">{products.length} sản phẩm</span><button className="primary-button" type="button" onClick={() => { setProductError(""); setModalOpen(true); }}>＋ Thêm sản phẩm</button></div></div>
              <div className="product-grid">{products.length ? products.map((product, index) => <article className="product-card" key={product.id}><div className={`product-visual visual-${["blue", "peach", "mint", "lilac"][index % 4]}`} aria-hidden="true">{["👜", "📓", "☕", "💡"][index % 4]}</div><div className="product-meta"><div className="product-topline"><span className="product-name">{product.name}</span><span className="product-price">{price(product.price, product.currency)}</span></div><p className="product-description">{product.description || "Sản phẩm trong catalog demo."}</p><div className="product-actions"><span className="product-tag">{demoMode ? "Catalog demo" : product.localAddition ? "Mới · lưu trên trình duyệt" : "Catalog API"}</span><button type="button" className="hide-button" onClick={() => { if (demoMode) requestDemo(`/api/v1/products/${product.id}`, "DELETE", "Ẩn sản phẩm mô phỏng"); void hideProduct(product); }}>Ẩn khỏi danh sách</button></div></div></article>) : <div className="empty-state">Chưa có sản phẩm hiển thị. Thêm sản phẩm để tiếp tục.</div>}</div>
              <div className="local-banner"><span aria-hidden="true">✓</span><span>{demoMode ? "Bản demo không gọi API và không ghi localStorage." : "Sản phẩm chỉ cập nhật localStorage sau khi API xác nhận; đây không phải dữ liệu authoritative của server."}</span></div>
            </section>
            <aside className="inspector-panel"><div className="inspector-head"><div className="inspector-title"><span className="inspector-icon">≡</span><div><h2>Request Inspector</h2><p>Không hiển thị token hoặc mật khẩu</p></div></div><span className="demo-badge">{demoMode ? "MÔ PHỎNG" : "API THẬT"}</span></div><div className="inspector-body"><p className="inspector-label"><span>Hoạt động gần đây</span><span>{String(requests.length).padStart(2, "0")}</span></p><div className="event-list">{(demoMode && requests.length === 0 ? [{ method: "GET", path: "/api/v1/homepage", status: "DEMO", note: "Dữ liệu minh họa" }] : requests).map((item, index) => <div className="event-row" key={`${item.path}-${index}`}><span className="method">{item.method}</span><span className="event-route">{item.path}</span><span className="event-status">{item.status}</span></div>)}{!demoMode && requests.length === 0 && <p className="empty-state">Chưa có request API.</p>}</div><div className="event-detail"><div className="detail-top"><span className="detail-name">{requests[0]?.note ?? (demoMode ? "Bản xem trước" : "Chưa có request API")}</span><span className="http-code">{requests[0]?.status ?? (demoMode ? "DEMO" : "—")}</span></div><div className="request-line"><span>Authorization</span><code>Bearer ••••••••</code></div><div className="request-line"><span>CSRF</span><code>{requests[0]?.path.endsWith("/refresh") || requests[0]?.path.endsWith("/sessions") ? "Proof đã che" : "Không yêu cầu"}</code></div><div className="request-line"><span>Kết quả</span><code>{requests[0]?.note ?? "Dữ liệu minh họa"}</code></div></div><section className="token-learning"><h3>JWT có 3 phần</h3><p>JWS đảm bảo tính toàn vẹn; chữ ký không mã hóa payload.</p><div className="token-parts"><span className="token-part">header</span><span className="token-part">payload</span><span className="token-part">signature</span></div><p className="token-warning">Payload có thể đọc được. Không đưa bí mật vào token.</p></section><div className="session-facts"><div className="fact"><span>Access JWT</span><strong>Trong bộ nhớ · 10 phút</strong></div><div className="fact"><span>Refresh token</span><strong>Cookie HttpOnly · 7 ngày</strong></div></div></div></aside>
          </div><p className="footer-note">{demoMode ? "Mọi request trong màn hình là dữ liệu minh họa." : "Inspector chỉ hiển thị route, status và thông tin tóm tắt."}</p>
        </main>
      )}

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div className="modal-header"><div><h2 id="modalTitle">{demoMode ? "Thêm sản phẩm demo" : "Thêm sản phẩm"}</h2><p>Sản phẩm được lưu trên trình duyệt sau khi API xác nhận.</p></div><button className="close-button" type="button" aria-label="Đóng" onClick={() => setModalOpen(false)}>×</button></div><form onSubmit={addProduct}><div className="field"><label htmlFor="productName">Tên sản phẩm</label><input id="productName" name="name" maxLength={100} required /></div><div className="field"><label htmlFor="productDescription">Mô tả</label><input id="productDescription" name="description" maxLength={500} /></div><div className="field"><label htmlFor="productPrice">Giá (USD)</label><input id="productPrice" name="price" type="number" min="0" step="0.01" required /></div>{productError && <p className="form-error" role="alert">{productError}</p>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setModalOpen(false)}>Hủy</button><button className="primary-button" type="submit">{demoMode ? "Thêm vào bản demo" : "Thêm sản phẩm"}</button></div></form></section></div>}
      {toast && <div className="toast show" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
