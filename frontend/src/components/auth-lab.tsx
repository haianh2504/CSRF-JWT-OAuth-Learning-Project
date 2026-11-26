"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AuthScreen } from "./auth-ui";
import { AddProductDialog, ShopWorkspace } from "./shop-ui";
import type { AuthMode, Product, RequestEntry, User } from "./auth-lab-types";

type ApiEnvelope<T> = { code: string; message: string; data: T };
type ApiOptions = { method?: string; body?: unknown; auth?: boolean; csrf?: boolean; retry?: boolean };
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

type SessionData = { accessToken?: string; expiresAt?: string; user?: User };

export function AuthLab() {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [demoMode, setDemoMode] = useState(false);
  const [inShop, setInShop] = useState(false);
  const [hasSessionToken, setHasSessionToken] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [shopName, setShopName] = useState("Demo Shop");
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [authError, setAuthError] = useState("");
  const [shopError, setShopError] = useState("");
  const [productError, setProductError] = useState("");
  const [toast, setToast] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [checkingMessage, setCheckingMessage] = useState("Đang kiểm tra phiên đăng nhập an toàn…");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [isLoadingShop, setIsLoadingShop] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [hidingProductIds, setHidingProductIds] = useState<string[]>([]);
  const accessTokenRef = useRef<string | null>(null);
  const accessTokenExpiresAtRef = useRef<string | null>(null);
  const refreshFlight = useRef<Promise<string | null> | null>(null);
  const bootStarted = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 4200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const recordRequest = useCallback((entry: RequestEntry) => {
    setRequests((current) => [entry, ...current].slice(0, 8));
  }, []);

  const clearSession = useCallback(() => {
    accessTokenRef.current = null;
    accessTokenExpiresAtRef.current = null;
    setHasSessionToken(false);
    setUser(null);
    setInShop(false);
  }, []);

  const onSessionExpired = useCallback(() => {
    clearSession();
    showToast("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  }, [clearSession, showToast]);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshFlight.current) return refreshFlight.current;
    if (!readCookie("XSRF-TOKEN")) return null;
    refreshFlight.current = (async () => {
      try {
        const data = await apiRequest<SessionData>("/auth/refresh", { method: "POST", csrf: true, retry: false }, null, recordRequest, async () => null, () => undefined);
        if (typeof data?.accessToken !== "string") return null;
        accessTokenRef.current = data.accessToken;
        accessTokenExpiresAtRef.current = typeof data.expiresAt === "string" ? data.expiresAt : null;
        setHasSessionToken(true);
        if (data.user) setUser(data.user);
        return data.accessToken;
      } catch { return null; }
    })();
    try { return await refreshFlight.current; }
    finally { refreshFlight.current = null; }
  }, [recordRequest]);

  const loadShop = useCallback(async (token: string) => {
    setIsLoadingShop(true);
    setShopError("");
    try {
      const [homepage, catalog] = await Promise.all([
        apiRequest<{ user?: User; shopName?: string }>("/homepage", { auth: true }, token, recordRequest, refreshAccessToken, onSessionExpired),
        apiRequest<{ products?: unknown[] }>("/products", { auth: true }, token, recordRequest, refreshAccessToken, onSessionExpired)
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
      setHasSessionToken(true);
      setInShop(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tải không gian học tập.";
      setShopError(message);
      throw error;
    } finally {
      setIsLoadingShop(false);
    }
  }, [onSessionExpired, recordRequest, refreshAccessToken]);

  const establishSession = useCallback(async (data: SessionData) => {
    if (typeof data?.accessToken !== "string") throw new Error("API không trả về access token hợp lệ.");
    accessTokenRef.current = data.accessToken;
    accessTokenExpiresAtRef.current = typeof data.expiresAt === "string" ? data.expiresAt : null;
    setHasSessionToken(true);
    if (data.user) setUser(data.user);
    await loadShop(data.accessToken);
  }, [loadShop]);

  const retryShopLoad = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token) return;
    try { await loadShop(token); setAuthError(""); }
    catch (error) { setAuthError(error instanceof Error ? error.message : "Không thể tải không gian học tập."); }
  }, [loadShop]);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    let active = true;
    const restore = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");
      if (code || oauthError) window.history.replaceState(null, "", `${url.pathname}${url.hash}`);
      if (code) {
        setCheckingMessage("Đang hoàn tất đăng nhập OAuth…");
        try {
          const data = await apiRequest<SessionData>("/auth/oauth/exchange", { method: "POST", body: { code }, retry: false }, null, recordRequest, refreshAccessToken, () => undefined);
          if (active) await establishSession(data);
        } catch (error) {
          if (active) setAuthError(error instanceof Error ? error.message : "OAuth không hoàn tất. Hãy thử lại.");
        } finally { if (active) setIsCheckingSession(false); }
        return;
      }
      if (oauthError) {
        if (active) { setAuthError("Đăng nhập OAuth chưa hoàn tất. Bạn có thể thử lại."); setIsCheckingSession(false); }
        return;
      }
      if (readCookie("XSRF-TOKEN")) {
        setCheckingMessage("Đang khôi phục phiên học tập…");
        const token = await refreshAccessToken();
        if (active && token) {
          try { await loadShop(token); }
          catch (error) { setAuthError(error instanceof Error ? error.message : "Không thể tải shop."); }
        } else if (active) {
          setAuthError("Không thể khôi phục phiên. Hãy đăng nhập lại.");
        }
      }
      if (active) setIsCheckingSession(false);
    };
    void restore();
    return () => { active = false; };
  }, [establishSession, loadShop, recordRequest, refreshAccessToken]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setAuthError("");
    setIsSubmittingAuth(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) { setAuthError("Vui lòng nhập email và mật khẩu."); setIsSubmittingAuth(false); return; }
    try {
      if (authMode === "signup") {
        await apiRequest("/auth/signup", { method: "POST", body: { email, password }, retry: false }, null, recordRequest, refreshAccessToken, () => undefined);
        setAuthMode("signin");
        showToast("Tạo tài khoản thành công. Đăng nhập để tiếp tục.");
      } else {
        const data = await apiRequest<SessionData>("/auth/signin", { method: "POST", body: { email, password }, retry: false }, null, recordRequest, refreshAccessToken, () => undefined);
        await establishSession(data);
        showToast("Đăng nhập thành công.");
      }
      formElement.reset();
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Không thể hoàn tất yêu cầu."); }
    finally {
      const passwordField = formElement.elements.namedItem("password");
      if (passwordField instanceof HTMLInputElement) passwordField.value = "";
      setIsSubmittingAuth(false);
    }
  }

  const startOAuth = (provider: "google" | "facebook") => {
    window.location.assign(new URL(`/oauth2/authorization/${provider}`, window.location.origin).toString());
  };

  function startDemo() {
    clearSession();
    setAuthError("");
    setShopError("");
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
    if (demoMode) { setDemoMode(false); setInShop(false); return; }
    setIsLoggingOut(true);
    try {
      let token = accessTokenRef.current;
      const expiresAt = accessTokenExpiresAtRef.current ? Date.parse(accessTokenExpiresAtRef.current) : Number.NaN;
      if (!token) throw new Error("Không tìm thấy access token trong phiên hiện tại.");
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        token = await refreshAccessToken();
        if (!token) throw new Error("Không thể làm mới phiên trước khi đăng xuất. Hãy thử lại.");
      }
      await apiRequest("/auth/sessions", { method: "DELETE", auth: true, csrf: true }, token, recordRequest, refreshAccessToken, () => undefined);
      clearSession();
      setDemoMode(false);
      setShopError("");
      showToast("Máy chủ đã xác nhận thu hồi phiên đăng nhập.");
    } catch (error) {
      showToast(`Chưa xác nhận đăng xuất; phiên vẫn đang mở để bạn có thể thử lại. ${error instanceof Error ? error.message : ""}`);
    } finally { setIsLoggingOut(false); }
  }

  async function hideProduct(product: Product) {
    if (demoMode) {
      setProducts((items) => items.filter((item) => item.id !== product.id));
      showToast("Đã ẩn khỏi bản xem trước; không gọi API.");
      return;
    }
    setHidingProductIds((ids) => [...ids, product.id]);
    try {
      await apiRequest(`/products/${encodeURIComponent(product.id)}`, { method: "DELETE", auth: true }, accessTokenRef.current, recordRequest, refreshAccessToken, onSessionExpired);
      const hidden = new Set(readArray("csrfJwtShop.hiddenProductIds").filter((item): item is string => typeof item === "string"));
      hidden.add(product.id);
      let stored = true;
      try { localStorage.setItem("csrfJwtShop.hiddenProductIds", JSON.stringify([...hidden])); } catch { stored = false; }
      setProducts((items) => items.filter((item) => item.id !== product.id));
      showToast(stored ? "API đã xác nhận ẩn sản phẩm trên giao diện." : "API đã xác nhận; trình duyệt không lưu được trạng thái ẩn cho lần tải sau.");
    } catch (error) { showToast(error instanceof Error ? error.message : "Không thể ẩn sản phẩm."); }
    finally { setHidingProductIds((ids) => ids.filter((id) => id !== product.id)); }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setProductError("");
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    const description = String(fields.get("description") ?? "").trim();
    const priceValue = Number(fields.get("price"));
    if (!name || name.length > 100 || description.length > 500 || !Number.isFinite(priceValue) || priceValue < 0) { setProductError("Hãy nhập tên và mô tả trong giới hạn cho phép, cùng giá bằng 0 hoặc lớn hơn."); return; }
    const product: Product = { id: `prd_local_${window.crypto?.randomUUID?.() ?? Date.now().toString(36)}`, name, description, price: priceValue, currency: "USD", localAddition: true };
    if (demoMode) {
      setProducts((items) => [product, ...items]);
      setRequests((items) => [{ method: "POST", path: "/api/v1/products", status: "DEMO", note: "Sản phẩm demo được thêm" }, ...items].slice(0, 8));
      setModalOpen(false);
      formElement.reset();
      showToast("Đã thêm vào bản xem trước; không gọi API.");
      return;
    }
    setIsAddingProduct(true);
    try {
      const data = await apiRequest<{ product?: unknown } | unknown>("/products", { method: "POST", body: { id: product.id, name: product.name, description: product.description, price: product.price, currency: product.currency, imageUrl: null }, auth: true }, accessTokenRef.current, recordRequest, refreshAccessToken, onSessionExpired);
      const accepted = normalizeProduct((data as { product?: unknown })?.product ?? data);
      if (!accepted) throw new Error("API phản hồi dữ liệu sản phẩm không đúng contract.");
      const stored = readArray("csrfJwtShop.addedProducts").map((item) => normalizeProduct(item)).filter((item): item is Product => item !== null);
      let persisted = true;
      try { localStorage.setItem("csrfJwtShop.addedProducts", JSON.stringify([{ ...accepted, localAddition: true }, ...stored])); } catch { persisted = false; }
      setProducts((items) => [{ ...accepted, localAddition: true }, ...items.filter((item) => item.id !== accepted.id)]);
      setModalOpen(false);
      formElement.reset();
      showToast(persisted ? "API đã xác nhận thêm sản phẩm." : "API đã xác nhận; trình duyệt không lưu được sản phẩm cho lần tải sau.");
    } catch (error) { setProductError(error instanceof Error ? error.message : "Không thể thêm sản phẩm."); }
    finally { setIsAddingProduct(false); }
  }

  const requestDemo = (path: string, method: string, note: string) => setRequests((items) => [{ method, path, status: "DEMO", note }, ...items].slice(0, 8));
  const canRetryShop = hasSessionToken && !inShop && !isCheckingSession;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); if (demoMode) { setDemoMode(false); setInShop(false); } else if (accessTokenRef.current) setInShop(true); else setInShop(false); }} aria-label="Auth Lab — trang đầu">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <span><span className="brand-name">Auth Lab</span><span className="brand-sub">JWT & OAuth learning shop</span></span>
        </a>
        <span className="prototype-label">Next.js · Frontend</span>
      </header>
      {!inShop ? <AuthScreen
        mode={authMode} onModeChange={(mode) => { setAuthMode(mode); setAuthError(""); }} onSubmit={submitAuth}
        error={authError} isSubmitting={isSubmittingAuth} isLoadingShop={isLoadingShop}
        isCheckingSession={isCheckingSession} checkingMessage={checkingMessage}
        canRetryShop={canRetryShop} onRetryShop={retryShopLoad} onStartDemo={startDemo} onStartOAuth={startOAuth}
      /> : <ShopWorkspace
        demoMode={demoMode} shopName={shopName} user={user} products={products} requests={requests}
        isLoading={isLoadingShop} loadError={shopError} isLoggingOut={isLoggingOut} hidingProductIds={hidingProductIds}
        onLogout={logout} onRetryLoad={retryShopLoad} onAddClick={() => { setProductError(""); setModalOpen(true); }}
        onHide={hideProduct} onRequestDemo={requestDemo}
      />}
      <AddProductDialog open={modalOpen} demoMode={demoMode} error={productError} isSubmitting={isAddingProduct} onClose={() => { setModalOpen(false); setProductError(""); }} onSubmit={addProduct} />
      <ToastMessage message={toast} />
    </div>
  );
}


function ToastMessage({ message }: { message: string }) {
  const [displayMessage, setDisplayMessage] = useState(message);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    let exitTimer = 0;
    if (message) {
      setDisplayMessage(message);
      frame = window.requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
      const exitDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
      exitTimer = window.setTimeout(() => setDisplayMessage(""), exitDelay);
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (exitTimer) window.clearTimeout(exitTimer);
    };
  }, [message]);

  if (!displayMessage) return null;
  return <div className={`toast ${isVisible ? "show" : "hide"}`} role="status" aria-live="polite">{displayMessage}</div>;
}
