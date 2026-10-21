/*
 * FocusTrack ESP32 Sensor Reader (Component 2)
 *
 * Outputs one CSV line per second over USB serial (115200 baud):
 *   temperature_C,humidity_pct,light_raw,sound_p2p_raw,motion
 *
 * - temperature / humidity: DHT22. A failed read is printed as "nan" so the app stores it as MISSING, never as 0 or -1.
 * - light_raw: mean of 16 ADC reads of the LDR divider (0-4095). Mapped to approximate lux in the app with a
 *   two-point calibration against a lux meter.
 * - sound_p2p_raw: peak-to-peak amplitude of the sound sensor over a 50 ms window (a loudness level, not a single
 *   instantaneous sample). Mapped to approximate dB(A) in the app with a two-point calibration against a
 *   sound-level meter. No audio is stored or sent.
 * - motion: PIR output (1 = motion detected during this second).
 *
 * Wiring (ESP32 DevKit V1):
 *   DHT22 data -> GPIO4 | LDR divider -> GPIO34 | Sound sensor analog out -> GPIO35 | PIR out -> GPIO27
 */

#include <DHT.h>

#define DHT_PIN 4
#define DHT_TYPE DHT22
#define LDR_PIN 34
#define SOUND_PIN 35
#define MOTION_PIN 27

DHT dht(DHT_PIN, DHT_TYPE);

int readLightRaw() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(LDR_PIN);
  return (int)(sum / 16);
}

int readSoundPeakToPeak(unsigned long windowMs) {
  int lo = 4095, hi = 0;
  unsigned long start = millis();
  while (millis() - start < windowMs) {
    int v = analogRead(SOUND_PIN);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(MOTION_PIN, INPUT);
  analogReadResolution(12);
  delay(2000); // let the DHT22 and PIR settle
}

void loop() {
  unsigned long loopStart = millis();
  bool motion = false;

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int light = readLightRaw();
  int sound = readSoundPeakToPeak(50);

  // sample the PIR through the rest of the second so short movements are not missed
  while (millis() - loopStart < 1000) {
    if (digitalRead(MOTION_PIN) == HIGH) motion = true;
    delay(20);
  }

  if (isnan(temperature)) Serial.print("nan"); else Serial.print(temperature, 1);
  Serial.print(",");
  if (isnan(humidity)) Serial.print("nan"); else Serial.print(humidity, 1);
  Serial.print(",");
  Serial.print(light);
  Serial.print(",");
  Serial.print(sound);
  Serial.print(",");
  Serial.println(motion ? 1 : 0);
}
