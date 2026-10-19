import { DiagramMapScreen } from './DiagramMapScreen';

interface MapScreenProps {
  onBack: () => void;
  onAlertDetail: (alertId: string) => void;
  /** Native only: the drawn diagram has no long-press; web uses place search. */
  onLongPressPoint?: (point: { lat: number; lon: number }) => void;
}

// Web: react-native-maps has no web build, so the full map is the drawn diagram.
export function MapScreen({ onBack, onAlertDetail }: MapScreenProps) {
  return <DiagramMapScreen onBack={onBack} onAlertDetail={onAlertDetail} />;
}
