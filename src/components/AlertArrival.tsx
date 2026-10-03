import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, AccessibilityInfo } from 'react-native';

interface AlertArrivalProps {
  isNew: boolean;
  children: ReactNode;
}

const DURATION_MS = 400;

/** Fades + slides a newly arrived alert into place (skipped with reduced motion). */
export function AlertArrival({ isNew, children }: AlertArrivalProps) {
  const progress = useRef(new Animated.Value(isNew ? 0 : 1)).current;

  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        progress.setValue(1);
        return;
      }
      Animated.timing(progress, {
        toValue: 1,
        duration: DURATION_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [isNew, progress]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
