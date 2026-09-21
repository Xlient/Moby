declare module 'react-native' {
  import type { CSSProperties, ReactNode } from 'react';

  type StyleProp<T> = T | T[] | null | undefined | false;

  interface ViewStyle {
    [key: string]: unknown;
  }

  interface TextStyle extends ViewStyle {}
  interface ImageStyle extends ViewStyle {}

  interface ViewProps {
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    [key: string]: unknown;
  }

  interface ScrollViewProps extends ViewProps {
    contentContainerStyle?: StyleProp<ViewStyle>;
    horizontal?: boolean;
  }

  export const View: React.ComponentType<ViewProps>;
  export const ScrollView: React.ComponentType<ScrollViewProps>;
  export const Text: React.ComponentType<ViewProps>;
  export const Pressable: React.ComponentType<ViewProps & { onPress?: () => void }>;

  interface FlatListProps<T> {
    data: T[];
    renderItem: (info: { item: T; index: number }) => React.ReactNode;
    keyExtractor?: (item: T, index: number) => string;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
    ListFooterComponent?: React.ComponentType | React.ReactElement | null;
    ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
    ItemSeparatorComponent?: React.ComponentType | null;
    numColumns?: number;
    horizontal?: boolean;
    [key: string]: unknown;
  }

  export class FlatList<T = any> extends React.Component<FlatListProps<T>> {}

  interface SectionListSection<T> {
    data: T[];
    key?: string;
    renderItem?: (info: { item: T; index: number; section: SectionListSection<T> }) => React.ReactNode;
    [key: string]: unknown;
  }

  interface SectionListProps<T> {
    sections: SectionListSection<T>[];
    renderItem?: (info: { item: T; index: number; section: SectionListSection<T> }) => React.ReactNode;
    renderSectionHeader?: (info: { section: SectionListSection<T> }) => React.ReactNode;
    keyExtractor?: (item: T, index: number) => string;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    stickySectionHeadersEnabled?: boolean;
    [key: string]: unknown;
  }

  export class SectionList<T = any> extends React.Component<SectionListProps<T>> {}

  type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

  export const StyleSheet: {
    create<T extends NamedStyles<T>>(styles: T): T;
    flatten: (style: StyleProp<ViewStyle>) => ViewStyle;
  };

  export const Dimensions: {
    get(dim: 'window' | 'screen'): { width: number; height: number };
  };

  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
    select<T>(specifics: { ios?: T; android?: T; web?: T; default?: T }): T;
  };

  export const Animated: {
    View: React.ComponentType<ViewProps>;
    Text: React.ComponentType<ViewProps>;
    Value: new (value: number) => { setValue(value: number): void };
    timing: (
      value: unknown,
      config: { toValue: number; duration?: number; useNativeDriver?: boolean },
    ) => { start(callback?: () => void): void };
  };

  export type LayoutChangeEvent = {
    nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
  };
}
