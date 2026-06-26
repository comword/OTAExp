#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <string>
#include <Wire.h>
#include <string.h>
#include "esp_sleep.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"

#include "Waveshare_10Dof-D.h"                //ICM20948-BMP280库
#include "Device_Specification.h"             //设备信息服务特征的UUID
#include "SparkFun_BMP581_Arduino_Library.h"  //BMP-580库

// BLE配置
#define SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define BATTERY_SERVICE_UUID "180F"
#define DEVICE_INFO_SERVICE_UUID "180A"

#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_CONFIG "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define BATTERY_CHARACTERISTIC_UUID "2A19"

uint8_t i2cAddress = BMP581_I2C_ADDRESS_DEFAULT;
BMP581 pressureSensor;

// BLE相关
bool gbSenserConnectState = false;
unsigned long lastDataUpdate = 0;
const unsigned long DATA_UPDATE_INTERVAL = 54;  // 蓝牙发送间隔100ms
// 电池相关
uint8_t batteryLevel;  // 电池电量百分比（0-100%）
unsigned long lastBatteryUpdate = 0;
const unsigned long BATTERY_UPDATE_INTERVAL = 600000;  // 电池10分钟更新一次
// IMU相关
extern float q0, q1, q2, q3;

BLEServer* pServer = NULL;
BLECharacteristic* pTxCharacteristic;
BLECharacteristic* pBatteryCharacteristic;
bool deviceConnected = false;

// ===================== BLE OTA =====================
// GATT service + protocol that mirror the host tool (Python bleak pusher and
// the React Native C++ engine). Firmware is streamed into the inactive OTA
// partition via the ESP-IDF esp_ota_* APIs and booted on FINISH.
#define OTA_SERVICE_UUID "fdec0001-8e10-4a5f-b8a3-1f2a3b4c5d6e"
#define OTA_CTRL_UUID "fdec0002-8e10-4a5f-b8a3-1f2a3b4c5d6e"  // write: commands
#define OTA_DATA_UUID \
  "fdec0003-8e10-4a5f-b8a3-1f2a3b4c5d6e"  // write: firmware chunks
#define OTA_STATUS_UUID \
  "fdec0004-8e10-4a5f-b8a3-1f2a3b4c5d6e"  // notify: status

// Control opcodes (first byte of an OTA_CTRL write).
static const uint8_t OTA_CMD_START = 0x01;
static const uint8_t OTA_CMD_FINISH = 0x03;

// Status codes (first byte of an OTA_STATUS notification).
static const uint8_t OTA_ST_READY = 0x10;
static const uint8_t OTA_ST_PROGRESS = 0x11;  // + uint32 LE bytes written
static const uint8_t OTA_ST_ERROR = 0x20;     // + uint8 error code
static const uint8_t OTA_ST_FINISHED = 0x30;

// START payload: [CMD_START][uint32 LE total size][version, 32 bytes].
static const size_t OTA_VERSION_LEN = 32;
static const size_t OTA_START_MIN_LEN = 1 + 4;

// Error codes carried by OTA_ST_ERROR.
static const uint8_t OTA_ERR_BAD_START = 1;
static const uint8_t OTA_ERR_NO_PARTITION = 2;
static const uint8_t OTA_ERR_BEGIN = 3;
static const uint8_t OTA_ERR_NOT_STARTED = 4;
static const uint8_t OTA_ERR_WRITE = 5;
static const uint8_t OTA_ERR_END = 6;
static const uint8_t OTA_ERR_SET_BOOT = 7;

// Notify progress at most this often (bytes) to avoid flooding the link.
static const uint32_t OTA_PROGRESS_STEP = 2048;

BLECharacteristic* pOtaStatusCharacteristic = nullptr;
static esp_ota_handle_t gOtaHandle = 0;
static const esp_partition_t* gOtaPartition = nullptr;
static bool gOtaActive = false;
static uint32_t gOtaTotal = 0;
static uint32_t gOtaWritten = 0;
static uint32_t gOtaLastNotified = 0;

static void otaNotifyStatus(uint8_t code, const uint8_t* extra,
                            size_t extraLen);
static void otaNotifyError(uint8_t err);
static void otaNotifyProgress(uint32_t written);
static void otaAbort();
static void otaHandleStart(const uint8_t* data, size_t len);
static void otaHandleData(const uint8_t* data, size_t len);
static void otaHandleFinish();

class OtaControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    const uint8_t* data = pCharacteristic->getData();
    size_t len = pCharacteristic->getLength();
    if (data == nullptr || len == 0) {
      return;
    }
    switch (data[0]) {
      case OTA_CMD_START:
        otaHandleStart(data, len);
        break;
      case OTA_CMD_FINISH:
        otaHandleFinish();
        break;
      default:
        break;
    }
  }
};

class OtaDataCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    otaHandleData(pCharacteristic->getData(), pCharacteristic->getLength());
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    // Serial.println("Device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    // A drop mid-update leaves a dangling esp_ota handle; release it so the
    // next connection can restart cleanly (the host restarts from offset 0).
    otaAbort();
    // Serial.println("Device disconnected");
    pServer->getAdvertising()->start();
  }
};

class ConfigCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic);
};

void setupBLE() {
  // Matches the OTA app's default scan name (OtaProtocolConfig.deviceName).
  BLEDevice::init("ICM20948&BMP280-Left");

  // Allow a large ATT MTU so OTA data chunks can be up to ~512 bytes
  // (the host negotiates up from here; falls back to 23 if it does not).
  BLEDevice::setMTU(517);

  // 设置发射功率
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, ESP_PWR_LVL_P12);
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P12);
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_CONN_HDL0, ESP_PWR_LVL_P12);

  // 创建BLE服务器
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  // 创建服务
  BLEService* pService = pServer->createService(SERVICE_UUID);
  BLEService* pBatteryService = pServer->createService(BATTERY_SERVICE_UUID);

  // 创建发送特征
  pTxCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());
  // 创建接收特征
  BLECharacteristic* pConfigCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID_CONFIG, BLECharacteristic::PROPERTY_WRITE);
  pConfigCharacteristic->setCallbacks(new ConfigCallbacks());
  pService->start();
  // 创建电池特征
  pBatteryCharacteristic = pBatteryService->createCharacteristic(
      BATTERY_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pBatteryCharacteristic->addDescriptor(new BLE2902());
  pBatteryCharacteristic->setValue(&batteryLevel, 1);
  pBatteryService->start();
  // 启动服务
  BLEService* pDeviceInfoService =
      pServer->createService(DEVICE_INFO_SERVICE_UUID);

  // a) 制造商名称特征
  BLECharacteristic* pManufacturerCharacteristic =
      pDeviceInfoService->createCharacteristic(
          MANUFACTURER_NAME_CHARACTERISTIC_UUID,
          BLECharacteristic::PROPERTY_READ);
  pManufacturerCharacteristic->setValue(MANUFACTURER_NAME);

  // b) 型号特征
  BLECharacteristic* pModelCharacteristic =
      pDeviceInfoService->createCharacteristic(
          MODEL_NUMBER_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_READ);
  pModelCharacteristic->setValue(MODEL_NUMBER);

  // c) 序列号特征
  BLECharacteristic* pSerialCharacteristic =
      pDeviceInfoService->createCharacteristic(
          SERIAL_NUMBER_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_READ);
  pSerialCharacteristic->setValue(SERIAL_NUMBER);

  // d) 硬件版本特征
  BLECharacteristic* pHardwareCharacteristic =
      pDeviceInfoService->createCharacteristic(
          HARDWARE_REVISION_CHARACTERISTIC_UUID,
          BLECharacteristic::PROPERTY_READ);
  pHardwareCharacteristic->setValue(HARDWARE_REVISION);

  // e) 固件版本特征
  BLECharacteristic* pFirmwareCharacteristic =
      pDeviceInfoService->createCharacteristic(
          FIRMWARE_REVISION_CHARACTERISTIC_UUID,
          BLECharacteristic::PROPERTY_READ);
  pFirmwareCharacteristic->setValue(FIRMWARE_REVISION);

  // f) 软件版本特征
  BLECharacteristic* pSoftwareCharacteristic =
      pDeviceInfoService->createCharacteristic(
          SOFTWARE_REVISION_CHARACTERISTIC_UUID,
          BLECharacteristic::PROPERTY_READ);
  pSoftwareCharacteristic->setValue(SOFTWARE_REVISION);

  // 启动服务
  pDeviceInfoService->start();

  // OTA 服务：控制 / 数据 / 状态三个特征
  BLEService* pOtaService = pServer->createService(OTA_SERVICE_UUID);

  BLECharacteristic* pOtaControlCharacteristic =
      pOtaService->createCharacteristic(OTA_CTRL_UUID,
                                        BLECharacteristic::PROPERTY_WRITE);
  pOtaControlCharacteristic->setCallbacks(new OtaControlCallbacks());

  BLECharacteristic* pOtaDataCharacteristic = pOtaService->createCharacteristic(
      OTA_DATA_UUID, BLECharacteristic::PROPERTY_WRITE);
  pOtaDataCharacteristic->setCallbacks(new OtaDataCallbacks());

  pOtaStatusCharacteristic = pOtaService->createCharacteristic(
      OTA_STATUS_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pOtaStatusCharacteristic->addDescriptor(new BLE2902());

  pOtaService->start();

  // 配置广播
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->addServiceUUID(DEVICE_INFO_SERVICE_UUID);

  pAdvertising->setScanResponse(true);
  pAdvertising->start();
}

// 发送按钮（0x01或其他）后handler
void ConfigCallbacks::onWrite(BLECharacteristic* pCharacteristic) {
  String value = pCharacteristic->getValue().c_str();
  if (value.length() > 0) {
    uint8_t command = value[0];
    switch (command) {
      case 0x01:
        // Handler在这里写
        break;
      default:
        break;
    }
  }
}

// ===================== BLE OTA implementation =====================
static void otaNotifyStatus(uint8_t code, const uint8_t* extra,
                            size_t extraLen) {
  if (pOtaStatusCharacteristic == nullptr) {
    return;
  }
  uint8_t buf[1 + 4];
  buf[0] = code;
  size_t n = 1;
  if (extra != nullptr && extraLen > 0) {
    if (extraLen > sizeof(buf) - 1) {
      extraLen = sizeof(buf) - 1;
    }
    memcpy(buf + 1, extra, extraLen);
    n += extraLen;
  }
  pOtaStatusCharacteristic->setValue(buf, n);
  pOtaStatusCharacteristic->notify();
}

static void otaNotifyError(uint8_t err) {
  otaNotifyStatus(OTA_ST_ERROR, &err, 1);
}

static void otaNotifyProgress(uint32_t written) {
  const uint8_t le[4] = {
      static_cast<uint8_t>(written & 0xFF),
      static_cast<uint8_t>((written >> 8) & 0xFF),
      static_cast<uint8_t>((written >> 16) & 0xFF),
      static_cast<uint8_t>((written >> 24) & 0xFF),
  };
  otaNotifyStatus(OTA_ST_PROGRESS, le, sizeof(le));
}

static void otaAbort() {
  if (gOtaActive && gOtaHandle != 0) {
    esp_ota_abort(gOtaHandle);
  }
  gOtaActive = false;
  gOtaHandle = 0;
  gOtaPartition = nullptr;
  gOtaTotal = 0;
  gOtaWritten = 0;
  gOtaLastNotified = 0;
}

static void otaHandleStart(const uint8_t* data, size_t len) {
  if (len < OTA_START_MIN_LEN) {
    otaNotifyError(OTA_ERR_BAD_START);
    return;
  }
  // Discard any half-finished session (e.g. a host-side reconnect + restart).
  otaAbort();

  const uint32_t total = static_cast<uint32_t>(data[1]) |
                         (static_cast<uint32_t>(data[2]) << 8) |
                         (static_cast<uint32_t>(data[3]) << 16) |
                         (static_cast<uint32_t>(data[4]) << 24);
  // data[5..36] carries the version string; the new image reports its own
  // firmware revision after boot, so it is informational here.

  const esp_partition_t* part = esp_ota_get_next_update_partition(nullptr);
  if (part == nullptr) {
    otaNotifyError(OTA_ERR_NO_PARTITION);
    return;
  }

  const esp_err_t err =
      esp_ota_begin(part, total > 0 ? total : OTA_SIZE_UNKNOWN, &gOtaHandle);
  if (err != ESP_OK) {
    gOtaHandle = 0;
    otaNotifyError(OTA_ERR_BEGIN);
    return;
  }

  gOtaPartition = part;
  gOtaActive = true;
  gOtaTotal = total;
  gOtaWritten = 0;
  gOtaLastNotified = 0;
  otaNotifyStatus(OTA_ST_READY, nullptr, 0);
}

static void otaHandleData(const uint8_t* data, size_t len) {
  if (!gOtaActive) {
    otaNotifyError(OTA_ERR_NOT_STARTED);
    return;
  }
  if (data == nullptr || len == 0) {
    return;
  }

  const esp_err_t err = esp_ota_write(gOtaHandle, data, len);
  if (err != ESP_OK) {
    otaNotifyError(OTA_ERR_WRITE);
    otaAbort();
    return;
  }

  gOtaWritten += len;
  const bool complete = gOtaTotal > 0 && gOtaWritten >= gOtaTotal;
  if (gOtaWritten - gOtaLastNotified >= OTA_PROGRESS_STEP || complete) {
    gOtaLastNotified = gOtaWritten;
    otaNotifyProgress(gOtaWritten);
  }
}

static void otaHandleFinish() {
  if (!gOtaActive) {
    otaNotifyError(OTA_ERR_NOT_STARTED);
    return;
  }

  // Report the final byte count so the host's flush wait can complete.
  otaNotifyProgress(gOtaWritten);

  const esp_err_t endErr = esp_ota_end(gOtaHandle);
  gOtaHandle = 0;
  if (endErr != ESP_OK) {
    gOtaActive = false;
    gOtaPartition = nullptr;
    otaNotifyError(OTA_ERR_END);
    return;
  }

  const esp_err_t bootErr = esp_ota_set_boot_partition(gOtaPartition);
  gOtaActive = false;
  gOtaPartition = nullptr;
  if (bootErr != ESP_OK) {
    otaNotifyError(OTA_ERR_SET_BOOT);
    return;
  }

  otaNotifyStatus(OTA_ST_FINISHED, nullptr, 0);
  // Let the BLE stack flush the notification before rebooting into the image.
  delay(500);
  esp_restart();
}

// 读取电池电压
void updateBatteryLevel() {
  int rawValue = analogRead(34);  // 假设电池连接到GPIO34
  uint8_t newBatteryLevel;
  // 根据你的分压电路计算实际电压
  // 示例：如果使用1:1分压，参考电压3.3V
  float voltage = (rawValue / 4095.0) * 3.3 * 2.0;  // 乘以2是因为1:1分压

  // 假设锂电池：4.2V满电，3.3V空电
  if (voltage > 4.2)
    voltage = 4.2;
  if (voltage < 3.3)
    voltage = 3.3;

  // 转换为百分比
  newBatteryLevel = (uint8_t)((voltage - 3.3) / (4.2 - 3.3) * 100);
  newBatteryLevel = random(1, 100);
  // 更新BLE特征值
  if (newBatteryLevel != batteryLevel) {
    batteryLevel = newBatteryLevel;
    if (deviceConnected) {
      pBatteryCharacteristic->setValue(&batteryLevel, 1);
      pBatteryCharacteristic->notify();
    }
  }
  lastBatteryUpdate = millis();
}

void lightSleepDelay(uint32_t ms)  // 累了睡一睡，单位微秒
{
  esp_sleep_enable_timer_wakeup(ms * 1000);
  esp_light_sleep_start();
}

void BMP580Filter() {
  while (pressureSensor.beginI2C(i2cAddress) != BMP5_OK)  // 尝试连接到BMP580
  {
    delay(100);
  }
  int8_t err = BMP5_OK;

  // The BMP581 can filter both the temperature and pressure measurements
  // individually. By default, both filter coefficients are set to 0 (no
  // filtering). We can smooth out the measurements by increasing the
  // coefficients with this function
  bmp5_iir_config config = {
      .set_iir_t = BMP5_IIR_FILTER_COEFF_127,  // Set filter coefficient
      .set_iir_p = BMP5_IIR_FILTER_COEFF_127,  // Set filter coefficient
      .shdw_set_iir_t = BMP5_ENABLE,  // Store filtered data in data registers
      .shdw_set_iir_p = BMP5_ENABLE,  // Store filtered data in data registers
      .iir_flush_forced_en = BMP5_DISABLE  // Flush filter in forced mode
  };
  err = pressureSensor.setFilterConfig(&config);
}
class dataPackage {
 public:
  void dataUpdate() {
    IMU_ST_ANGLES_DATA stAngles;
    IMU_ST_SENSOR_DATA stGyroRawData;
    IMU_ST_SENSOR_DATA stAccelRawData;
    IMU_ST_SENSOR_DATA stMagnRawData;

    bmp5_sensor_data data = {0, 0};
    pressureSensor.getSensorData(&data);

    imuDataGet(&stAngles, &stGyroRawData, &stAccelRawData, &stMagnRawData);

    // packetType: protocol version / sensor-board identifier. 0 = IMU+BMP
    // packet.
    sensorData.packetType = 0;

    // 气压 1/100 Pa → 接收端 raw/100 得 Pa。
    // 海拔由接收端按气压计算 (8434.5 * ln(101325 / pressure))，包内不再传输。
    sensorData.pressure = static_cast<uint32_t>(data.pressure * 100.0f);
    // 温度 1/100 °C → 接收端 raw/100 得 °C。
    sensorData.temp = static_cast<int16_t>(data.temperature * 100.0f);

    // 加速度/角速度/磁场：升宽到 int32，保留传感器原始 LSB。
    // 接收端约定 kAccelConversion = 9.81/1000, kGyroConversion = π/180/1000；
    // 若 ICM20948 量程不是 ±2g/±2000dps，需在此处按比例缩放后再赋值。
    sensorData.ax = static_cast<int32_t>(stAccelRawData.s16X);
    sensorData.ay = static_cast<int32_t>(stAccelRawData.s16Y);
    sensorData.az = static_cast<int32_t>(stAccelRawData.s16Z);

    sensorData.gx = static_cast<int32_t>(stGyroRawData.s16X);
    sensorData.gy = static_cast<int32_t>(stGyroRawData.s16Y);
    sensorData.gz = static_cast<int32_t>(stGyroRawData.s16Z);

    // 角度 1/100 度 → 接收端 raw/100 得 °。
    sensorData.roll = static_cast<int16_t>(stAngles.fRoll * 100.0f);
    sensorData.pitch = static_cast<int16_t>(stAngles.fPitch * 100.0f);
    sensorData.yaw = static_cast<int16_t>(stAngles.fYaw * 100.0f);

    // 四元数 1/10000 → 接收端 raw/10000 得分量值。
    sensorData.q0 = static_cast<int16_t>(q0 * 10000.0f);
    sensorData.q1 = static_cast<int16_t>(q1 * 10000.0f);
    sensorData.q2 = static_cast<int16_t>(q2 * 10000.0f);
    sensorData.q3 = static_cast<int16_t>(q3 * 10000.0f);

    sensorData.m0 = static_cast<int32_t>(stMagnRawData.s16X);
    sensorData.m1 = static_cast<int32_t>(stMagnRawData.s16Y);
    sensorData.m2 = static_cast<int32_t>(stMagnRawData.s16Z);

    // 时间戳 ms → 接收端 raw/1000 得秒。
    sensorData.timestamp_raw = millis();
  };
  void sendViaBLE() {
    if (deviceConnected) {
      pTxCharacteristic->setValue((uint8_t*)&sensorData, sizeof(sensorData));
      pTxCharacteristic->notify();
    }
  }
#pragma pack(push, 1)  // 单字节对齐
  // 数据格式：必须与 motion-lib parsing_utils.h 中的 RawIMUPacket 完全一致 (61
  // 字节)。
  struct SensorData {
    uint8_t packetType;        // 1
    uint32_t pressure;         // 4  (1/100 Pa)
    int16_t temp;              // 2  (1/100 °C)
    int32_t ax, ay, az;        // 12
    int32_t gx, gy, gz;        // 12
    int16_t roll, pitch, yaw;  // 6  (1/100 °)
    int16_t q0, q1, q2, q3;    // 8  (1/10000)
    int32_t m0, m1, m2;        // 12
    uint32_t timestamp_raw;    // 4  (ms)
  };
#pragma pack(pop)
  static_assert(sizeof(SensorData) == 61,
                "RawIMUPacket wire format must be 61 bytes");

 private:
  SensorData sensorData;
};
dataPackage package;

void setup() {
  bool bRet;

  // Serial.begin(115200);
  // Wire.begin();

  IMU_EN_SENSOR_TYPE enMotionSensorType, enPressureType;
  // Serial.begin(115200);
  imuInit(&enMotionSensorType, &enPressureType);
  // BMP580Filter();
  setupBLE();
}

void loop() {
  if (millis() - lastBatteryUpdate >= BATTERY_UPDATE_INTERVAL) {
    updateBatteryLevel();
  }
  while (millis() - lastDataUpdate < DATA_UPDATE_INTERVAL) {
    delay(1);
  }
  lastDataUpdate = millis();
  package.dataUpdate();  // 更新所有数据
  package.sendViaBLE();  // 蓝牙发送
}
