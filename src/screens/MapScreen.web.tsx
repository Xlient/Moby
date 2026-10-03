import { DiagramMapScreen } from './DiagramMapScreen';

interface MapScreenProps {
  onBack: () => void;
  onAlertDetail: (alertId: string) => void;
}

// Web: react-native-maps has no web build, so the full map is the drawn diagram.
export function MapScreen(props: MapScreenProps) {
  return <DiagramMapScreen {...props} />;
}
