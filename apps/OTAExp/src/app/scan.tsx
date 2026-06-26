import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
// Type-only imports keep `react-native-ble-plx` out of the web bundle. The
// shared session is loaded lazily on native platforms.
import type { BleSession, ScannedDevice } from '@/services/ble';

const ACCENT = '#3c87f7';

export default function ScanScreen() {
  const theme = useTheme();
  const sessionRef = useRef<BleSession | null>(null);

  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Record<string, ScannedDevice>>({});
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const ensureSession = useCallback(async (): Promise<BleSession> => {
    if (sessionRef.current) {
      return sessionRef.current;
    }
    const { bleSession } = await import('@/services/ble');
    sessionRef.current = bleSession;
    return bleSession;
  }, []);

  // Track the shared connection so the connected state survives tab switches
  // and reflects connections/disconnections made elsewhere (e.g. during OTA).
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const session = await ensureSession();
      if (!active) {
        return;
      }
      unsubscribe = session.subscribe((device) =>
        setConnectedId(device?.id ?? null),
      );
    })();
    return () => {
      active = false;
      unsubscribe?.();
      sessionRef.current?.stopScan();
    };
  }, [ensureSession]);

  const startScan = useCallback(async () => {
    setStatus(null);
    setDevices({});
    try {
      const session = await ensureSession();
      await session.startScan({
        onDeviceFound: (device) =>
          setDevices((prev) => {
            const previous = prev[device.id];
            // Later advertisements may omit the name; keep the first one seen.
            const name = device.name ?? previous?.name ?? null;
            return { ...prev, [device.id]: { ...device, name } };
          }),
        onScanningChange: setScanning,
        onError: (error) => setStatus(error.message),
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [ensureSession]);

  const stopScan = useCallback(() => {
    sessionRef.current?.stopScan();
  }, []);

  const toggleScan = useCallback(() => {
    if (scanning) {
      stopScan();
    } else {
      void startScan();
    }
  }, [scanning, startScan, stopScan]);

  const connect = useCallback(
    async (device: ScannedDevice) => {
      if (connectingId || connectedId === device.id) {
        return;
      }
      setConnectingId(device.id);
      setStatus(`Connecting to ${device.name ?? device.id} ...`);
      try {
        const session = await ensureSession();
        const connected = await session.connect(device.id);
        setStatus(
          `Connected to ${connected.name ?? connected.id}. ` +
            'Open the OTA tab to flash firmware.',
        );
      } catch (error) {
        setStatus(
          `Connection failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        setConnectingId(null);
      }
    },
    [connectedId, connectingId, ensureSession],
  );

  const disconnect = useCallback(async () => {
    try {
      await sessionRef.current?.disconnect();
      setStatus('Disconnected');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const deviceList = useMemo(
    () =>
      Object.values(devices).sort((a, b) => {
        // Named devices first, then strongest signal.
        if (!!a.name !== !!b.name) {
          return a.name ? -1 : 1;
        }
        return (b.rssi ?? -999) - (a.rssi ?? -999);
      }),
    [devices],
  );

  const connectedDevice: ScannedDevice | undefined = connectedId
    ? (devices[connectedId] ?? {
        id: connectedId,
        name: null,
        rssi: null,
        isConnectable: null,
      })
    : undefined;

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.fill}>
        <SafeAreaView style={styles.centered}>
          <ThemedText type="subtitle">Devices</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Bluetooth scanning requires a native build (a development build or a
            release build), and is not available on the web.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Devices</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Scan for nearby Bluetooth Low Energy devices, then tap one to pair
            and connect.
          </ThemedText>

          <Pressable
            accessibilityRole="button"
            onPress={toggleScan}
            style={({ pressed }) => [
              styles.scanButton,
              {
                backgroundColor: scanning ? theme.backgroundSelected : ACCENT,
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            {scanning && <ActivityIndicator color={theme.text} size="small" />}
            <ThemedText
              type="smallBold"
              style={scanning ? undefined : styles.scanButtonLabel}>
              {scanning ? 'Scanning ...  Tap to stop' : 'Scan for devices'}
            </ThemedText>
          </Pressable>

          {connectedDevice && (
            <ThemedView type="backgroundElement" style={styles.connectedCard}>
              <ThemedView style={styles.connectedInfo}>
                <ThemedText type="smallBold">
                  Connected{connectedDevice.name ? `: ${connectedDevice.name}` : ''}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary">
                  {connectedDevice.id}
                </ThemedText>
              </ThemedView>
              <Pressable
                accessibilityRole="button"
                onPress={disconnect}
                style={({ pressed }) => [
                  styles.disconnectButton,
                  {
                    backgroundColor: theme.backgroundSelected,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <ThemedText type="smallBold">Disconnect</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {status && (
            <ThemedText type="small" themeColor="textSecondary">
              {status}
            </ThemedText>
          )}

          <ThemedView style={styles.list}>
            {deviceList.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {scanning ? 'Searching ...' : 'No devices yet. Start a scan.'}
              </ThemedText>
            ) : (
              deviceList.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  connected={connectedId === device.id}
                  connecting={connectingId === device.id}
                  disabled={connectingId !== null}
                  onPress={() => void connect(device)}
                />
              ))
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function DeviceRow({
  device,
  connected,
  connecting,
  disabled,
  onPress,
}: {
  device: ScannedDevice;
  connected: boolean;
  connecting: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || connected}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <ThemedView type="backgroundElement" style={styles.rowInner}>
        <ThemedView style={styles.rowText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {device.name ?? '(unnamed device)'}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {device.id}
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.rowMeta}>
          {device.rssi != null && (
            <ThemedText type="small" themeColor="textSecondary">
              {device.rssi} dBm
            </ThemedText>
          )}
          {connecting ? (
            <ActivityIndicator color={theme.text} size="small" />
          ) : (
            <ThemedText
              type="smallBold"
              style={{ color: connected ? '#33b864' : ACCENT }}>
              {connected ? 'Connected' : 'Connect'}
            </ThemedText>
          )}
        </ThemedView>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
  scanButtonLabel: {
    color: '#ffffff',
  },
  connectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  connectedInfo: {
    flex: 1,
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
  disconnectButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    borderRadius: Spacing.three,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
});
