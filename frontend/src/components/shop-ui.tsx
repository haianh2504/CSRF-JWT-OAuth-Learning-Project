import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Product, RequestEntry, User } from "./auth-lab-types";

export function ShopWorkspace({
  demoMode, shopName, user, products, requests, isLoading, loadError,
  isLoggingOut, hidingProductIds, onLogout, onRetryLoad, onAddClick, onHide, onRequestDemo
}: {
  demoMode: boolean; shopName: string; user: User | null; products: Product[]; requests: RequestEntry[];
  isLoading: boolean; loadError: string; isLoggingOut: boolean; hidingProductIds: string[];
  onLogout: () => void; onRetryLoad: () => void; onAddClick: () => void;
  onHide: (product: Product) => void; onRequestDemo: (path: string, method: string, note: string) => void;
}) {
  return (
    <main className="view active">
      <div className="workbench-heading">
        <div><span className="eyebrow"><span className="eyebrow-dot" /> KHÔNG GIAN THỰC HÀNH</span><h1>{demoMode ? "Demo Shop" : shopName}</h1><p>{demoMode ? "Catalog và request trong chế độ này được mô phỏng." : "Theo dõi catalog API và request đã gửi."}</p></div>
        <div className="user-controls"><span className="session-pill"><span className="dot" />{demoMode ? "Phiên demo · chưa xác thực" : `Đã xác thực · ${user?.email ?? "tài khoản"}`}</span><button type="button" className="secondary-button" onClick={onLogout} disabled={isLoggingOut}>{isLoggingOut ? "Đang đăng xuất…" : demoMode ? "Thoát bản xem trước" : "Đăng xuất"}</button></div>
      </div>
      <div className="workspace">
        <section className="shop-panel" aria-busy={isLoading}>
          <div className="section-heading"><div><h2>Sản phẩm để khám phá</h2><p>Catalog nhỏ để bạn tập trung vào luồng xác thực.</p></div><div className="catalog-tools"><span className="catalog-count">{isLoading ? "Đang tải…" : `${products.length} sản phẩm`}</span><button className="primary-button" type="button" onClick={onAddClick} disabled={isLoading || Boolean(loadError)}>＋ Thêm sản phẩm</button></div></div>
          {loadError ? <div className="shop-state" role="alert"><p>{loadError}</p><button type="button" className="secondary-button" onClick={onRetryLoad}>Thử lại</button></div> : isLoading ? <div className="shop-state" role="status"><span className="loading-indicator" aria-hidden="true" />Đang tải catalog và thông tin shop…</div> : <ProductGrid products={products} demoMode={demoMode} hidingProductIds={hidingProductIds} onHide={onHide} onRequestDemo={onRequestDemo} />}
          <div className="local-banner"><span aria-hidden="true">✓</span><span>{demoMode ? "Bản demo không gọi API và không ghi localStorage." : "Sản phẩm chỉ cập nhật localStorage sau khi API xác nhận; đây không phải dữ liệu authoritative của server."}</span></div>
        </section>
        <RequestInspector demoMode={demoMode} requests={requests} />
      </div>
      <p className="footer-note">{demoMode ? "Mọi request trong màn hình là dữ liệu minh họa." : "Inspector chỉ hiển thị route, status và thông tin tóm tắt."}</p>
    </main>
  );
}

function ProductGrid({ products, demoMode, hidingProductIds, onHide, onRequestDemo }: {
  products: Product[]; demoMode: boolean; hidingProductIds: string[]; onHide: (product: Product) => void;
  onRequestDemo: (path: string, method: string, note: string) => void;
}) {
  if (products.length === 0) return <div className="empty-state">Chưa có sản phẩm hiển thị. Thêm sản phẩm để tiếp tục.</div>;
  return <div className="product-grid">{products.map((product, index) => <article className="product-card" key={product.id}>
    <div className={`product-visual visual-${["blue", "peach", "mint", "lilac"][index % 4]}`} aria-hidden="true">{["👜", "📓", "☕", "💡"][index % 4]}</div>
    <div className="product-meta"><div className="product-topline"><span className="product-name">{product.name}</span><span className="product-price">{formatPrice(product.price, product.currency)}</span></div>
      <p className="product-description">{product.description || "Sản phẩm trong catalog demo."}</p>
      <div className="product-actions"><span className="product-tag">{demoMode ? "Catalog demo" : product.localAddition ? "Mới · lưu trên trình duyệt" : "Catalog API"}</span><button type="button" className="hide-button" disabled={hidingProductIds.includes(product.id)} onClick={() => { if (demoMode) onRequestDemo(`/api/v1/products/${encodeURIComponent(product.id)}`, "DELETE", "Ẩn sản phẩm mô phỏng"); onHide(product); }}>{hidingProductIds.includes(product.id) ? "Đang ẩn…" : "Ẩn khỏi danh sách"}</button></div>
    </div>
  </article>)}</div>;
}

function formatPrice(value: number, currency: string) {
  try { return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value); }
  catch { return `${value} ${currency}`; }
}

export function RequestInspector({ demoMode, requests }: { demoMode: boolean; requests: RequestEntry[] }) {
  const visibleRequests = demoMode && requests.length === 0 ? [{ method: "GET", path: "/api/v1/homepage", status: "DEMO", note: "Dữ liệu minh họa" }] : requests;
  const latest = requests[0];
  return <aside className="inspector-panel" aria-label="Request Inspector">
    <div className="inspector-head"><div className="inspector-title"><span className="inspector-icon" aria-hidden="true">≡</span><div><h2>Request Inspector</h2><p>Không hiển thị token hoặc mật khẩu</p></div></div><span className="demo-badge">{demoMode ? "MÔ PHỎNG" : "API THẬT"}</span></div>
    <div className="inspector-body"><p className="inspector-label"><span>Hoạt động gần đây</span><span>{String(visibleRequests.length).padStart(2, "0")}</span></p>
      <div className="event-list">{visibleRequests.map((item, index) => <div className="event-row" key={`${item.path}-${index}`}><span className="method">{item.method}</span><span className="event-route">{item.path}</span><span className="event-status">{item.status}</span></div>)}{!demoMode && requests.length === 0 && <p className="empty-state">Chưa có request API.</p>}</div>
      <div className="event-detail"><div className="detail-top"><span className="detail-name">{latest?.note ?? (demoMode ? "Bản xem trước" : "Chưa có request API")}</span><span className="http-code">{latest?.status ?? (demoMode ? "DEMO" : "—")}</span></div><div className="request-line"><span>Authorization</span><code>Bearer ••••••••</code></div><div className="request-line"><span>CSRF</span><code>{latest?.path.endsWith("/refresh") || latest?.path.endsWith("/sessions") ? "Proof đã che" : "Không yêu cầu"}</code></div><div className="request-line"><span>Kết quả</span><code>{latest?.note ?? "Dữ liệu minh họa"}</code></div></div>
      <section className="token-learning"><h3>JWT có 3 phần</h3><p>JWS đảm bảo tính toàn vẹn; chữ ký không mã hóa payload.</p><div className="token-parts"><span className="token-part">header</span><span className="token-part">payload</span><span className="token-part">signature</span></div><p className="token-warning">Payload có thể đọc được. Không đưa bí mật vào token.</p></section>
      <div className="session-facts"><div className="fact"><span>Access JWT</span><strong>Trong bộ nhớ · 10 phút</strong></div><div className="fact"><span>Refresh token</span><strong>Cookie HttpOnly · 7 ngày</strong></div></div>
    </div>
  </aside>;
}

export function AddProductDialog({ open, demoMode, error, isSubmitting, onClose, onSubmit }: {
  open: boolean; demoMode: boolean; error: string; isSubmitting: boolean;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [isPresent, setIsPresent] = useState(open);
  const [isVisible, setIsVisible] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let exitTimer = 0;
    if (open) {
      if (!isPresent && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      setIsPresent(true);
      frame = window.requestAnimationFrame(() => {
        setIsVisible(true);
        dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      });
    } else if (isPresent) {
      setIsVisible(false);
      const exitDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;
      exitTimer = window.setTimeout(() => {
        setIsPresent(false);
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
        returnFocusRef.current = null;
      }, exitDelay);
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (exitTimer) window.clearTimeout(exitTimer);
    };
  }, [isPresent, open]);

  if (!isPresent) return null;
  return <div className={`modal-backdrop ${isVisible ? "is-visible" : "is-closing"}`} role="presentation" onMouseDown={(event) => { if (isVisible && event.target === event.currentTarget && !isSubmitting) onClose(); }}>
    <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalDescription" tabIndex={-1}>
      <div className="modal-header"><div><h2 id="modalTitle">{demoMode ? "Thêm sản phẩm demo" : "Thêm sản phẩm"}</h2><p id="modalDescription">{demoMode ? "Sản phẩm chỉ tồn tại trong bản xem trước." : "Sản phẩm được lưu trên trình duyệt sau khi API xác nhận."}</p></div><button className="close-button" type="button" aria-label="Đóng" disabled={isSubmitting || !isVisible} onClick={onClose}>×</button></div>
      <form onSubmit={(event) => { if (!isVisible) { event.preventDefault(); return; } onSubmit(event); }} aria-busy={isSubmitting}><div className="field"><label htmlFor="productName">Tên sản phẩm</label><input id="productName" name="name" maxLength={100} required disabled={isSubmitting || !isVisible} /></div><div className="field"><label htmlFor="productDescription">Mô tả</label><input id="productDescription" name="description" maxLength={500} disabled={isSubmitting || !isVisible} /></div><div className="field"><label htmlFor="productPrice">Giá (USD)</label><input id="productPrice" name="price" type="number" min="0" step="0.01" required disabled={isSubmitting || !isVisible} /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={isSubmitting || !isVisible} onClick={onClose}>Hủy</button><button className="primary-button" type="submit" disabled={isSubmitting || !isVisible}>{isSubmitting ? "Đang lưu…" : demoMode ? "Thêm vào bản demo" : "Thêm sản phẩm"}</button></div></form>
    </section>
  </div>;
}
