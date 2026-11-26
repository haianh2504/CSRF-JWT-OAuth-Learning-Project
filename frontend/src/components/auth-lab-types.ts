export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  localAddition?: boolean;
};

export type User = { id?: string; email?: string; loginMethod?: string; provider?: string | null };
export type RequestEntry = { method: string; path: string; status: string; note: string };
export type AuthMode = "signin" | "signup";
