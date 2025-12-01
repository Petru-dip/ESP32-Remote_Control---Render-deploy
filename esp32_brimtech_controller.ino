#include <WiFi.h>
#include <HTTPClient.h>

// --- CONFIG --- //
const char* ssid     = "NUMELE_WIFI";
const char* password = "PAROLA_WIFI";

// Worker endpoints
const char* WORKER_CMD_URL = "https://christmas-tree.christmas-tree.workers.dev/cmd";
const char* WORKER_PING_URL = "https://christmas-tree.christmas-tree.workers.dev/ping"; // optional
const char* WORKER_STATE_URL = "https://christmas-tree.christmas-tree.workers.dev/state";

// Pin pentru releu / MOSFET / instalație
#define LIGHT_PIN 5

// Timp între interogări (ms)
unsigned long lastPoll = 0;
const unsigned long POLL_INTERVAL = 2000;

// Mod curent (pentru efecte)
String currentMode = "off";
unsigned long lastEffectToggle = 0;
bool effectState = false;

void sendState(const String& mode, int intensity);

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW); // off la start

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    reconnectWiFi();
  }

  unsigned long now = millis();

  // 1. Poll la Worker pentru comenzi noi
  if (now - lastPoll >= POLL_INTERVAL) {
    lastPoll = now;
    checkForCommand();
  }

  // 2. Rulează efectele (blink / fade simplu)
  handleEffects();
}

// ------------------- WIFI -------------------

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected, IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi connect failed");
  }
}

void reconnectWiFi() {
  Serial.println("Reconnecting WiFi...");
  WiFi.disconnect();
  connectWiFi();
}

// ------------------- COMENZI -------------------

void checkForCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(WORKER_CMD_URL);

  int code = http.GET();
  if (code == 200) {
    String cmd = http.getString();
    cmd.trim();
    Serial.print("Received CMD: ");
    Serial.println(cmd);

    if (cmd != "" && cmd != "none") {
      applyCommand(cmd);
    }
  } else {
    Serial.print("HTTP error: ");
    Serial.println(code);
  }
  http.end();
}

void applyCommand(const String& cmd) {
  if (cmd == "on") {
    currentMode = "on";
    digitalWrite(LIGHT_PIN, HIGH);
    sendState("on", 255);
  } else if (cmd == "off") {
    currentMode = "off";
    digitalWrite(LIGHT_PIN, LOW);
    sendState("off", 0);
  } else if (cmd == "blink") {
    currentMode = "blink";
    lastEffectToggle = millis();
    sendState("blink", 255);
  } else if (cmd == "fade") {
    currentMode = "fade";
    lastEffectToggle = millis();
    sendState("fade", 255);
  } else {
    Serial.println("Unknown command");
  }
}

// ------------------- EFECTE -------------------

void handleEffects() {
  unsigned long now = millis();

  if (currentMode == "blink") {
    if (now - lastEffectToggle >= 500) { // 0.5s
      lastEffectToggle = now;
      effectState = !effectState;
      digitalWrite(LIGHT_PIN, effectState ? HIGH : LOW);
    }
  } else if (currentMode == "fade") {
    // ATENȚIE: fade real merge doar pe pinuri cu PWM (analogWrite emulat)
    // pe ESP32 folosim ledcWrite.
    static int brightness = 0;
    static int step = 5;

    if (now - lastEffectToggle >= 30) {
      lastEffectToggle = now;
      brightness += step;
      if (brightness >= 255 || brightness <= 0) {
        step = -step;
      }
      // configurare PWM o singură dată
      static bool pwmInit = false;
      if (!pwmInit) {
        pwmInit = true;
        ledcSetup(0, 5000, 8);   // canal 0, 5kHz, rez 8-bit
        ledcAttachPin(LIGHT_PIN, 0);
      }
      ledcWrite(0, brightness);
    }
  }
}

// Trimite starea curentă la worker pentru afișare în UI
void sendState(const String& mode, int intensity) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(WORKER_STATE_URL);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"mode\":\"" + mode + "\",\"intensity\":" + String(intensity) + "}";
  int code = http.POST(payload);
  Serial.print("POST /state => "); Serial.println(code);
  http.end();
}
