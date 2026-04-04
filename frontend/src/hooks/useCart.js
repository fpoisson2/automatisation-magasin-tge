import { useState, useCallback } from "react";

function loadCart() {
  try { return JSON.parse(localStorage.getItem("cart") || "[]"); }
  catch { return []; }
}

export function useCart() {
  const [cart, setCart] = useState(loadCart);

  const save = (next) => {
    setCart(next);
    localStorage.setItem("cart", JSON.stringify(next));
  };

  const addItem = useCallback((articleNo, description, prix, localisation) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.article_no === articleNo);
      const next = existing
        ? prev.map((c) => c.article_no === articleNo ? { ...c, quantity: c.quantity + 1 } : c)
        : [...prev, { article_no: articleNo, description, prix, localisation, quantity: 1 }];
      localStorage.setItem("cart", JSON.stringify(next));
      return next;
    });
  }, []);

  const removeItem = useCallback((articleNo) => {
    setCart((prev) => {
      const next = prev.filter((c) => c.article_no !== articleNo);
      localStorage.setItem("cart", JSON.stringify(next));
      return next;
    });
  }, []);

  const updateQty = useCallback((articleNo, delta) => {
    setCart((prev) => {
      const next = prev.map((c) =>
        c.article_no === articleNo ? { ...c, quantity: c.quantity + delta } : c
      ).filter((c) => c.quantity > 0);
      localStorage.setItem("cart", JSON.stringify(next));
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    save([]);
  }, []);

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);

  return { cart, addItem, removeItem, updateQty, clearCart, totalItems };
}
