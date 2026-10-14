// JS face of the native Bluetooth radio (android/…/MobyMeshModule.kt).
// Optional: missing in Expo Go, on web and in tests, where `MobyMesh` is null and the
// app simply doesn't offer the mesh.
import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface RadioState {
  supported: boolean;
  enabled: boolean;
  /** Some phones can listen but can't advertise: they can still receive alerts. */
  canAdvertise?: boolean;
  scanning?: boolean;
  advertising?: boolean;
  reason?: 'no_bluetooth' | 'no_ble' | 'bluetooth_off' | 'ios_not_implemented' | null;
}

export interface PacketEvent {
  /** The 24 raw bytes (0-255). */
  bytes: number[];
  rssi: number;
  /** Randomised by Android (often per advertisement): not an identity, not even a stable count. */
  device: string;
}

export interface RadioErrorEvent {
  where: 'scan' | 'advertise';
  code: number;
}

type Events = {
  onPacket(event: PacketEvent): void;
  onError(event: RadioErrorEvent): void;
  /** Bluetooth switched off or on. The module resumes scanning and advertising by itself. */
  onStateChange(event: { enabled: boolean }): void;
};

declare class MobyMeshNative extends NativeModule<Events> {
  getState(): RadioState;
  startScanning(): Promise<void>;
  stopScanning(): void;
  advertise(bytes: number[]): Promise<void>;
  stopAdvertising(): void;
}

export const MobyMesh = requireOptionalNativeModule<MobyMeshNative>('MobyMesh');
