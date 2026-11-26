import type { FormEvent } from "react";
import type { AuthMode } from "./auth-lab-types";

type AuthScreenProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
  isSubmitting: boolean;
  isLoadingShop: boolean;
  isCheckingSession: boolean;
  checkingMessage: string;
  canRetryShop: boolean;
  onRetryShop: () => void;
  onStartDemo: () => void;
  onStartOAuth: (provider: "google" | "facebook") => void;
};

export function AuthScreen({
  mode, onModeChange, onSubmit, error, isSubmitting, isLoadingShop,
  isCheckingSession, checkingMessage, canRetryShop, onRetryShop, onStartDemo, onStartOAuth
}: AuthScreenProps) {
  if (isCheckingSession) {
    return (
      <main className="view active auth-checking" aria-busy="true" aria-live="polite">
        <div className="auth-check-card"><span className="eyebrow"><span className="eyebrow-dot" /> AUTH LAB</span><h1>Đang kiểm tra phiên của bạn</h1><p>{checkingMessage}</p><span className="loading-indicator" aria-hidden="true" /></div>
      </main>
    );
  }

  return (
    <main className="view active">
      <div className="welcome">
        <section className="welcome-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> AUTHENTICATION, MADE CLEAR</span>
          <h1>Từng bước vững vàng hơn <span className="headline-accent">trong thế giới số.</span></h1>
          <p className="welcome-lede">Khám phá cách đăng nhập, OAuth và JWT hoạt động qua một cửa hàng mô phỏng. Quan sát request và hiểu điều gì xảy ra phía sau mỗi thao tác.</p>
          <div className="learning-chips"><span className="learning-chip"><b>01</b> Sign in</span><span className="learning-chip"><b>02</b> JWT bearer</span><span className="learning-chip"><b>03</b> Refresh safely</span></div>
        </section>
        <section className="auth-card" aria-label="Khu vực đăng nhập">
          <h2 className="auth-heading" key={`${mode}-heading`}>{mode === "signin" ? "Chào bạn, bắt đầu nhé" : "Tạo tài khoản"}</h2>
          <p className="auth-caption" key={`${mode}-caption`}>{mode === "signin" ? "Đăng nhập để mở không gian thực hành của bạn." : "Tạo tài khoản để thực hành luồng đăng ký."}</p>
          <div className="mode-switch" role="tablist" aria-label="Chọn hình thức">
            <button type="button" role="tab" aria-selected={mode === "signin"} className={`mode-button ${mode === "signin" ? "active" : ""}`} onClick={() => onModeChange("signin")}>Đăng nhập</button>
            <button type="button" role="tab" aria-selected={mode === "signup"} className={`mode-button ${mode === "signup" ? "active" : ""}`} onClick={() => onModeChange("signup")}>Tạo tài khoản</button>
          </div>
          <form onSubmit={onSubmit} aria-busy={isSubmitting || isLoadingShop}>
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" placeholder="ban@example.com" required disabled={isSubmitting || isLoadingShop} /></div>
            <div className="field"><label htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Nhập mật khẩu" required disabled={isSubmitting || isLoadingShop} /></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {canRetryShop && <button type="button" className="secondary-button retry-shop" onClick={onRetryShop}>Thử tải không gian học tập lần nữa</button>}
            <button className="primary-button full" type="submit" disabled={isSubmitting || isLoadingShop}>
              {isLoadingShop ? "Đang mở không gian…" : isSubmitting ? "Đang xử lý…" : mode === "signin" ? "Đăng nhập" : "Tạo tài khoản"}
              {!isSubmitting && !isLoadingShop && <span aria-hidden="true">→</span>}
            </button>
          </form>
          <div className="auth-divider">hoặc tiếp tục với</div>
          <div className="oauth-row">
            <button className="oauth-button" type="button" disabled={isSubmitting || isLoadingShop} onClick={() => onStartOAuth("google")}>G&nbsp; Google</button>
            <button className="oauth-button" type="button" disabled={isSubmitting || isLoadingShop} onClick={() => onStartOAuth("facebook")}>f&nbsp; Facebook</button>
          </div>
          <p className="prototype-note"><strong>Kết nối API qua Next.js proxy.</strong> Mật khẩu chỉ gửi tới API đăng nhập; production cần HTTPS.</p>
          <button className="demo-link" type="button" onClick={onStartDemo}>Xem trước shop demo <span aria-hidden="true">↗</span></button>
        </section>
      </div>
      <p className="footer-note">Tài khoản và giao dịch ở đây phục vụ mục đích học tập.</p>
    </main>
  );
}
