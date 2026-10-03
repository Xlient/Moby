import { registerRootComponent } from 'expo';
import { Root } from './src/Root';

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root)
// and sets the environment up correctly for Expo Go, dev builds and release builds.
registerRootComponent(Root);
