import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface AlertArrivalProps {
  isNew: boolean;
  children: ReactNode;
}

const DURATION_MS = 400;

export function AlertArrival({ isNew, children }: AlertArrivalProps) {
  const [animating, setAnimating] = useState(isNew);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setAnimating(false), DURATION_MS);
    return () => clearTimeout(timer);
  }, [animating]);

  const style: CSSProperties = animating
    ? { animation: `alert-arrive ${DURATION_MS}ms ease-out both` }
    : {};

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}
