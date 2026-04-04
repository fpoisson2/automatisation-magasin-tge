import { useEffect, useRef, useState } from "react";

export function useSSE(url, handlers = {}) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("connected", () => setConnected(true));
    es.onerror = () => setConnected(false);

    for (const [event, handler] of Object.entries(handlers)) {
      es.addEventListener(event, (e) => handler(JSON.parse(e.data)));
    }

    return () => es.close();
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  return connected;
}
