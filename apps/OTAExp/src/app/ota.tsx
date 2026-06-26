import type { OtaProgress } from '@gtdev/rtn-libota';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
// Type-only imports keep the native modules out of the web bundle. The
// implementations are loaded lazily on native platforms.
import type { ScannedDevice } from '@/services/ble';
import type { BleOtaClient } from '@/services/ota/ble-ota-client';

export default function OtaScreen() {
  const theme = useTheme();
  const [firmwarePath, setFirmwarePath] = useState('');
  const [firmwareName, setFirmwareName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OtaProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<ScannedDevice | null>(
    null,
  );

  const clientRef = useRef<BleOtaClient | null>(null);

  const appendLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `${stamp}  ${message}`]);
  }, []);

  // Reflect the shared BLE connection established on the Devices tab.
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const { bleSession } = await import('@/services/ble');
      if (!active) {
        return;
      }
      unsubscribe = bleSession.subscribe(setConnectedDevice);
    })();
    return () => {
      active = false;
      unsubscribe?.();
      void clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const startUpdate = useCallback(async () => {
    if (running) {
      return;
    }
    if (!connectedDevice) {
      appendLog('Connect to a device on the Devices tab first.');
      return;
    }
    if (!firmwarePath.trim()) {
      appendLog('Please choose a firmware file.');
      return;
    }

    setRunning(true);
    setProgress(null);
    setLogs([]);

    try {
      const { BleOtaClient } = await import('@/services/ota/ble-ota-client');
      const client = new BleOtaClient({
        onProgress: setProgress,
        onLog: appendLog,
      });
      clientRef.current = client;

      await client.update({
        firmwarePath: firmwarePath.trim(),
        version: version.trim(),
      });
    } catch (error) {
      appendLog(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await clientRef.current?.destroy();
      clientRef.current = null;
      setRunning(false);
    }
  }, [appendLog, connectedDevice, firmwarePath, running, version]);

  const cancelUpdate = useCallback(() => {
    clientRef.current?.cancel();
    appendLog('Cancellation requested ...');
  }, [appendLog]);

  const pickFirmware = useCallback(async () => {
    if (running) {
      return;
    }
    try {
      const { pickFirmwareFile } = await import('@/services/ota/firmware-picker');
      const selected = await pickFirmwareFile();
      if (selected) {
        setFirmwarePath(selected.path);
        setFirmwareName(selected.name);
        const sizeLabel =
          selected.size != null ? ` (${formatBytes(selected.size)})` : '';
        appendLog(`Selected firmware: ${selected.name}${sizeLabel}`);
      }
    } catch (error) {
      appendLog(
        `File picker failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [appendLog, running]);

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.fill}>
        <SafeAreaView style={styles.centered}>
          <ThemedText type="subtitle">BLE OTA</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Bluetooth OTA requires a native build (a development build or a
            release build), and is not available on the web.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const sentPercent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : 0;

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">BLE OTA</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Push firmware to the device over BLE. The C++ module builds every
            packet and tracks progress; this screen only moves bytes.
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.deviceCard}>
            <ThemedText type="small" themeColor="textSecondary">
              Target device
            </ThemedText>
            {connectedDevice ? (
              <>
                <ThemedText type="smallBold">
                  {connectedDevice.name ?? '(unnamed device)'}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary">
                  {connectedDevice.id}
                </ThemedText>
              </>
            ) : (
              <ThemedText type="small">
                Not connected. Open the Devices tab to scan and connect, then
                come back to flash firmware.
              </ThemedText>
            )}
          </ThemedView>
          <ThemedView style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Firmware file
            </ThemedText>
            <ThemedText type="small" numberOfLines={2}>
              {firmwareName || 'No file selected'}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              disabled={running}
              onPress={() => void pickFirmware()}
              style={({ pressed }) => [
                styles.pickButton,
                {
                  backgroundColor: theme.backgroundElement,
                  opacity: running ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}>
              <ThemedText type="smallBold">Choose file</ThemedText>
            </Pressable>
          </ThemedView>
          <Field
            label="Version"
            value={version}
            onChangeText={setVersion}
            placeholder="1.0.0"
            editable={!running}
            autoCapitalize="none"
          />

          <ThemedView style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={running || !connectedDevice}
              onPress={startUpdate}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: '#3c87f7',
                  opacity: running || !connectedDevice ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                {running ? 'Updating ...' : 'Start OTA'}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!running}
              onPress={cancelUpdate}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: theme.backgroundSelected,
                  opacity: !running ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}>
              <ThemedText type="smallBold">Cancel</ThemedText>
            </Pressable>
          </ThemedView>

          {progress && (
            <ThemedView type="backgroundElement" style={styles.progressCard}>
              <ThemedText type="smallBold">
                {progress.phase.toUpperCase()}
              </ThemedText>
              <ProgressBar
                percent={sentPercent}
                trackColor={theme.backgroundSelected}
                fillColor="#3c87f7"
              />
              <ThemedText type="small" themeColor="textSecondary">
                Sent {formatBytes(progress.bytesSent)} / {formatBytes(progress.totalBytes)} ({sentPercent}%)
              </ThemedText>
              <ProgressBar
                percent={progress.percent}
                trackColor={theme.backgroundSelected}
                fillColor="#33b864"
              />
              <ThemedText type="small" themeColor="textSecondary">
                Confirmed {formatBytes(progress.bytesConfirmed)} / {formatBytes(progress.totalBytes)} ({progress.percent}%)
              </ThemedText>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.logCard}>
            <ThemedText type="smallBold">Log</ThemedText>
            {logs.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No activity yet.
              </ThemedText>
            ) : (
              logs.map((line, index) => (
                <ThemedText key={index} type="code">
                  {line}
                </ThemedText>
              ))
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

function Field({ label, ...inputProps }: FieldProps) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        {...inputProps}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement },
        ]}
      />
    </ThemedView>
  );
}

function ProgressBar({
  percent,
  trackColor,
  fillColor,
}: {
  percent: number;
  trackColor: string;
  fillColor: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <ThemedView style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <ThemedView
        style={[styles.progressFill, { width: `${clamped}%`, backgroundColor: fillColor }]}
      />
    </ThemedView>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
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
  field: {
    gap: Spacing.one,
  },
  deviceCard: {
    gap: Spacing.half,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  pickButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  buttonLabel: {
    color: '#ffffff',
  },
  progressCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  logCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
