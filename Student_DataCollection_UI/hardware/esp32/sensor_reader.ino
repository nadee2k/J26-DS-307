/*
 * FocusTrack ESP32 Sensor Reader
 * 
 * Reads temperature, humidity, light, noise, and motion sensors
 * and outputs CSV data to serial every second.
 * 
 * Wiring:
 * - DHT22: Data pin -> GPIO4
 * - LDR: Analog pin -> GPIO34
 * - Sound sensor: Analog pin -> GPIO35
 * - PIR Motion: Digital pin -> GPIO27
 * 
 * Board: ESP32 DevKit V1
 */

#include <DHT.h>

#define DHT_PIN 4
#define DHT_TYPE DHT22
#define LDR_PIN 34
#define SOUND_PIN 35
#define MOTION_PIN 27

DHT dht(DHT_PIN, DHT_TYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(MOTION_PIN, INPUT);
  
  // Let sensors warm up
  delay(2000);
}

void loop() {
  // Read sensors
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int light = analogRead(LDR_PIN);
  int noise = analogRead(SOUND_PIN);
  int motion = digitalRead(MOTION_PIN);

  // Check for DHT read failure
  if (isnan(temperature) || isnan(humidity)) {
    temperature = -1.0;
    humidity = -1.0;
  }

  // Output CSV: temp,humidity,light,noise,motion
  Serial.print(temperature, 1);
  Serial.print(",");
  Serial.print(humidity, 1);
  Serial.print(",");
  Serial.print(light);
  Serial.print(",");
  Serial.print(noise);
  Serial.print(",");
  Serial.println(motion);

  delay(1000);
}
